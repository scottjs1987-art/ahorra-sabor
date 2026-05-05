import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env, Pack, Order, Profile, MPPayment, MPPreference } from './types';

// ─────────────────────────────────────────────────────────────
// App setup
// ─────────────────────────────────────────────────────────────

type Variables = { db: SupabaseClient };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

// Inyecta el cliente Supabase con service_role (bypasa RLS para el backend)
app.use('*', async (c, next) => {
  c.set('db', createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY));
  await next();
});

// ─────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({ status: 'ok', region: (c.req.raw as Request & { cf?: { colo: string } }).cf?.colo }),
);

// ─────────────────────────────────────────────────────────────
// POST /checkout
// Verifica stock → crea orden pendiente → genera preferencia MP
// ─────────────────────────────────────────────────────────────

app.post('/checkout', async (c) => {
  const body = await c.req.json<{ pack_id: string; user_id: string; quantity?: number }>();
  const { pack_id, user_id, quantity = 1 } = body;

  if (!pack_id || !user_id) {
    return c.json({ error: 'pack_id y user_id son requeridos' }, 400);
  }

  const db = c.get('db');

  // 1. Verificar pack activo con stock suficiente
  const { data: pack, error: packErr } = await db
    .from('packs')
    .select<string, Pack>('*')
    .eq('id', pack_id)
    .eq('status', 'active')
    .gt('end_time', new Date().toISOString())
    .single();

  if (packErr || !pack) {
    return c.json({ error: 'Pack no encontrado o no disponible' }, 404);
  }

  const freeStock = pack.stock - pack.reserved_stock;
  if (freeStock < quantity) {
    return c.json({ error: `Solo quedan ${freeStock} unidades disponibles` }, 409);
  }

  // 2. Datos del comercio para el ítem MP
  const { data: merchant } = await db
    .from('profiles')
    .select<string, Pick<Profile, 'name'>>('name')
    .eq('id', pack.merchant_id)
    .single();

  // 3. Calcular totales
  const takeRate = parseFloat(c.env.TAKE_RATE ?? '0.15');
  const total = round2(pack.price_offer * quantity);
  const platformFee = round2(total * takeRate);
  const netMerchant = round2(total - platformFee);

  // 4. Crear orden en Supabase (estado: pending)
  const { data: order, error: orderErr } = await db
    .from('orders')
    .insert({
      user_id,
      pack_id,
      merchant_id: pack.merchant_id,
      quantity,
      total,
      platform_fee: platformFee,
      net_merchant: netMerchant,
      status: 'pending',
    })
    .select<string, Order>()
    .single();

  if (orderErr || !order) {
    console.error('[checkout] insert order:', orderErr);
    return c.json({ error: 'Error al crear la orden' }, 500);
  }

  // 5. Crear preferencia en Mercado Pago
  const prefBody = {
    items: [
      {
        id: pack_id,
        title: `Pack Sorpresa — ${merchant?.name ?? 'Comercio'}`,
        description: pack.description ?? 'Productos frescos del día con descuento',
        quantity,
        unit_price: pack.price_offer,
        currency_id: 'ARS',
        category_id: 'food',
      },
    ],
    external_reference: order.id,
    back_urls: {
      success: `${c.env.APP_BASE_URL}/pago/exito`,
      failure: `${c.env.APP_BASE_URL}/pago/fallo`,
      pending: `${c.env.APP_BASE_URL}/pago/pendiente`,
    },
    auto_return: 'approved',
    notification_url: `${c.env.APP_BASE_URL}/webhook`,
    statement_descriptor: 'AHORRASABOR',
    expires: true,
    expiration_date_to: pack.end_time,
  };

  const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': order.id,
    },
    body: JSON.stringify(prefBody),
  });

  if (!mpRes.ok) {
    // Rollback: cancelar la orden si MP falla
    await db.from('orders').update({ status: 'cancelled' }).eq('id', order.id);
    console.error('[checkout] MP preference:', await mpRes.text());
    return c.json({ error: 'Error al iniciar el pago con Mercado Pago' }, 502);
  }

  const pref = await mpRes.json<MPPreference>();

  // 6. Persistir preference_id y reservar stock (batch)
  await Promise.all([
    db.from('orders').update({ mp_preference_id: pref.id }).eq('id', order.id),
    db
      .from('packs')
      .update({ reserved_stock: pack.reserved_stock + quantity })
      .eq('id', pack_id),
  ]);

  return c.json({
    order_id: order.id,
    preference_id: pref.id,
    init_point: pref.init_point,
    sandbox_init_point: pref.sandbox_init_point,
  });
});

// ─────────────────────────────────────────────────────────────
// POST /webhook
// Recibe notificación de Mercado Pago (payment.created)
// ─────────────────────────────────────────────────────────────

app.post('/webhook', async (c) => {
  const rawBody = await c.req.text();

  // Verificar firma HMAC-SHA256 de MP
  if (c.env.MP_WEBHOOK_SECRET) {
    const valid = await verifyMPSignature(
      rawBody,
      c.req.header('x-signature') ?? '',
      c.req.header('x-request-id') ?? '',
      c.env.MP_WEBHOOK_SECRET,
    );
    if (!valid) {
      return c.json({ error: 'Firma inválida' }, 401);
    }
  }

  const payload = JSON.parse(rawBody) as { type: string; action: string; data: { id: string } };
  const { type, action, data } = payload;

  // Respuesta 200 inmediata para evitar reintentos de MP
  if (type !== 'payment' || action !== 'payment.created') {
    return c.json({ ok: true });
  }

  const db = c.get('db');

  // Consultar el pago completo a la API de MP
  const mpPayRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
    headers: { Authorization: `Bearer ${c.env.MP_ACCESS_TOKEN}` },
  });
  if (!mpPayRes.ok) return c.json({ ok: true });

  const payment = await mpPayRes.json<MPPayment>();
  const { external_reference, status } = payment;
  if (!external_reference) return c.json({ ok: true });

  // Obtener la orden con el pack anidado
  const { data: order } = await db
    .from('orders')
    .select<string, Order & { packs: Pick<Pack, 'title' | 'stock' | 'reserved_stock' | 'status'> }>(
      '*, packs(title, stock, reserved_stock, status)',
    )
    .eq('id', external_reference)
    .single();

  if (!order) return c.json({ ok: true });

  if (status === 'approved' && order.status === 'pending') {
    const { token, hash } = await generateSignedQR(order.id, c.env.QR_SIGNING_SECRET);

    const pack = order.packs!;
    const newStock = pack.stock - order.quantity;

    await Promise.all([
      db.from('orders').update({
        status: 'paid',
        mp_payment_id: String(data.id),
        mp_status: status,
        qr_token: token,
        qr_token_hash: hash,
      }).eq('id', external_reference),

      db.from('packs').update({
        stock: Math.max(newStock, 0),
        reserved_stock: Math.max(pack.reserved_stock - order.quantity, 0),
        ...(newStock <= 0 ? { status: 'expired' } : {}),
      }).eq('id', order.pack_id),
    ]);

  } else if (['rejected', 'cancelled'].includes(status) && order.status === 'pending') {
    const pack = order.packs!;

    await Promise.all([
      db.from('orders').update({
        status: 'cancelled',
        mp_payment_id: String(data.id),
        mp_status: status,
      }).eq('id', external_reference),

      db.from('packs').update({
        reserved_stock: Math.max(pack.reserved_stock - order.quantity, 0),
      }).eq('id', order.pack_id),
    ]);
  }

  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// POST /validate-pickup
// El comercio escanea el QR y lo valida
// ─────────────────────────────────────────────────────────────

app.post('/validate-pickup', async (c) => {
  const { qr_token, merchant_id } = await c.req.json<{ qr_token: string; merchant_id: string }>();

  if (!qr_token || !merchant_id) {
    return c.json({ error: 'qr_token y merchant_id son requeridos' }, 400);
  }

  // Verificar que el QR fue firmado por este sistema (anti-screenshot fraud)
  const isLegit = await verifyQRSignature(qr_token, c.env.QR_SIGNING_SECRET);
  if (!isLegit) {
    return c.json({ error: '¡QR inválido! No intentes hacerte el vivo.' }, 401);
  }

  const db = c.get('db');

  const { data: order } = await db
    .from('orders')
    .select<string, Order & { packs: Pick<Pack, 'title'> }>('*, packs(title)')
    .eq('qr_token', qr_token)
    .eq('merchant_id', merchant_id)
    .single();

  if (!order) {
    return c.json({ error: 'QR no encontrado o no pertenece a este comercio' }, 404);
  }

  // ¡El clásico argentino!
  if (order.status === 'delivered') {
    return c.json(
      { error: '¡SACA LA MANO DE AHÍ, CARAJO! Este pack ya fue entregado.' },
      409,
    );
  }

  if (order.status !== 'paid') {
    return c.json({ error: 'La orden no está habilitada para entrega' }, 400);
  }

  await db.from('orders').update({
    status: 'delivered',
    delivered_at: new Date().toISOString(),
  }).eq('id', order.id);

  return c.json({
    ok: true,
    message: '¡Pack entregado correctamente! ¡Que aproveche!',
    order: {
      id: order.id,
      pack_title: order.packs?.title,
      quantity: order.quantity,
      total: order.total,
      net_merchant: order.net_merchant,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// Utilidades criptográficas (Web Crypto API — edge compatible)
// ─────────────────────────────────────────────────────────────

async function verifyMPSignature(
  body: string,
  xSignature: string,
  xRequestId: string,
  secret: string,
): Promise<boolean> {
  try {
    const ts = xSignature.split(',').find((p) => p.startsWith('ts='))?.split('=')[1];
    const v1 = xSignature.split(',').find((p) => p.startsWith('v1='))?.split('=')[1];
    if (!ts || !v1) return false;

    const dataId = (JSON.parse(body) as { data?: { id?: string } }).data?.id;
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(manifest));
    const computed = toHex(sig);
    return computed === v1;
  } catch {
    return false;
  }
}

async function generateSignedQR(
  orderId: string,
  secret: string,
): Promise<{ token: string; hash: string }> {
  const nonce = crypto.randomUUID();
  const payload = `${orderId}:${nonce}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  // Usamos los primeros 24 hex chars del HMAC como firma compacta para el QR
  const sigShort = toHex(sig).slice(0, 24);

  // Formato: AS:{orderId}:{nonce}:{signature}
  const token = `AS:${orderId}:${nonce}:${sigShort}`;

  // Hash completo para búsqueda rápida en BD
  const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(token));
  const hash = toHex(hashBuf);

  return { token, hash };
}

async function verifyQRSignature(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split(':');
    // AS : orderId (con guiones UUID) : nonce (UUID) : sigShort
    // UUID tiene 5 grupos separados por guión → partes[1..5] = orderId, [6..11] = nonce, [12] = sig
    if (parts[0] !== 'AS' || parts.length < 4) return false;

    // Reconstruir: orderId = parts[1], nonce = parts[2], sig = parts[3]
    const [, orderId, nonce, sigShort] = parts;
    if (!orderId || !nonce || !sigShort) return false;

    const payload = `${orderId}:${nonce}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    const expected = toHex(sig).slice(0, 24);
    return expected === sigShort;
  } catch {
    return false;
  }
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────
export default app;

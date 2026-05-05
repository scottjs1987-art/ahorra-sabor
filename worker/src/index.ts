import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env, Pack, Order, Profile, MPPayment, MPPreference } from './types';

// ─────────────────────────────────────────────────────────────
// App + middleware
// ─────────────────────────────────────────────────────────────

type Variables = { db: SupabaseClient };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));
app.use('*', async (c, next) => {
  c.set('db', createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY));
  await next();
});

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

/** Take rate dinámico: lee PLATFORM_FEE_RATE del env, fallback 15 %. */
function getTakeRate(env: Env): number {
  const raw = parseFloat(env.PLATFORM_FEE_RATE ?? env.TAKE_RATE ?? '0.15');
  // Clampeado entre 0 % y 40 % para evitar errores de configuración
  return Math.min(Math.max(raw, 0), 0.40);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verifica firma HMAC-SHA256 del webhook de Mercado Pago.
 *  Docs: https://www.mercadopago.com.ar/developers/es/docs/notifications/webhooks/security
 */
async function verifyMPSignature(
  rawBody: string,
  xSignature: string,
  xRequestId: string,
  secret: string,
): Promise<boolean> {
  try {
    const ts  = xSignature.split(',').find(p => p.startsWith('ts='))?.split('=')[1];
    const v1  = xSignature.split(',').find(p => p.startsWith('v1='))?.split('=')[1];
    if (!ts || !v1) return false;

    const dataId  = (JSON.parse(rawBody) as { data?: { id?: string } }).data?.id;
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig     = await crypto.subtle.sign('HMAC', key, enc.encode(manifest));
    const computed = toHex(sig);
    return computed === v1;
  } catch {
    return false;
  }
}

/** Genera un QR token firmado con HMAC + nonce.
 *  Formato: AS:{orderId}:{nonce}:{hmac24hex}
 *  Resistente a capturas de pantalla — la firma es verificada en /validate-pickup.
 */
async function generateSignedQR(
  orderId: string,
  secret: string,
): Promise<{ token: string; hash: string }> {
  const nonce   = crypto.randomUUID();
  const payload = `${orderId}:${nonce}`;
  const enc     = new TextEncoder();
  const key     = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig     = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const token   = `AS:${orderId}:${nonce}:${toHex(sig).slice(0, 24)}`;

  const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return { token, hash: toHex(hashBuf) };
}

/** Verifica que el token QR fue firmado por este sistema. */
async function verifyQRSignature(token: string, secret: string): Promise<boolean> {
  try {
    const [prefix, orderId, nonce, sigShort] = token.split(':');
    if (prefix !== 'AS' || !orderId || !nonce || !sigShort) return false;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig     = await crypto.subtle.sign('HMAC', key, enc.encode(`${orderId}:${nonce}`));
    const expected = toHex(sig).slice(0, 24);
    return expected === sigShort;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────────────────────────

app.get('/health', c =>
  c.json({
    status: 'ok',
    region: (c.req.raw as Request & { cf?: { colo: string } }).cf?.colo,
    version: '2.0.0',
    take_rate: getTakeRate(c.env),
  }),
);

// ─────────────────────────────────────────────────────────────
// GET /packs  — Edge-cached 60 s en la red de Cloudflare
// ─────────────────────────────────────────────────────────────

app.get('/packs', async c => {
  const { category } = c.req.query();
  const db = c.get('db');

  let q = db
    .from('packs')
    .select(`
      id, merchant_id, title, description, price_reg, price_offer,
      stock, reserved_stock, end_time, status, image_url, category,
      profiles!merchant_id ( name, geo_lat, geo_lng )
    `)
    .eq('status', 'active')
    .gt('end_time', new Date().toISOString())
    .gt('stock', 0)
    .order('end_time', { ascending: true });

  if (category) q = q.eq('category', category);

  const { data, error } = await q;
  if (error) return c.json({ error: 'Error obteniendo packs' }, 500);

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type':                  'application/json',
      // La red Edge de Cloudflare cachea 60 s globalmente
      'Cache-Control':                 'public, s-maxage=60, stale-while-revalidate=30',
      'CDN-Cache-Control':             'public, max-age=60',
      'Cloudflare-CDN-Cache-Control':  'public, max-age=60',
      'Vary':                          'Accept-Encoding',
      'X-Cache-At':                    new Date().toISOString(),
    },
  });
});

// ─────────────────────────────────────────────────────────────
// POST /checkout
// Verifica stock → crea orden pendiente → genera preferencia MP
// ─────────────────────────────────────────────────────────────

app.post('/checkout', async c => {
  const body = await c.req.json<{ pack_id: string; user_id: string; quantity?: number }>();
  const { pack_id, user_id, quantity = 1 } = body;

  if (!pack_id || !user_id) {
    return c.json({ error: 'pack_id y user_id son requeridos' }, 400);
  }

  const db       = c.get('db');
  const takeRate = getTakeRate(c.env);

  // 1. Pack activo con stock libre
  const { data: pack, error: packErr } = await db
    .from('packs')
    .select<string, Pack>('*')
    .eq('id', pack_id)
    .eq('status', 'active')
    .gt('end_time', new Date().toISOString())
    .single();

  if (packErr || !pack) return c.json({ error: 'Pack no encontrado o no disponible' }, 404);

  const freeStock = pack.stock - pack.reserved_stock;
  if (freeStock < quantity) {
    return c.json({ error: `Solo quedan ${freeStock} unidades disponibles` }, 409);
  }

  // 2. Nombre del comercio
  const { data: merchant } = await db
    .from('profiles')
    .select<string, Pick<Profile, 'name'>>('name')
    .eq('id', pack.merchant_id)
    .single();

  // 3. Totales con take rate dinámico
  const total      = round2(pack.price_offer * quantity);
  const platformFee = round2(total * takeRate);
  const netMerchant = round2(total - platformFee);

  // 4. Orden pendiente
  const { data: order, error: orderErr } = await db
    .from('orders')
    .insert({ user_id, pack_id, merchant_id: pack.merchant_id, quantity, total, platform_fee: platformFee, net_merchant: netMerchant, status: 'pending' })
    .select<string, Order>()
    .single();

  if (orderErr || !order) {
    console.error('[checkout] insert order:', orderErr);
    return c.json({ error: 'Error al crear la orden' }, 500);
  }

  // 5. Preferencia en Mercado Pago
  const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization:       `Bearer ${c.env.MP_ACCESS_TOKEN}`,
      'Content-Type':      'application/json',
      'X-Idempotency-Key': order.id,
    },
    body: JSON.stringify({
      items: [{
        id: pack_id, title: `Pack Sorpresa — ${merchant?.name ?? 'Comercio'}`,
        description: pack.description ?? 'Productos frescos con descuento',
        quantity, unit_price: pack.price_offer, currency_id: 'ARS', category_id: 'food',
      }],
      external_reference: order.id,
      back_urls: {
        success: `${c.env.APP_BASE_URL}/pago/exito`,
        failure: `${c.env.APP_BASE_URL}/pago/fallo`,
        pending: `${c.env.APP_BASE_URL}/pago/pendiente`,
      },
      auto_return:         'approved',
      notification_url:    `${c.env.APP_BASE_URL}/webhook`,
      statement_descriptor:'AHORRASABOR',
      expires:              true,
      expiration_date_to:   pack.end_time,
    }),
  });

  if (!mpRes.ok) {
    await db.from('orders').update({ status: 'cancelled' }).eq('id', order.id);
    console.error('[checkout] MP error:', await mpRes.text());
    return c.json({ error: 'Error al iniciar el pago con Mercado Pago' }, 502);
  }

  const pref = await mpRes.json<MPPreference>();

  await Promise.all([
    db.from('orders').update({ mp_preference_id: pref.id }).eq('id', order.id),
    db.from('packs').update({ reserved_stock: pack.reserved_stock + quantity }).eq('id', pack_id),
  ]);

  return c.json({
    order_id:            order.id,
    preference_id:       pref.id,
    init_point:          pref.init_point,
    sandbox_init_point:  pref.sandbox_init_point,
    take_rate:           takeRate,
    breakdown: { total, platform_fee: platformFee, net_merchant: netMerchant },
  });
});

// ─────────────────────────────────────────────────────────────
// POST /webhook  — Notificaciones de Mercado Pago
// ─────────────────────────────────────────────────────────────

app.post('/webhook', async c => {
  const rawBody = await c.req.text();

  // Verificación HMAC-SHA256: rechaza si el secret está configurado y la firma no coincide
  const xSignature  = c.req.header('x-signature') ?? '';
  const xRequestId  = c.req.header('x-request-id') ?? '';

  if (c.env.MP_WEBHOOK_SECRET) {
    const valid = await verifyMPSignature(rawBody, xSignature, xRequestId, c.env.MP_WEBHOOK_SECRET);
    if (!valid) {
      console.warn('[webhook] Firma MP inválida — notificación descartada');
      // Respondemos 200 de todas formas para que MP no reintente indefinidamente
      return c.json({ ok: false, reason: 'invalid_signature' });
    }
  }

  const payload = JSON.parse(rawBody) as { type: string; action: string; data: { id: string } };
  if (payload.type !== 'payment' || payload.action !== 'payment.created') {
    return c.json({ ok: true });
  }

  const db = c.get('db');

  // Consultar el estado real del pago a la API de MP
  const mpPayRes = await fetch(`https://api.mercadopago.com/v1/payments/${payload.data.id}`, {
    headers: { Authorization: `Bearer ${c.env.MP_ACCESS_TOKEN}` },
  });
  if (!mpPayRes.ok) return c.json({ ok: true });

  const payment = await mpPayRes.json<MPPayment>();
  const { external_reference, status } = payment;
  if (!external_reference) return c.json({ ok: true });

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
    const takeRate = getTakeRate(c.env);

    await Promise.all([
      // Actualizar orden a 'paid'
      db.from('orders').update({
        status: 'paid', mp_payment_id: String(payload.data.id),
        mp_status: 'approved', qr_token: token, qr_token_hash: hash,
      }).eq('id', external_reference),

      // Consumir stock
      db.from('packs').update({
        stock:          Math.max(newStock, 0),
        reserved_stock: Math.max(pack.reserved_stock - order.quantity, 0),
        ...(newStock <= 0 ? { status: 'expired' } : {}),
      }).eq('id', order.pack_id),

      // Registrar en financial_ledger (idempotente por UNIQUE en order_id)
      db.from('financial_ledger').upsert({
        order_id:         external_reference,
        merchant_id:      order.merchant_id,
        total_amount:     order.total,
        platform_fee:     order.platform_fee ?? round2(order.total * takeRate),
        platform_fee_rate: takeRate,
        merchant_net:     order.net_merchant ?? round2(order.total * (1 - takeRate)),
        status:           'pending_settlement',
        mp_payment_id:    String(payload.data.id),
      }, { onConflict: 'order_id', ignoreDuplicates: true }),
    ]);

  } else if (['rejected', 'cancelled'].includes(status) && order.status === 'pending') {
    const pack = order.packs!;
    await Promise.all([
      db.from('orders').update({
        status: 'cancelled', mp_payment_id: String(payload.data.id), mp_status: status,
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
// Valida el QR en el local; marca la orden como entregada.
// ─────────────────────────────────────────────────────────────

app.post('/validate-pickup', async c => {
  const { qr_token, merchant_id } = await c.req.json<{ qr_token: string; merchant_id: string }>();

  if (!qr_token || !merchant_id) {
    return c.json({ error: 'qr_token y merchant_id son requeridos' }, 400);
  }

  // 1. Verificar firma criptográfica del QR (anti-screenshot)
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

  // 2. Validación de expiración: tickets con más de 24 hs son inválidos
  const createdAt  = new Date(order.created_at).getTime();
  const ageHours   = (Date.now() - createdAt) / (1000 * 60 * 60);
  if (ageHours > 24) {
    return c.json(
      { error: '¡SACA LA MANO DE AHÍ, CARAJO! Este ticket ya no es válido.' },
      410, // Gone
    );
  }

  // 3. El clásico argentino para el caso de re-entrega
  if (order.status === 'delivered') {
    return c.json(
      { error: '¡SACA LA MANO DE AHÍ, CARAJO! Este pack ya fue entregado.' },
      409,
    );
  }

  if (order.status !== 'paid') {
    return c.json({ error: 'La orden no está habilitada para entrega' }, 400);
  }

  // 4. Marcar como entregado (el trigger de DB actualiza merchant_stats automáticamente)
  await db.from('orders').update({
    status:       'delivered',
    delivered_at: new Date().toISOString(),
  }).eq('id', order.id);

  // 5. Marcar ledger como listo para liquidar
  await db.from('financial_ledger')
    .update({ status: 'pending_settlement' })
    .eq('order_id', order.id);

  return c.json({
    ok:      true,
    message: '¡Pack entregado correctamente! ¡Que aproveche!',
    order:   {
      id:          order.id,
      pack_title:  order.packs?.title,
      quantity:    order.quantity,
      total:       order.total,
      net_merchant: order.net_merchant,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// POST /payout-request
// El comercio solicita retiro de fondos acumulados.
// ─────────────────────────────────────────────────────────────

app.post('/payout-request', async c => {
  const { merchant_id, amount, notes } = await c.req.json<{
    merchant_id: string; amount: number; notes?: string;
  }>();

  if (!merchant_id || !amount || amount <= 0) {
    return c.json({ error: 'merchant_id y amount son requeridos' }, 400);
  }

  const db = c.get('db');

  // Verificar que tenga saldo suficiente
  const { data: stats } = await db
    .from('merchant_stats')
    .select('pending_payout')
    .eq('merchant_id', merchant_id)
    .single();

  if (!stats || stats.pending_payout < amount) {
    return c.json({ error: `Saldo insuficiente. Disponible: $${stats?.pending_payout ?? 0}` }, 409);
  }

  const { data: payout, error } = await db
    .from('payout_requests')
    .insert({ merchant_id, amount, notes: notes ?? null, status: 'requested' })
    .select()
    .single();

  if (error || !payout) return c.json({ error: 'Error creando la solicitud de retiro' }, 500);

  return c.json({
    ok:         true,
    payout_id:  payout.id,
    amount,
    status:     'requested',
    message:    'Solicitud recibida. Procesamos los retiros los días hábiles dentro de las 48 hs.',
  });
});

// ─────────────────────────────────────────────────────────────
export default app;

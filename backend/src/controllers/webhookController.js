const crypto = require('crypto');
const { processWebhookPayment } = require('../services/paymentService');
const axios = require('axios');
const { db } = require('../config/firebase');

/**
 * Valida la firma HMAC-SHA256 del webhook de Mercado Pago.
 * Docs: https://www.mercadopago.com.ar/developers/es/docs/notifications/webhooks
 */
function verifyWebhookSignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // En desarrollo sin secret configurado

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  if (!xSignature || !xRequestId) return false;

  const dataId = req.query['data.id'] || req.body?.data?.id;
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${xSignature.split(',').find(p => p.startsWith('ts='))?.split('=')[1]};`;

  const ts = xSignature.split(',').find(p => p.startsWith('ts='))?.split('=')[1];
  const v1 = xSignature.split(',').find(p => p.startsWith('v1='))?.split('=')[1];

  const computed = crypto
    .createHmac('sha256', secret)
    .update(`id:${dataId};request-id:${xRequestId};ts:${ts};`)
    .digest('hex');

  return computed === v1;
}

async function mercadopagoWebhookHandler(req, res) {
  // Responde 200 inmediatamente para evitar reintentos de MP
  res.sendStatus(200);

  const { type, action, data } = req.body;

  if (!verifyWebhookSignature(req)) {
    console.warn('[Webhook] Firma inválida, notificación descartada');
    return;
  }

  try {
    if (type === 'payment' && action === 'payment.created') {
      await processWebhookPayment(data.id);
    }
  } catch (err) {
    console.error('[Webhook] Error procesando pago:', err.message);
  }
}

/**
 * Dispara el webhook de donación hacia la ONG simulada.
 * Se llama cuando el comercio marca excedente como "donar".
 */
async function donationWebhookHandler(req, res) {
  try {
    const { packId, merchantId, cantidadExcedente, descripcion } = req.body;
    if (!packId || !merchantId) {
      return res.status(400).json({ error: 'packId y merchantId son requeridos' });
    }

    const merchantDoc = await db.collection('merchants').doc(merchantId).get();
    const merchant = merchantDoc.data();

    const donationPayload = {
      evento: 'excedente_disponible',
      comercio: {
        id: merchantId,
        nombre: merchant?.nombre,
        direccion: merchant?.direccion,
      },
      excedente: {
        packId,
        cantidad: cantidadExcedente,
        descripcion: descripcion || 'Productos frescos del día',
        disponibleHasta: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    await axios.post(process.env.DONATION_WEBHOOK_URL, donationPayload, {
      timeout: 5000,
    });

    // Registra la donación en Firestore
    await db.collection('donations').add({
      ...donationPayload,
      estado: 'notificado',
    });

    res.json({ ok: true, mensaje: 'ONG notificada exitosamente' });
  } catch (err) {
    console.error('[Donación] Error:', err.message);
    res.status(500).json({ error: 'Error notificando a la ONG' });
  }
}

module.exports = { mercadopagoWebhookHandler, donationWebhookHandler };

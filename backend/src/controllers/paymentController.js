const { createPreference, validatePickup } = require('../services/paymentService');

async function createPreferenceHandler(req, res) {
  try {
    const { packId, userId, quantity } = req.body;
    if (!packId || !userId) {
      return res.status(400).json({ error: 'packId y userId son requeridos' });
    }

    const result = await createPreference({ packId, userId, quantity });
    res.json(result);
  } catch (err) {
    console.error('[Payment] createPreference error:', err.message);
    const status = err.message.includes('no encontrado') ? 404
      : err.message.includes('insuficiente') ? 409
      : 500;
    res.status(status).json({ error: err.message });
  }
}

async function validatePickupHandler(req, res) {
  try {
    const { qrCode, merchantId } = req.body;
    if (!qrCode || !merchantId) {
      return res.status(400).json({ error: 'qrCode y merchantId son requeridos' });
    }

    const order = await validatePickup({ qrCode, merchantId });
    res.json({ ok: true, orden: order });
  } catch (err) {
    console.error('[Payment] validatePickup error:', err.message);
    res.status(400).json({ error: err.message });
  }
}

module.exports = { createPreferenceHandler, validatePickupHandler };

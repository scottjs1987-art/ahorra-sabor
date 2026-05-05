const express = require('express');
const { createPreferenceHandler, validatePickupHandler } = require('../controllers/paymentController');
const { mercadopagoWebhookHandler, donationWebhookHandler } = require('../controllers/webhookController');

const router = express.Router();

// Pagos
router.post('/payments/create-preference', createPreferenceHandler);
router.post('/payments/validate-pickup', validatePickupHandler);

// Webhooks (sin authmiddleware — MP llama directamente)
router.post('/webhooks/mercadopago', express.raw({ type: 'application/json' }), mercadopagoWebhookHandler);

// Donaciones
router.post('/donations/notify', donationWebhookHandler);

// Health check
router.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

module.exports = router;

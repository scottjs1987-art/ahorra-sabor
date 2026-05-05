require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));

// Rate limiting general
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas solicitudes, intentá más tarde' },
}));

// Rate limiting estricto para crear preferencias (anti-abuso)
app.use('/api/payments/create-preference', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Límite de creación de preferencias alcanzado' },
}));

app.use(express.json());
app.use('/api', routes);

app.use((err, req, res, _next) => {
  console.error('[Error global]', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`[AhorraSabor API] Servidor corriendo en puerto ${PORT}`);
});

module.exports = app;

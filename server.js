/**
 * ============================================================
 * ElhyAi Campaigns — Backend Server
 * WhatsApp Cloud API + Campañas Masivas
 * ElhyAi Consultores — Christian Sánchez
 * ============================================================
 */

require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const campaignRoutes  = require('./routes/campaigns');
const whatsappRoutes  = require('./routes/whatsapp');
const webhookRoutes   = require('./routes/webhook');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Seguridad ──────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));

// Rate limit general
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 500,
  message: { error: 'Demasiadas peticiones. Intenta en 15 minutos.' }
}));

// Rate limit específico para envíos masivos
const sendLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 10,
  message: { error: 'Límite de envíos alcanzado. Espera 1 minuto.' }
});

// ── Body parsers ───────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Frontend estático ──────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Rutas API ──────────────────────────────────────────────
app.use('/api/campaigns', sendLimiter, campaignRoutes);
app.use('/api/whatsapp',  whatsappRoutes);
app.use('/webhook',       webhookRoutes);

// ── Health check ───────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'ElhyAi Campaigns',
    version: '1.0.0',
    time:    new Date().toISOString(),
    wa_configured: !!(process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID),
  });
});

// ── SPA fallback ───────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Error handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`\n${'═'.repeat(52)}`);
  console.log('  ElhyAi Campaigns — Backend');
  console.log(`${'═'.repeat(52)}`);
  console.log(`🌐 Servidor: http://localhost:${PORT}`);
  console.log(`📱 WA Token: ${process.env.WHATSAPP_TOKEN ? '✅ Configurado' : '❌ Falta en .env'}`);
  console.log(`📞 Phone ID: ${process.env.PHONE_NUMBER_ID ? '✅ Configurado' : '❌ Falta en .env'}`);
  console.log(`${'═'.repeat(52)}\n`);
});

module.exports = app;

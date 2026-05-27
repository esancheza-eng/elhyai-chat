const express = require('express');
const router  = express.Router();
const wa      = require('../services/whatsapp');

// Enviar mensaje individual de prueba
router.post('/send', async (req, res) => {
  try {
    wa.checkCredentials();
    const { to, message, type = 'text' } = req.body;
    if (!to || !message) return res.status(400).json({ ok: false, error: 'Faltan: to, message' });
    const result = await wa.sendTextMessage(to, message);
    res.json({ ok: true, result });
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ ok: false, error: errMsg });
  }
});

// Info del número configurado
router.get('/info', async (req, res) => {
  try {
    wa.checkCredentials();
    const info = await wa.getPhoneInfo();
    res.json({ ok: true, info });
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ ok: false, error: errMsg });
  }
});

// Verificar credenciales
router.get('/check', (req, res) => {
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.PHONE_NUMBER_ID;
  res.json({
    ok:             !!(token && phoneId),
    token_set:      !!token,
    phone_id_set:   !!phoneId,
    token_preview:  token   ? token.slice(0,10)   + '...' : null,
    phone_id:       phoneId ? phoneId : null,
  });
});

module.exports = router;

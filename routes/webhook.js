const express = require('express');
const router  = express.Router();

// GET — verificación de webhook por Meta
router.get('/meta', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook Meta verificado correctamente');
    res.status(200).send(challenge);
  } else {
    console.warn('❌ Token de verificación incorrecto:', token);
    res.status(403).json({ error: 'Token de verificación incorrecto' });
  }
});

// POST — recibir mensajes entrantes de WhatsApp
router.post('/meta', (req, res) => {
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(404);
    }

    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    // Mensajes entrantes
    if (value?.messages?.length) {
      for (const msg of value.messages) {
        const from = msg.from;
        const type = msg.type;
        let   text = '';

        if (type === 'text')     text = msg.text?.body || '';
        if (type === 'button')   text = msg.button?.text || '';
        if (type === 'interactive') text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';

        console.log(`📨 Mensaje de ${from}: "${text}" [${type}]`);

        // Aquí puedes agregar lógica: guardar en DB, responder con IA, etc.
      }
    }

    // Status updates (enviado, leído, etc.)
    if (value?.statuses?.length) {
      for (const s of value.statuses) {
        console.log(`📊 Status ${s.id}: ${s.status} → ${s.recipient_id}`);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(500);
  }
});

module.exports = router;

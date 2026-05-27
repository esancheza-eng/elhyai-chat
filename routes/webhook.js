const express = require('express');
const router  = express.Router();

// GET — verificación de webhook por Meta
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook Meta verificado correctamente');
    return res.status(200).send(challenge);
  }

  console.warn('❌ Token incorrecto:', token);
  return res.sendStatus(403);
});

// POST — recibir mensajes entrantes
router.post('/', (req, res) => {
  try {
    const body = req.body;

    console.log('📩 Webhook recibido:', JSON.stringify(body));

    if (body.object === 'whatsapp_business_account') {
      return res.sendStatus(200);
    }

    return res.sendStatus(404);

  } catch (

const express = require('express');
const router = express.Router();

// ======================================================
// GET -> Verificacion webhook Meta
// ======================================================
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (
    mode === 'subscribe' &&
    token === process.env.VERIFY_TOKEN
  ) {
    console.log('Webhook verificado OK');
    return res.status(200).send(challenge);
  }
  console.log('Token invalido');
  return res.sendStatus(403);
});

// ======================================================
// POST -> Mensajes entrantes WhatsApp
// ======================================================
router.post('/', (req, res) => {
  try {
    const body = req.body;
    console.log('Evento recibido:', JSON.stringify(body));
    if (body.object === 'whatsapp_business_account') {
      return res.sendStatus(200);
    }
    return res.sendStatus(404);
  } catch (error) {
    console.error('Error webhook:', error.message);
    return res.sendStatus(500);
  }
});

module.exports = router;

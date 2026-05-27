const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.status(200).send('ELHYAI OK');
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true
  });
});

app.get('/webhook/meta', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

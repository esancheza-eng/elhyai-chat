const express = require("express");
require("dotenv").config();

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("ELHYAI OK");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verificado");
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }
});

app.post("/webhook", async (req, res) => {
  console.log("Mensaje recibido");

  try {
    const body = req.body;

    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages
    ) {
      const message =
        body.entry[0].changes[0].value.messages[0];

      const from = message.from;

      const token = process.env.WHATSAPP_TOKEN;
      const phone_number_id = process.env.PHONE_NUMBER_ID;

      const response = await fetch(
        `https://graph.facebook.com/v22.0/${phone_number_id}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            text: {
              body: "Hola Cristian 👋 Soy ELHYAI funcionando correctamente."
            }
          })
        }
      );

      const data = await response.json();

      console.log(data);
      console.log("Respuesta enviada");
    }

    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

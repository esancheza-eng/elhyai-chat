const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();

// Permite que el frontend en GitHub Pages (otro dominio) llame a este backend
app.use(cors());

// Aumentamos el límite de JSON porque los Excel en base64 pueden pesar varios MB
app.use(express.json({ limit: "25mb" }));

app.use((req, res, next) => { console.log('LLEGA:', req.method, req.path); next(); });

app.get("/", (req, res) => {
  res.send("ELHYAI OK");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

// ── Rutas de Campañas Masivas ──────────────────────────────
const campaignsRouter = require("./routes/campaigns");
app.use("/api/campaigns", campaignsRouter);

// ── Webhook de WhatsApp (bot conversacional) ───────────────
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

// System prompt: personalidad y contexto del bot conversacional.
const SYSTEM_PROMPT = `Eres el asistente virtual de ElhyAi Consultores & Educación Digital,
una consultora digital ecuatoriana. Respondes por WhatsApp de forma clara, cercana y profesional,
en español. Mantén las respuestas breves (máximo 3-4 líneas), ya que es un chat de WhatsApp.
Si te preguntan algo que no sabes o que requiere atención humana, indica que un asesor de
ElhyAi se pondrá en contacto pronto.`;

async function getOpenAIResponse(userMessage) {
  const apiKey = process.env.OPENAI_API_KEY;
  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ],
      max_tokens: 300,
      temperature: 0.7
    })
  });

  if (!openaiResponse.ok) {
    const errText = await openaiResponse.text();
    throw new Error(`OpenAI error ${openaiResponse.status}: ${errText}`);
  }

  const data = await openaiResponse.json();
  return data.choices[0].message.content.trim();
}

app.post("/webhook", async (req, res) => {
  console.log("Mensaje recibido");
  try {
    const body = req.body;
    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages
    ) {
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from;
      const userText = message.text ? message.text.body : "";

      const token = process.env.WHATSAPP_TOKEN;
      const phone_number_id = process.env.PHONE_NUMBER_ID;

      res.sendStatus(200);

      let replyText;
      try {
        replyText = await getOpenAIResponse(userText);
        console.log("Respuesta de OpenAI generada");
      } catch (aiError) {
        console.log("Error de OpenAI:", aiError.message);
        replyText = "Gracias por tu mensaje 🙌 En breve un asesor de ElhyAi te contactará.";
      }

      const response = await fetch(
        `https://graph.facebook.com/v25.0/${phone_number_id}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            text: { body: replyText }
          })
        }
      );
      const data = await response.json();
      console.log(data);
      console.log("Respuesta enviada");
    } else {
      res.sendStatus(200);
    }
  } catch (error) {
    console.log(error);
    if (!res.headersSent) res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

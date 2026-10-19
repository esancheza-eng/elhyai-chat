const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { db, admin } = require("./config/firebase");
const crypto = require("crypto");
const app = express();

// Guarda un mensaje en Firestore, bajo el documento del cliente (por teléfono).
// direccion: "entrante" (cliente -> nosotros) o "saliente" (nosotros -> cliente)
async function guardarMensaje({ telefono, nombre, texto, direccion, origen }) {
  try {
    const conversacionRef = db.collection("conversaciones").doc(telefono);

    await conversacionRef.set(
      {
        telefono,
        ...(nombre ? { nombre } : {}),
        ultimoMensaje: texto,
        ultimaActualizacion: admin.firestore.FieldValue.serverTimestamp(),
        ...(direccion === "entrante"
          ? { noLeido: true, ultimoEntrante: admin.firestore.FieldValue.serverTimestamp() }
          : {})
      },
      { merge: true }
    );

    await conversacionRef.collection("mensajes").add({
      texto,
      direccion,
      ...(origen ? { origen } : {}),
      fecha: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error("Error guardando mensaje en Firestore:", error.message);
  }
}

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

// ── Protección por clave de acceso ─────────────────────────
// Todas las rutas /api/* exigen el header "x-api-key" igual a la
// variable de entorno API_KEY (configurarla en Render).
// /webhook queda libre porque lo llama Meta; /health también.
function requireApiKey(req, res, next) {
  if (req.method === "OPTIONS") return next(); // preflight CORS
  const expected = process.env.API_KEY;
  if (!expected) {
    console.error("API_KEY no está configurada en las variables de entorno");
    return res.status(503).json({ ok: false, error: "El servidor no tiene API_KEY configurada" });
  }
  const received = req.get("x-api-key") || "";
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: "Clave de acceso inválida" });
  }
  next();
}
app.use("/api", requireApiKey);

// Ruta protegida para que las páginas verifiquen URL + clave
app.get("/api/ping", (req, res) => {
  res.json({ ok: true });
});

// ── Rutas de Campañas Masivas ──────────────────────────────
const campaignsRouter = require("./routes/campaigns");
app.use("/api/campaigns", campaignsRouter);

// ── Rutas de Conversaciones (inbox) ────────────────────────
const conversationsRouter = require("./routes/conversations");
app.use("/api/conversations", conversationsRouter);

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

// ── Asistente virtual (IA) ─────────────────────────────────
const asistente = require("./services/asistente");

const FALLBACK_TEXTO =
  "Gracias por su mensaje 🙌 En este momento no puedo responder, pero Christian le contestará personalmente lo antes posible.";
const FALLBACK_CADA_MS = 6 * 60 * 60 * 1000; // no repetir el aviso más de una vez cada 6 h

function tsToMs(ts) {
  return ts && ts.toDate ? ts.toDate().getTime() : 0;
}

// Envía un texto por WhatsApp y lo guarda en el hilo
async function enviarYGuardar(telefono, nombre, texto, origen) {
  const response = await fetch(
    `https://graph.facebook.com/v25.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to: telefono, text: { body: texto } })
    }
  );
  const data = await response.json();
  if (!response.ok) {
    console.error("WhatsApp no aceptó la respuesta:", JSON.stringify(data));
    return false;
  }
  await guardarMensaje({ telefono, nombre, texto, direccion: "saliente", origen });
  return true;
}

app.post("/webhook", async (req, res) => {
  // Respondemos a Meta de inmediato; el trabajo sigue en segundo plano
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return; // avisos de entregado/leído, etc.

    const from = message.from;
    const nombreCliente = value.contacts?.[0]?.profile?.name || null;

    // Texto del mensaje (o descripción si es foto, audio, documento...)
    let userText = "";
    let esArchivo = false;
    if (message.type === "text") {
      userText = message.text?.body || "";
    } else if (message.type === "interactive" || message.type === "button") {
      userText = message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
    } else {
      esArchivo = true;
      const tipos = { image: "📷 Imagen", audio: "🎤 Audio", video: "🎥 Video", document: "📄 Documento", sticker: "Sticker", location: "📍 Ubicación" };
      const caption = message[message.type]?.caption;
      userText = `[${tipos[message.type] || message.type}]${caption ? " " + caption : ""}`;
    }

    console.log("Mensaje recibido de", from, "tipo", message.type);
    await guardarMensaje({ telefono: from, nombre: nombreCliente, texto: userText, direccion: "entrante" });

    const ref = db.collection("conversaciones").doc(from);
    const conv = (await ref.get()).data() || {};

    // ¿Christian está atendiendo esta conversación? Entonces el bot no responde.
    if (tsToMs(conv.botPausadoHasta) > Date.now()) {
      console.log("Bot en pausa para", from);
      return;
    }

    // Fotos, audios, documentos (ej. comprobantes): el bot no los entiende → avisar a Christian
    if (esArchivo) {
      await ref.set({ requiereAtencion: true }, { merge: true });
      await enviarYGuardar(
        from,
        nombreCliente,
        "Recibí su archivo 👍 Christian lo revisará y le responderá personalmente lo antes posible.",
        "bot"
      );
      return;
    }

    // Memoria: últimos mensajes de la conversación (incluye el que acaba de llegar)
    const snap = await ref
      .collection("mensajes")
      .orderBy("fecha", "desc")
      .limit(asistente.MAX_HISTORIAL)
      .get();
    const historial = snap.docs.map((d) => d.data()).reverse();

    try {
      const { texto, escalar } = await asistente.responder(historial);
      if (escalar) await ref.set({ requiereAtencion: true }, { merge: true });
      await enviarYGuardar(from, nombreCliente, texto, "bot");
      console.log("Respuesta del asistente enviada", escalar ? "(requiere atención)" : "");
    } catch (aiError) {
      console.log("Error del asistente:", aiError.message);
      await ref.set({ requiereAtencion: true }, { merge: true });
      // Aviso de respaldo, sin repetirlo en cada mensaje
      if (Date.now() - tsToMs(conv.ultimoFallback) > FALLBACK_CADA_MS) {
        const ok = await enviarYGuardar(from, nombreCliente, FALLBACK_TEXTO, "bot");
        if (ok) await ref.set({ ultimoFallback: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
    }
  } catch (error) {
    console.error("Error en webhook:", error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

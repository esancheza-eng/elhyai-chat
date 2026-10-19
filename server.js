const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { db, admin } = require("./config/firebase");
const crypto = require("crypto");
const app = express();

// Guarda un mensaje en Firestore, bajo el documento del cliente (por teléfono).
// direccion: "entrante" (cliente -> nosotros) o "saliente" (nosotros -> cliente)
async function guardarMensaje({ telefono, nombre, texto, direccion, origen, media }) {
  try {
    const conversacionRef = db.collection("conversaciones").doc(telefono);

    await conversacionRef.set(
      {
        telefono,
        ...(nombre ? { nombre } : {}),
        ultimoMensaje: texto,
        ultimaActualizacion: admin.firestore.FieldValue.serverTimestamp(),
        ...(direccion === "entrante"
          ? { noLeido: true, ultimoEntrante: admin.firestore.FieldValue.serverTimestamp(), ultimoTextoEntrante: texto }
          : {})
      },
      { merge: true }
    );

    await conversacionRef.collection("mensajes").add({
      texto,
      direccion,
      ...(origen ? { origen } : {}),
      ...(media && media.id ? { mediaId: media.id, mediaTipo: media.tipo || "", mediaMime: media.mime || "", mediaNombre: media.nombre || "" } : {}),
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

// Descarga una foto/audio/documento que envió el cliente (para verlo en el panel)
app.get("/api/media/:id", async (req, res) => {
  try {
    const id = String(req.params.id).replace(/[^0-9]/g, "");
    if (!id) return res.status(400).json({ ok: false, error: "id inválido" });
    const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
    const info = await fetch(`https://graph.facebook.com/v25.0/${id}`, { headers: auth });
    const meta = await info.json();
    if (!info.ok || !meta.url) {
      return res.status(404).json({ ok: false, error: "El archivo ya no está disponible en WhatsApp" });
    }
    const archivo = await fetch(meta.url, { headers: auth });
    if (!archivo.ok) return res.status(502).json({ ok: false, error: "No se pudo descargar el archivo" });
    const buf = Buffer.from(await archivo.arrayBuffer());
    res.set("Content-Type", meta.mime_type || archivo.headers.get("content-type") || "application/octet-stream");
    res.set("Cache-Control", "private, max-age=86400");
    res.send(buf);
  } catch (error) {
    console.error("Error descargando archivo:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Rutas de Campañas Masivas ──────────────────────────────
const campaignsRouter = require("./routes/campaigns");
app.use("/api/campaigns", campaignsRouter);

// ── Rutas de Conversaciones (inbox) ────────────────────────
const conversationsRouter = require("./routes/conversations");
app.use("/api/conversations", conversationsRouter);

// ── Informe de campañas (solo lectura) ─────────────────────
const reportesRouter = require("./routes/reportes");
app.use("/api/reportes", reportesRouter);

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
const campaignsCtrl = require("./controllers/campaigns");

// Procesa los avisos de entrega de Meta (enviado / entregado / leído / fallido)
async function procesarEstados(statuses) {
  for (const st of statuses || []) {
    const err = st.errors && st.errors[0];
    const errorTexto = err
      ? `(${err.code}) ${err.title || err.message || ""}${err.error_data && err.error_data.details ? " – " + err.error_data.details : ""}`.trim()
      : null;

    if (st.status === "failed") {
      console.error(`❌ Meta NO entregó ${st.id} a ${st.recipient_id}: ${errorTexto}`);
    } else {
      console.log(`📬 Estado ${st.status} para ${st.recipient_id}`);
    }

    // Actualiza el registro de la campaña en curso (si el mensaje es de una campaña)
    campaignsCtrl.registrarEstado(st.id, st.status, errorTexto);

    // Guarda el estado en Firestore para consultarlo después
    try {
      await db.collection("estados_mensajes").doc(st.id).set(
        {
          estado: st.status,
          telefono: st.recipient_id || null,
          ...(errorTexto ? { error: errorTexto } : {}),
          actualizado: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    } catch (e) {
      console.error("No se pudo guardar el estado:", e.message);
    }
  }
}
const basico = require("./services/respuestas-basicas");
const botCobranza = require("./services/bot-cobranza");

// Modo del bot (variable BOT_MODO en Render):
//   "cobranza" (por defecto) → bot de cobranzas para todos
//   "hibrido"  → cobranza solo a clientes que recibieron una campaña; ElhyAi al resto
//   "elhyai"   → asistente de ElhyAi como antes
const BOT_MODO = (process.env.BOT_MODO || "cobranza").toLowerCase();
const PAUSA_GESTOR_MS = 12 * 60 * 60 * 1000;

async function atenderCobranza({ from, nombreCliente, userText, esArchivo, tipoMensaje, ref, conv, cliente }) {
  const r = botCobranza.responder({ texto: userText, esArchivo, tipoMensaje, cliente, conv });
  const cambios = { cobranzaPaso: r.paso || null };
  if (r.atender) cambios.requiereAtencion = true;
  if (r.etiqueta) cambios.etiquetaCobranza = r.etiqueta;
  if (r.pausar) cambios.botPausadoHasta = admin.firestore.Timestamp.fromMillis(Date.now() + PAUSA_GESTOR_MS);
  await ref.set(cambios, { merge: true });

  if (r.excluir) {
    await db.collection("cobranza_clientes").doc(from).set(
      { excluido: true, motivoExclusion: r.excluir, fechaExclusion: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
  if (r.promesa) {
    await db.collection("promesas_pago").add({
      telefono: from,
      nombre: (cliente && cliente.nombre) || nombreCliente || null,
      cobrador: (cliente && cliente.cobrador) || null,
      deuda: (cliente && cliente.deuda) || null,
      fechaPromesa: r.promesa.fechaTexto,
      fechaPromesaMs: r.promesa.fechaMs,
      campana: (cliente && cliente.campana) || null,
      creada: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  await enviarYGuardar(from, nombreCliente, r.texto, "bot");
  console.log("Bot cobranza →", from, r.etiqueta || "");
}

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
    if (value?.statuses) await procesarEstados(value.statuses);

    const message = value?.messages?.[0];
    if (!message) return; // solo eran avisos de entrega

    const from = message.from;
    const nombreCliente = value.contacts?.[0]?.profile?.name || null;

    // Texto del mensaje (o descripción si es foto, audio, documento...)
    let userText = "";
    let esArchivo = false;
    if (message.type === "text") {
      userText = message.text?.body || "";
    } else if (message.type === "interactive" || message.type === "button") {
      userText = message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
    } else if (message.type === "reaction" || message.type === "sticker") {
      // Reacción con emoji (👍❤️) o sticker: se guarda en el chat, pero el bot NO responde
      const emoji = message.reaction?.emoji || "";
      const txt = message.type === "reaction" ? `[Reacción ${emoji}]`.replace(" ]", "]") : "[Sticker]";
      if (message.type === "reaction" && !emoji) return; // el cliente quitó su reacción
      await guardarMensaje({ telefono: from, nombre: nombreCliente, texto: txt, direccion: "entrante" });
      console.log("Reacción/sticker de", from, "- sin respuesta del bot");
      return;
    } else {
      esArchivo = true;
      const tipos = { image: "📷 Imagen", audio: "🎤 Audio", video: "🎥 Video", document: "📄 Documento", sticker: "Sticker", location: "📍 Ubicación" };
      const caption = message[message.type]?.caption;
      userText = `[${tipos[message.type] || message.type}]${caption ? " " + caption : ""}`;
    }

    // Si es foto, audio, video o documento: guardamos el id del archivo
    // para poder verlo desde el panel (Meta lo conserva unos 30 días)
    const m = esArchivo ? message[message.type] : null;
    const media = m && m.id ? { id: m.id, tipo: message.type, mime: m.mime_type, nombre: m.filename } : null;

    console.log("Mensaje recibido de", from, "tipo", message.type);
    await guardarMensaje({ telefono: from, nombre: nombreCliente, texto: userText, direccion: "entrante", media });

    const ref = db.collection("conversaciones").doc(from);
    const conv = (await ref.get()).data() || {};

    // ¿Christian está atendiendo esta conversación? Entonces el bot no responde.
    if (tsToMs(conv.botPausadoHasta) > Date.now()) {
      console.log("Bot en pausa para", from);
      return;
    }

    // ── Bot de cobranzas ──
    if (BOT_MODO !== "elhyai") {
      let cliente = null;
      try {
        const cd = await db.collection("cobranza_clientes").doc(from).get();
        cliente = cd.exists ? cd.data() : null;
      } catch (e) {
        console.error("No se pudo leer cobranza_clientes:", e.message);
      }
      if (BOT_MODO === "cobranza" || cliente) {
        await atenderCobranza({ from, nombreCliente, userText, esArchivo, tipoMensaje: message.type, ref, conv, cliente });
        return;
      }
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
      // La IA no está disponible (sin saldo, error, etc.) → bot básico gratuito por menú
      console.log("Error del asistente:", aiError.message, "→ usando bot básico");
      try {
        const { texto, escalar } = basico.responder(userText, historial);
        if (escalar) await ref.set({ requiereAtencion: true }, { merge: true });
        await enviarYGuardar(from, nombreCliente, texto, "bot");
      } catch (basicError) {
        // Último recurso: aviso de respaldo, sin repetirlo en cada mensaje
        console.error("Error del bot básico:", basicError.message);
        await ref.set({ requiereAtencion: true }, { merge: true });
        if (Date.now() - tsToMs(conv.ultimoFallback) > FALLBACK_CADA_MS) {
          const ok = await enviarYGuardar(from, nombreCliente, FALLBACK_TEXTO, "bot");
          if (ok) await ref.set({ ultimoFallback: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
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

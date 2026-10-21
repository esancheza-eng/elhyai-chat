const express = require("express");
const router = express.Router();
const { db, admin } = require("../config/firebase");
const wa = require("../services/whatsapp");

// Convierte un Timestamp de Firestore a texto ISO (o null)
function toISO(ts) {
  return ts && ts.toDate ? ts.toDate().toISOString() : null;
}

const PAUSA_BOT_MS = 12 * 60 * 60 * 1000; // 12 horas

// Solo aceptamos teléfonos con dígitos (formato de WhatsApp: 593...)
function telefonoValido(t) {
  return /^[0-9]{8,15}$/.test(String(t || ""));
}

// ======================================================
// GET /api/conversations
// Devuelve la lista de clientes con su último mensaje,
// ordenados del más reciente al más antiguo.
// ======================================================
// Opcional: ?desde=<fecha ISO> devuelve SOLO las conversaciones que
// cambiaron después de esa fecha (ahorra lecturas de Firestore).
// Sin ?desde funciona igual que siempre (lista completa).
router.get("/", async (req, res) => {
  try {
    let consulta = db.collection("conversaciones");
    const desde = req.query.desde ? new Date(String(req.query.desde)) : null;
    const parcial = !!(desde && !isNaN(desde.getTime()));
    if (parcial) {
      // 2 s de margen para no perder cambios que llegan casi al mismo tiempo
      consulta = consulta.where("ultimaActualizacion", ">", admin.firestore.Timestamp.fromMillis(desde.getTime() - 2000));
    }
    const snapshot = await consulta
      .orderBy("ultimaActualizacion", "desc")
      .get();

    const conversaciones = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        telefono: doc.id,
        ...data,
        ultimaActualizacion: toISO(data.ultimaActualizacion),
        ultimoEntrante: toISO(data.ultimoEntrante),
        botPausadoHasta: toISO(data.botPausadoHasta),
        ultimoFallback: toISO(data.ultimoFallback)
      };
    });

    // Marca de tiempo del cambio más reciente: el panel la envía en la próxima consulta
    let cursor = parcial ? desde.toISOString() : null;
    conversaciones.forEach((c) => {
      if (c.ultimaActualizacion && (!cursor || c.ultimaActualizacion > cursor)) cursor = c.ultimaActualizacion;
    });

    res.json({ ok: true, conversaciones, cursor, parcial });
  } catch (error) {
    console.error("Error listando conversaciones:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ======================================================
// GET /api/conversations/:telefono
// Devuelve el hilo completo de mensajes de un cliente.
// ======================================================
router.get("/:telefono", async (req, res) => {
  try {
    const { telefono } = req.params;
    const snapshot = await db
      .collection("conversaciones")
      .doc(telefono)
      .collection("mensajes")
      .orderBy("fecha", "asc")
      .get();

    const mensajes = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        fecha: data.fecha && data.fecha.toDate ? data.fecha.toDate().toISOString() : null
      };
    });
    // Datos del cliente de cobranza (cédula, deuda, cobrador) si existen
    let cliente = null;
    try {
      const cd = await db.collection("cobranza_clientes").doc(telefono).get();
      if (cd.exists) {
        const c = cd.data();
        cliente = {
          nombre: c.nombreCompleto || c.nombre || "", cedula: c.cedula || "",
          deuda: c.deuda || 0, dias: c.dias || 0, mes: c.mes || "", saldoTotal: c.saldoTotal || 0,
          cobrador: c.cobrador || "", vendedor: c.vendedor || "", tienda: c.tienda || "",
          calMensual: c.calMensual || "", calRodamiento: c.calRodamiento || "", rodamiento: c.rodamiento || ""
        };
      }
    } catch (e) { /* sin datos extra */ }

    res.json({ ok: true, mensajes, cliente });
  } catch (error) {
    console.error("Error obteniendo hilo:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ======================================================
// POST /api/conversations/:telefono/leido
// Marca la conversación como leída (quita la etiqueta "nuevo").
// ======================================================
router.post("/:telefono/leido", async (req, res) => {
  try {
    const { telefono } = req.params;
    if (!telefonoValido(telefono)) {
      return res.status(400).json({ ok: false, error: "Teléfono inválido" });
    }
    await db.collection("conversaciones").doc(telefono).set({ noLeido: false }, { merge: true });
    res.json({ ok: true });
  } catch (error) {
    console.error("Error marcando como leído:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ======================================================
// POST /api/conversations/:telefono/responder
// Body: { texto }
// Envía una respuesta escrita por un agente y la guarda en el hilo.
// Ojo: WhatsApp solo permite texto libre si el cliente escribió
// en las últimas 24 horas; si no, Meta devuelve un error.
// ======================================================
// ======================================================
// POST /api/conversations/:telefono/archivo
// Body: { data (base64), mime, nombre, caption }
// Envía una FOTO (jpg/png) o un PDF al cliente desde el panel.
// Igual que el texto: solo dentro de las 24 h desde el último
// mensaje del cliente (si no, Meta exige plantilla).
// ======================================================
const TIPOS_ARCHIVO = {
  "image/jpeg": { tipo: "image", maxMB: 5, etiqueta: "📷 Imagen" },
  "image/png": { tipo: "image", maxMB: 5, etiqueta: "📷 Imagen" },
  "application/pdf": { tipo: "document", maxMB: 15, etiqueta: "📄 Documento" }
};

router.post("/:telefono/archivo", async (req, res) => {
  const { telefono } = req.params;
  const body = req.body || {};
  const mime = String(body.mime || "").toLowerCase();
  const info = TIPOS_ARCHIVO[mime];
  const nombre = String(body.nombre || "archivo").slice(0, 120);
  const caption = String(body.caption || "").trim().slice(0, 1024);

  if (!telefonoValido(telefono)) return res.status(400).json({ ok: false, error: "Teléfono inválido" });
  if (!info) return res.status(400).json({ ok: false, error: "Solo se pueden enviar fotos JPG/PNG o documentos PDF." });
  if (!body.data) return res.status(400).json({ ok: false, error: "No se recibió el archivo." });

  const buf = Buffer.from(String(body.data), "base64");
  if (!buf.length) return res.status(400).json({ ok: false, error: "El archivo está vacío." });
  if (buf.length > info.maxMB * 1024 * 1024) {
    return res.status(400).json({ ok: false, error: `El archivo supera ${info.maxMB} MB (límite de WhatsApp para este tipo).` });
  }

  try {
    wa.checkCredentials();
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.PHONE_NUMBER_ID;

    // 1) Subir el archivo a WhatsApp → devuelve un id
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mime);
    form.append("file", new Blob([buf], { type: mime }), nombre);
    const up = await fetch(`https://graph.facebook.com/v25.0/${phoneId}/media`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form
    });
    const upData = await up.json().catch(() => ({}));
    if (!up.ok || !upData.id) {
      const err = new Error((upData.error && upData.error.message) || "WhatsApp no aceptó el archivo");
      err.response = { data: upData };
      throw err;
    }

    // 2) Enviar el mensaje con ese archivo
    const contenido = info.tipo === "image"
      ? { id: upData.id, ...(caption ? { caption } : {}) }
      : { id: upData.id, filename: nombre, ...(caption ? { caption } : {}) };
    const env = await fetch(`https://graph.facebook.com/v25.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: telefono, type: info.tipo, [info.tipo]: contenido })
    });
    const envData = await env.json().catch(() => ({}));
    if (!env.ok) {
      const err = new Error((envData.error && envData.error.message) || "WhatsApp no aceptó el mensaje");
      err.response = { data: envData };
      throw err;
    }

    // 3) Guardar en el chat (se ve en el panel igual que las fotos que envía el cliente)
    const texto = `[${info.etiqueta}]${caption ? " " + caption : ""}`;
    const ref = db.collection("conversaciones").doc(telefono);
    await ref.set(
      {
        telefono,
        ultimoMensaje: texto,
        ultimaActualizacion: admin.firestore.FieldValue.serverTimestamp(),
        noLeido: false,
        requiereAtencion: false,
        botPausadoHasta: admin.firestore.Timestamp.fromMillis(Date.now() + PAUSA_BOT_MS)
      },
      { merge: true }
    );
    await ref.collection("mensajes").add({
      texto,
      direccion: "saliente",
      origen: "agente",
      mediaId: upData.id, mediaTipo: info.tipo, mediaMime: mime, mediaNombre: nombre,
      waMessageId: envData.messages && envData.messages[0] ? envData.messages[0].id : null,
      fecha: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ ok: true });
  } catch (error) {
    const metaError = error.response && error.response.data && error.response.data.error;
    const code = metaError && metaError.code;
    let mensaje = error.message;
    if (code === 131047) {
      mensaje = "Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite escribirle con una plantilla aprobada.";
    }
    console.error("Error enviando archivo del agente:", error.message);
    res.status(502).json({ ok: false, error: mensaje, codigoMeta: code || null });
  }
});

router.post("/:telefono/responder", async (req, res) => {
  const { telefono } = req.params;
  const texto = String((req.body && req.body.texto) || "").trim();

  if (!telefonoValido(telefono)) {
    return res.status(400).json({ ok: false, error: "Teléfono inválido" });
  }
  if (!texto) {
    return res.status(400).json({ ok: false, error: "El mensaje está vacío" });
  }
  if (texto.length > 4096) {
    return res.status(400).json({ ok: false, error: "El mensaje supera los 4096 caracteres que permite WhatsApp" });
  }

  try {
    wa.checkCredentials();
    const result = await wa.sendTextMessage(telefono, texto);

    const ref = db.collection("conversaciones").doc(telefono);
    await ref.set(
      {
        telefono,
        ultimoMensaje: texto,
        ultimaActualizacion: admin.firestore.FieldValue.serverTimestamp(),
        noLeido: false,
        requiereAtencion: false,
        // Si respondes tú, el bot se calla en esta conversación por 12 horas
        botPausadoHasta: admin.firestore.Timestamp.fromMillis(Date.now() + PAUSA_BOT_MS)
      },
      { merge: true }
    );
    await ref.collection("mensajes").add({
      texto,
      direccion: "saliente",
      origen: "agente",
      waMessageId: result && result.messages && result.messages[0] ? result.messages[0].id : null,
      fecha: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ ok: true });
  } catch (error) {
    const metaError = error.response && error.response.data && error.response.data.error;
    const code = metaError && metaError.code;
    let mensaje = error.message;
    if (code === 131047) {
      mensaje = "Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite responder con una plantilla aprobada.";
    } else if (code === 131030) {
      mensaje = "Con el número de prueba solo puedes escribir a números agregados como destinatarios en Meta.";
    }
    console.error("Error enviando respuesta del agente:", error.message);
    res.status(502).json({ ok: false, error: mensaje, codigoMeta: code || null });
  }
});

// ======================================================
// POST /api/conversations/:telefono/bot
// Body: { activo: true|false }
// Activa el bot en la conversación, o lo pausa 12 h ("Atender yo").
// ======================================================
router.post("/:telefono/bot", async (req, res) => {
  try {
    const { telefono } = req.params;
    if (!telefonoValido(telefono)) {
      return res.status(400).json({ ok: false, error: "Teléfono inválido" });
    }
    const activo = !!(req.body && req.body.activo);
    await db.collection("conversaciones").doc(telefono).set(
      {
        botPausadoHasta: activo
          ? admin.firestore.FieldValue.delete()
          : admin.firestore.Timestamp.fromMillis(Date.now() + PAUSA_BOT_MS)
      },
      { merge: true }
    );
    res.json({ ok: true, activo });
  } catch (error) {
    console.error("Error cambiando estado del bot:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;

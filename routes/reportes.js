const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

// ======================================================
// Informe de campañas: cruza el registro de cada campaña
// (colección "campanas") con las conversaciones de los
// clientes para saber quién recibió, leyó y respondió.
// Solo lectura: no modifica nada.
// ======================================================

function toMs(v) {
  if (!v) return 0;
  if (v.toDate) return v.toDate().getTime();
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}

function toISO(v) {
  const ms = toMs(v);
  return ms ? new Date(ms).toISOString() : null;
}

// Lee muchos documentos de "conversaciones" en bloques
async function leerConversaciones(telefonos) {
  const mapa = {};
  const unicos = [...new Set(telefonos.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 300) {
    const refs = unicos.slice(i, i + 300).map(t => db.collection("conversaciones").doc(t));
    const snaps = await db.getAll(...refs);
    snaps.forEach(s => { if (s.exists) mapa[s.id] = s.data(); });
  }
  return mapa;
}

// GET /api/reportes/campanas → lista de campañas (más recientes primero)
router.get("/campanas", async (req, res) => {
  try {
    const snap = await db.collection("campanas").orderBy("startedAt", "desc").limit(50).get();
    const campanas = snap.docs.map(d => {
      const c = d.data();
      const log = c.log || [];
      return {
        id: d.id,
        nombre: c.campaignName || d.id,
        inicio: c.startedAt || null,
        fin: c.finishedAt || null,
        enCurso: !!(c.running && !c.finishedAt),
        total: c.total || log.length,
        enviados: c.sent || 0,
        fallidos: c.failed || 0,
        plantilla: c.cfg && c.cfg.templateName ? c.cfg.templateName : null
      };
    });
    res.json({ ok: true, campanas });
  } catch (error) {
    console.error("Error listando campañas:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/reportes/campanas/:id → detalle por cliente
router.get("/campanas/:id", async (req, res) => {
  try {
    const doc = await db.collection("campanas").doc(String(req.params.id)).get();
    if (!doc.exists) return res.status(404).json({ ok: false, error: "Campaña no encontrada" });

    const c = doc.data();
    const log = c.log || [];
    const inicioMs = toMs(c.startedAt);

    // Datos extra del Excel (cobrador, tienda) si la campaña los guardó
    const extra = {};
    (c.clients || []).forEach(cl => { if (cl && cl.numero) extra[cl.numero] = cl; });

    const conv = await leerConversaciones(log.map(l => l.numero));

    const filas = log.map(l => {
      const cv = conv[l.numero] || {};
      const ultEntMs = toMs(cv.ultimoEntrante);
      const respondio = !!(ultEntMs && inicioMs && ultEntMs >= inicioMs);

      let estado;
      if (l.status !== "ok") estado = "fallido";
      else if (l.entrega === "failed") estado = "no_entregado";
      else if (l.entrega === "read") estado = "leido";
      else if (l.entrega === "delivered") estado = "entregado";
      else estado = "enviado";

      const ex = extra[l.numero] || {};
      return {
        nombre: l.nombre,
        numero: l.numero,
        deuda: l.deuda || 0,
        dias: l.dias || 0,
        cobrador: ex.cobrador || "",
        tienda: ex.tienda || "",
        estado,
        motivo: l.status !== "ok" ? (l.error || "") : (l.entregaError || ""),
        respondio,
        fechaRespuesta: respondio ? toISO(cv.ultimoEntrante) : null,
        ultimaRespuesta: respondio ? (cv.ultimoTextoEntrante || cv.ultimoMensaje || "") : "",
        atender: !!cv.requiereAtencion,
        horaEnvio: l.ts || ""
      };
    });

    res.json({
      ok: true,
      campana: {
        id: doc.id,
        nombre: c.campaignName || doc.id,
        inicio: c.startedAt || null,
        fin: c.finishedAt || null,
        enCurso: !!(c.running && !c.finishedAt),
        total: c.total || log.length,
        plantilla: c.cfg && c.cfg.templateName ? c.cfg.templateName : null
      },
      filas
    });
  } catch (error) {
    console.error("Error en informe de campaña:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;

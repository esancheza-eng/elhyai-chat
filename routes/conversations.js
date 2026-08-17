const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

// ======================================================
// GET /api/conversations
// Devuelve la lista de clientes con su último mensaje,
// ordenados del más reciente al más antiguo.
// ======================================================
router.get("/", async (req, res) => {
  try {
    const snapshot = await db.collection("conversaciones")
      .orderBy("ultimaActualizacion", "desc")
      .get();

    const conversaciones = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        telefono: doc.id,
        ...data,
        ultimaActualizacion: data.ultimaActualizacion && data.ultimaActualizacion.toDate
          ? data.ultimaActualizacion.toDate().toISOString()
          : null
      };
    });

    res.json({ ok: true, conversaciones });
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
    res.json({ ok: true, mensajes });
  } catch (error) {
    console.error("Error obteniendo hilo:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;

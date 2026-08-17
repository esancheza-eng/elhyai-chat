const admin = require("firebase-admin");

// Inicializa Firebase Admin usando variables de entorno de Render.
// La clave privada nunca queda escrita en el código, solo en el
// panel de Environment Variables de Render.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Render guarda los saltos de línea como "\n" literales, hay que
      // convertirlos de vuelta a saltos de línea reales.
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
    })
  });
}

const db = admin.firestore();

module.exports = { admin, db };

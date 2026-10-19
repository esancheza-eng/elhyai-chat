/**
 * Asistente virtual de WhatsApp (IA con OpenAI)
 * - Lee lo que "sabe" desde conocimiento.txt (editable en GitHub)
 * - Usa los últimos mensajes de la conversación como memoria
 * - Marca [ESCALAR] cuando necesita que Christian responda en persona
 */

const fs = require("fs");
const path = require("path");

const ARCHIVO_CONOCIMIENTO = path.join(__dirname, "..", "conocimiento.txt");
const MAX_HISTORIAL = 12; // mensajes anteriores que el asistente "recuerda"
const MARCA_ESCALAR = "[ESCALAR]";

// Lee el archivo de conocimiento (se vuelve a leer en cada despliegue de Render)
function cargarConocimiento() {
  try {
    return fs
      .readFileSync(ARCHIVO_CONOCIMIENTO, "utf8")
      .split("\n")
      .filter((linea) => !linea.trim().startsWith("#") || linea.trim().startsWith("##"))
      .join("\n")
      .trim();
  } catch (e) {
    console.error("No se pudo leer conocimiento.txt:", e.message);
    return "";
  }
}

const CONOCIMIENTO = cargarConocimiento();

const SYSTEM_PROMPT = `Eres el asistente virtual de Christian Sánchez Arreaga, fundador de ElhyAi Consultores & Educación Digital (Ecuador). Atiendes su WhatsApp cuando él no está disponible.

REGLAS:
1. Responde siempre en español, de "usted", con tono cordial y profesional.
2. Respuestas breves: máximo 4-5 líneas, porque es WhatsApp. Sin tablas ni formato complicado.
3. Preséntate como asistente virtual (no eres Christian ni una persona). En el primer mensaje de una conversación saluda así: "Hola, soy el asistente virtual de Christian Sánchez (ElhyAi)".
4. Usa SOLO la información de la sección CONOCIMIENTO. Nunca inventes precios, fechas, horarios, descuentos, cuentas bancarias ni datos que no estén ahí.
5. Si te preguntan algo que no está en el CONOCIMIENTO, o la persona quiere cotizar, contratar, pagar, enviar un comprobante, agendar una reunión o hablar con Christian: responde que Christian le contestará personalmente lo antes posible, pide los datos útiles (nombre, negocio, qué necesita) y termina tu respuesta con la marca ${MARCA_ESCALAR}
6. Si la persona menciona una deuda, un cobro o un saldo pendiente: no des montos ni negocies; dile que un asesor le responderá en breve y termina con ${MARCA_ESCALAR}
7. No hables de temas ajenos a ElhyAi (política, religión, otros negocios). Redirige con amabilidad.
8. Nunca compartas datos personales de otras personas ni información interna.

CONOCIMIENTO:
${CONOCIMIENTO}`;

// historial: [{ direccion: "entrante"|"saliente", texto }] en orden cronológico
async function responder(historial) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta OPENAI_API_KEY");

  const mensajes = historial
    .filter((m) => m.texto)
    .slice(-MAX_HISTORIAL)
    .map((m) => ({
      role: m.direccion === "entrante" ? "user" : "assistant",
      content: String(m.texto).replace(MARCA_ESCALAR, "").trim()
    }));

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...mensajes],
      max_tokens: 350,
      temperature: 0.3
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  let texto = (data.choices[0].message.content || "").trim();
  const escalar = texto.includes(MARCA_ESCALAR);
  texto = texto.split(MARCA_ESCALAR).join("").trim();
  return { texto, escalar };
}

module.exports = { responder, MAX_HISTORIAL };

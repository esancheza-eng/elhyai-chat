/**
 * Bot básico GRATUITO por palabras clave y menú.
 * Se usa cuando la IA (OpenAI) no está disponible (sin saldo, error, etc.).
 * Devuelve { texto, escalar } igual que el asistente con IA.
 */

const MENU = `Escriba el número de la opción:
1️⃣ Servicios
2️⃣ Diagnóstico empresarial GRATUITO
3️⃣ Cursos (ElhyAI Academy)
4️⃣ Sobre Christian Sánchez
5️⃣ Contacto
6️⃣ Hablar con Christian`;

const SALUDO = "Hola 👋 Soy el asistente virtual de Christian Sánchez (ElhyAi Consultores).";

const R = {
  servicios: {
    texto: `En ElhyAi Consultores ayudamos a empresas a crecer con estrategia, datos e inteligencia artificial:
• Estrategia empresarial y diagnóstico
• Dashboards y Business Intelligence
• Implementación de IA y automatización
• Transformación digital
• Desarrollo web, branding y contenido con IA
• Consultoría en recuperación de cartera
• Capacitación empresarial

Todos los proyectos se cotizan a medida. Más info: https://www.elhyai.com
Escriba 2 para un diagnóstico gratuito o 6 para hablar con Christian.`,
    escalar: false
  },
  diagnostico: {
    texto: `¡Con gusto! 📋 El diagnóstico empresarial inicial es GRATUITO.
Por favor envíeme en un solo mensaje:
• Nombre completo
• Empresa u organización
• Correo
• Qué le gustaría mejorar en su negocio

Christian le contactará personalmente para coordinar.`,
    escalar: true
  },
  cursos: {
    texto: `🎓 ElhyAI Academy: https://academy.elhyai.com
• Cursos online con videos (se ven desde el celular)
• Cursos presenciales para empresas, con certificado

El pago es por transferencia o depósito; los datos se los envía Christian personalmente. Escriba 6 si desea inscribirse.`,
    escalar: false
  },
  christian: {
    texto: `👤 Christian Sánchez Arreaga es fundador y Director General de ElhyAi Consultores:
• Más de 20 años de experiencia en estrategia, tecnología y sector financiero
• MBA – EUDE Business School (Madrid, España)
• Máster en Sistemas de Información, mención BI y Big Data (UNEMI)
• Certificaciones en IA de Google, Vanderbilt, UNAM y más
• Autor publicado en Amazon Kindle`,
    escalar: false
  },
  contacto: {
    texto: `📞 Contacto ElhyAi Consultores
• WhatsApp directo: +593 98 993 8910
• Correo: info@elhyai.com
• Web: https://www.elhyai.com
• Milagro, Guayas – Ecuador`,
    escalar: false
  },
  humano: {
    texto: "Perfecto 🙌 Le aviso a Christian para que le responda personalmente lo antes posible. Si desea, déjeme su consulta en un mensaje.",
    escalar: true
  },
  precio: {
    texto: "Los servicios y cursos se cotizan según lo que necesite 💼 Cuénteme brevemente qué busca (y el nombre de su negocio) y Christian le enviará la información personalmente.",
    escalar: true
  },
  pago: {
    texto: "Gracias 🙏 Christian revisará su consulta sobre pagos y le responderá personalmente lo antes posible.",
    escalar: true
  },
  gracias: {
    texto: "¡Con gusto! 😊 Si necesita algo más, escriba MENÚ para ver las opciones.",
    escalar: false
  }
};

function normalizar(t) {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Busca cada palabra al INICIO de una palabra del mensaje
// (así "ia" no coincide dentro de "gracias" o "días")
function tiene(t, palabras) {
  const conEspacio = " " + t;
  return palabras.some((p) => conEspacio.includes(" " + p));
}

// historial: mensajes de la conversación (para saber si ya saludamos)
function responder(textoCliente, historial = []) {
  const t = normalizar(textoCliente);
  const yaHabloElBot = historial.some((m) => m.direccion === "saliente" && m.origen === "bot");

  // Opciones por número
  const num = t.match(/^([1-6])\b/);
  if (num) {
    return [null, R.servicios, R.diagnostico, R.cursos, R.christian, R.contacto, R.humano][Number(num[1])];
  }

  // Palabras clave (el orden importa: lo más específico primero)
  if (tiene(t, ["precio", "costo", "cuanto", "cotiz", "tarifa", "valor"])) return R.precio;
  if (tiene(t, ["pago", "pague", "comprobante", "transferencia", "deposito", "deuda", "saldo", "cuota", "factura"])) return R.pago;
  if (tiene(t, ["diagnost", "gratis", "gratuito", "evaluacion"])) return R.diagnostico;
  if (tiene(t, ["curso", "academy", "capacitacion", "clase", "certificado", "aprender"])) return R.cursos;
  if (tiene(t, ["quien es", "christian", "experiencia", "estudio", "mba", "perfil"])) return R.christian;
  if (tiene(t, ["contacto", "correo", "email", "direccion", "donde", "ubicacion", "telefono", "llamar"])) return R.contacto;
  if (tiene(t, ["asesor", "humano", "persona", "hablar con", "atencion"])) return R.humano;
  if (tiene(t, ["servicio", "ofrecen", "hacen", "pagina web", "web", "dashboard", "ia", "inteligencia", "automatiz", "branding", "logo", "video", "cartera"])) return R.servicios;
  if (tiene(t, ["gracias", "ok", "listo", "perfecto", "excelente"])) return R.gracias;

  // Saludo o mensaje no reconocido → menú
  const esSaludo = tiene(t, ["hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "menu", "info", "informacion"]);
  if (esSaludo || !yaHabloElBot) {
    return { texto: `${SALUDO}\n¿En qué puedo ayudarle?\n\n${MENU}`, escalar: false };
  }
  return { texto: `No estoy seguro de haber entendido 🤔\n\n${MENU}`, escalar: false };
}

module.exports = { responder };

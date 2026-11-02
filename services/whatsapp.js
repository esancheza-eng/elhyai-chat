/**
 * WhatsApp Service
 * Funciones reales para enviar mensajes vía WhatsApp Cloud API (Graph API)
 */

const GRAPH_VERSION = 'v25.0';

function getConfig() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  return { token, phoneNumberId };
}

// Verifica que las credenciales existan antes de arrancar una campaña
function checkCredentials() {
  const { token, phoneNumberId } = getConfig();
  if (!token || !phoneNumberId) {
    throw new Error('Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID en las variables de entorno.');
  }
}

// Pausa asíncrona (usada para el delay entre mensajes y el control de pausa)
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Llamada base a la API de Graph
async function callGraphAPI(payload) {
  const { token, phoneNumberId } = getConfig();
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Error desconocido de WhatsApp API');
    error.response = { data };
    throw error;
  }

  return data;
}

// Envía un mensaje de texto libre (solo funciona dentro de la ventana de 24h
// de conversación abierta; para primer contacto usa sendTemplateMessage)
async function sendTextMessage(to, message) {
  return callGraphAPI({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message }
  });
}

// Construye el array "components" para una plantilla con variables de tipo body
// variables: array de strings en el orden en que aparecen {{1}} {{2}} {{3}} en la plantilla
function buildTemplateComponents(variables = []) {
  if (!variables.length) return [];
  return [
    {
      type: 'body',
      parameters: variables.map(v => ({ type: 'text', text: String(v) }))
    }
  ];
}

// Envía un mensaje usando una plantilla aprobada por Meta
async function sendTemplateMessage(to, templateName, languageCode = 'es', components = []) {
  return callGraphAPI({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components
    }
  });
}

// Plantillas de la cuenta de WhatsApp (WABA). WABA_ID en Render; si no está,
// se usa la cuenta de Marcimex Cobranzas.
const WABA_POR_DEFECTO = '2370806170073829';
async function listarPlantillas() {
  const { token } = getConfig();
  const waba = process.env.WABA_ID || WABA_POR_DEFECTO;
  if (!token) throw new Error('Falta WHATSAPP_TOKEN en las variables de entorno.');
  const r = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${waba}/message_templates?fields=name,language,status,category,components&limit=200`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) }
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = data && data.error;
    throw new Error((m && (m.error_user_msg || m.message)) || 'No se pudieron leer las plantillas de Meta');
  }
  return data.data || [];
}

module.exports = {
  listarPlantillas,
  checkCredentials,
  sleep,
  sendTextMessage,
  sendTemplateMessage,
  buildTemplateComponents
};

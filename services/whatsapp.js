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

module.exports = {
  checkCredentials,
  sleep,
  sendTextMessage,
  sendTemplateMessage,
  buildTemplateComponents
};

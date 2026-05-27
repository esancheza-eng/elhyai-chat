/**
 * WhatsApp Cloud API Service
 * Maneja todos los envíos a través de la API oficial de Meta
 */

const axios = require('axios');

const WA_API_URL = 'https://graph.facebook.com/v19.0';

/**
 * Enviar mensaje de TEXTO LIBRE
 * Solo funciona si el cliente escribió primero en las últimas 24h
 */
async function sendTextMessage(to, text) {
  const phoneId = process.env.PHONE_NUMBER_ID;
  const token   = process.env.WHATSAPP_TOKEN;

  // Normalizar número: quitar + y espacios
  const number = normalizePhone(to);

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                number,
    type:              'text',
    text: { body: text, preview_url: false },
  };

  const response = await axios.post(
    `${WA_API_URL}/${phoneId}/messages`,
    payload,
    {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  return response.data;
}

/**
 * Enviar PLANTILLA aprobada por Meta
 * Funciona para cualquier número (ventana de 24h no aplica)
 */
async function sendTemplateMessage(to, templateName, languageCode = 'es', components = []) {
  const phoneId = process.env.PHONE_NUMBER_ID;
  const token   = process.env.WHATSAPP_TOKEN;
  const number  = normalizePhone(to);

  const payload = {
    messaging_product: 'whatsapp',
    to:                number,
    type:              'template',
    template: {
      name:     templateName,
      language: { code: languageCode },
      components,
    },
  };

  const response = await axios.post(
    `${WA_API_URL}/${phoneId}/messages`,
    payload,
    {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  return response.data;
}

/**
 * Construir components de plantilla con variables dinámicas
 * Ej: variables = ['Juan', '$150.00', '30']
 */
function buildTemplateComponents(variables = []) {
  if (!variables.length) return [];
  return [{
    type:       'body',
    parameters: variables.map(v => ({ type: 'text', text: String(v) })),
  }];
}

/**
 * Normalizar número telefónico para API de Meta
 * Ecuador: 09XXXXXXXX → 5930XXXXXXXX → 593XXXXXXXXX
 */
function normalizePhone(phone) {
  let num = String(phone).replace(/\D/g, ''); // solo dígitos
  // Si empieza en 0 (local Ecuador): 09X → 593 9X
  if (num.startsWith('0') && num.length === 10) {
    num = '593' + num.slice(1);
  }
  // Si no tiene código de país (9 dígitos Ecuador)
  if (num.length === 9 && num.startsWith('9')) {
    num = '593' + num;
  }
  return num;
}

/**
 * Verificar que las credenciales están configuradas
 */
function checkCredentials() {
  const missing = [];
  if (!process.env.WHATSAPP_TOKEN)   missing.push('WHATSAPP_TOKEN');
  if (!process.env.PHONE_NUMBER_ID)  missing.push('PHONE_NUMBER_ID');
  if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
}

/**
 * Obtener info del número de WA Business
 */
async function getPhoneInfo() {
  checkCredentials();
  const phoneId = process.env.PHONE_NUMBER_ID;
  const token   = process.env.WHATSAPP_TOKEN;
  const r = await axios.get(
    `${WA_API_URL}/${phoneId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return r.data;
}

/**
 * Delay helper para evitar rate limit de Meta
 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  sendTextMessage,
  sendTemplateMessage,
  buildTemplateComponents,
  normalizePhone,
  checkCredentials,
  getPhoneInfo,
  sleep,
};

# ElhyAi Chat

Sistema de mensajería por **WhatsApp Business (Cloud API)** de ElhyAi Consultores.

- **Campañas masivas:** sube un Excel y envía plantillas aprobadas por Meta (cobranza o marketing).
- **Conversaciones:** panel para leer y responder a los clientes.
- **Asistente virtual:** responde con IA (OpenAI) o, si no está disponible, con un menú básico gratuito.

## Páginas (GitHub Pages)
- Menú: https://chat.elhyai.com/
- Campañas: https://chat.elhyai.com/campanas-masivas.html
- Conversaciones: https://chat.elhyai.com/conversaciones.html

## Backend (Render)
`https://elhyai-chat.onrender.com` — Node.js + Express + Firebase Admin (Firestore).

| Ruta | Uso |
|---|---|
| `GET/POST /webhook` | Webhook de Meta (mensajes y estados de entrega) |
| `/api/campaigns/*` | Campañas masivas (requiere `x-api-key`) |
| `/api/conversations/*` | Panel de conversaciones (requiere `x-api-key`) |

## Variables de entorno (Render)
Ver `.env.example`: `API_KEY`, `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `VERIFY_TOKEN`,
`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `OPENAI_API_KEY`.

## Archivos principales
- `server.js` — servidor, webhook y protección por clave.
- `controllers/campaigns.js` — envío de campañas, guardado en Firestore.
- `routes/` — rutas de campañas y conversaciones.
- `services/` — WhatsApp, asistente con IA y bot básico.
- `conocimiento.txt` — lo que sabe el asistente (editable).

## Colecciones de Firestore
`conversaciones`, `campanas`, `estados_mensajes`.

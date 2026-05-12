{
  "name": "elhyai-chat-backend",
  "version": "1.0.0",
  "description": "ElhyAi Chat — Backend WhatsApp + OpenAI + Firebase",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev":   "nodemon server.js"
  },
  "dependencies": {
    "axios":          "^1.6.0",
    "cors":           "^2.8.5",
    "dotenv":         "^16.3.1",
    "express":        "^4.18.2",
    "firebase-admin": "^11.11.0",
    "openai":         "^4.20.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}

const axios = require('axios');

module.exports = {
  async sendMessage(to, message) {
    console.log('Mensaje enviado:', to, message);
    return true;
  }
};

const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/campaigns');

// Parsear Excel subido como base64
router.post('/parse',   ctrl.parseExcel);

// Control de campaña
router.post('/start',   ctrl.startCampaign);
router.post('/pause',   ctrl.pauseCampaign);
router.post('/resume',  ctrl.resumeCampaign);
router.post('/stop',    ctrl.stopCampaign);

// Estado y log
router.get('/status',  ctrl.getStatus);
router.get('/log',     ctrl.getLog);

module.exports = router;

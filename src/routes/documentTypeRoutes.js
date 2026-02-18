const express = require('express');
const router = express.Router();
const controller = require('../controllers/documentTypeController');

router.get('/', controller.getAllDocumentTypes);
router.post('/', controller.createDocumentType);

module.exports = router;
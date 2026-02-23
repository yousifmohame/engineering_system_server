// server/src/routes/quotationTemplateRoutes.js
const express = require('express');
const router = express.Router();
const templateController = require('../controllers/quotationTemplateController');

router.get('/', templateController.getTemplates);
router.post('/', templateController.saveTemplate);
router.patch('/:id/toggle-status', templateController.toggleTemplateStatus);
router.patch('/:id/set-default', templateController.setAsDefault);

module.exports = router;
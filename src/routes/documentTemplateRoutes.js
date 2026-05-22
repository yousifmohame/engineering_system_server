const express = require('express');
const router = express.Router();
const docTemplateController = require('../controllers/documentTemplateController');

router.get('/', docTemplateController.getAllTemplates);
router.get('/:id', docTemplateController.getTemplateById);
router.post('/', docTemplateController.createTemplate);
router.put('/:id', docTemplateController.updateTemplate);
router.delete('/:id', docTemplateController.deleteTemplate);

module.exports = router;
// server/src/routes/quotationTemplateRoutes.js
const express = require('express');
const router = express.Router();
const templateController = require('../controllers/quotationTemplateController');

// المسارات الأساسية للنماذج
router.get('/', templateController.getTemplates);                 // جلب الكل
router.post('/', templateController.createTemplate);              // إنشاء جديد
router.get('/:id', templateController.getTemplateById);           // جلب نموذج واحد للتعديل
router.put('/:id', templateController.updateTemplate);            // حفظ التعديلات
router.delete('/:id', templateController.deleteTemplate);         // الحذف

// المسارات الإضافية لحالة النموذج
router.patch('/:id/toggle-status', templateController.toggleTemplateStatus); // التفعيل والتعطيل
router.patch('/:id/set-default', templateController.setAsDefault);           // التعيين كافتراضي

module.exports = router;
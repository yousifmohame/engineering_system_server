// server/src/routes/quotationTemplateRoutes.js
const express = require('express');
const router = express.Router();
const templateController = require('../controllers/quotationTemplateController');

// قم باستيراد الـ Middleware الخاص بك للتحقق من التوكن (مثال: protect أو authenticate)
// const { protect } = require('../middleware/authMiddleware');

// لتطبيق الحماية (أزل التعليق عن كلمة protect في حال تفعيلها في مشروعك)
// مسارات القراءة والإضافة (الأساسية)
router.get('/', /* protect, */ templateController.getTemplates);
router.post('/', /* protect, */ templateController.createTemplate);
router.get('/:id', /* protect, */ templateController.getTemplateById);

// مسارات التعديل والحذف
router.put('/:id', /* protect, */ templateController.updateTemplate);
router.delete('/:id', /* protect, */ templateController.deleteTemplate);

// المسارات الإضافية الخاصة بالحالة
router.patch('/:id/toggle-status', /* protect, */ templateController.toggleTemplateStatus);
router.patch('/:id/set-default', /* protect, */ templateController.setAsDefault);

// المسارات الجديدة (النسخ والتجميد)
router.post('/:id/duplicate', /* protect, */ templateController.duplicateTemplate);
router.patch('/:id/freeze', /* protect, */ templateController.toggleFreezeTemplate);

module.exports = router;
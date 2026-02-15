const express = require('express');
const router = express.Router();
const {
  getSystemSettings,
  getRequestPurposes,
  createRequestPurpose,
  updateRequestPurpose,
  deleteRequestPurpose,
  getFormDefinition,
  createFormField,
  updateFormField,
  deleteFormField,
  getFormForRender
} = require('../controllers/settingsController');

// ===============================================
// 1. إعدادات النظام
// ===============================================

// جلب إعدادات النظام (شاشة 300)
router.get('/system', getSystemSettings);

// ===============================================
// 2. إدارة أغراض الطلبات (المختصرة والتفصيلية)
// ===============================================

// جلب جميع أغراض الطلبات (مع فلترة بالنوع)
router.get('/request-purposes', getRequestPurposes);

// إنشاء غرض طلب جديد
router.post('/request-purposes', createRequestPurpose);

// تعديل غرض طلب
router.put('/request-purposes/:id', updateRequestPurpose);

// حذف غرض طلب
router.delete('/request-purposes/:id', deleteRequestPurpose);

// ===============================================
// 3. إدارة "منشئ النماذج" الديناميكي (للمدير - شاشة 701)
// ===============================================

// جلب تعريف النموذج وحقوله لغرض معين (لفتح "منشئ النماذج")
router.get('/purposes/:purposeId/form', getFormDefinition);

// إنشاء حقل جديد داخل نموذج
router.post('/forms/:formId/fields', createFormField);

// تعديل حقل موجود
router.put('/fields/:fieldId', updateFormField);

// حذف حقل
router.delete('/fields/:fieldId', deleteFormField);

// ===============================================
// 4. عرض النموذج الديناميكي (للمستخدم - شاشات 284/286)
// ===============================================

// جلب تعريف النموذج للعرض (للقراءة فقط)
router.get('/forms/:purposeId/render', getFormForRender);


module.exports = router;
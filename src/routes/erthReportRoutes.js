// routes/erthReportRoutes.js
const express = require('express');
const router = express.Router();

const {
  createReport,
  cloneReport,
  issueReportVersion,
  toggleLock,
  toggleFreeze,
  softDeleteReport,
  restoreReport,
  getAllReports,
  getReportById
} = require('../controllers/erthReportController');

// ============================================================================
// 🚀 مسارات منظومة التقارير الفنية (Erth Reports)
// ============================================================================

// 1. إنشاء واستنساخ التقارير
router.post('/', createReport);                         // إنشاء تقرير جديد (مسودة)
router.post('/clone', cloneReport);                     // استنساخ تقرير من تقرير سابق

// 2. جلب البيانات (الاستعلامات)
router.get('/', getAllReports);                         // جلب قائمة التقارير (مع الإحصائيات)
router.get('/:id', getReportById);                      // جلب تفاصيل تقرير معين

// 3. الاعتماد والإصدار
router.post('/:id/issue', issueReportVersion);          // إصدار التقرير النهائي (Snapshot)

// 4. الحوكمة (القفل والتجميد)
router.patch('/:id/lock', toggleLock);                  // قفل / فك قفل التقرير
router.patch('/:id/freeze', toggleFreeze);              // تجميد / فك تجميد التقرير

// 5. دورة حياة التقرير (الحذف والاسترجاع)
router.delete('/:id', softDeleteReport);                // الحذف الناعم (نقل للمحذوفات)
router.patch('/:id/restore', restoreReport);            // استرجاع التقرير من المحذوفات

module.exports = router;
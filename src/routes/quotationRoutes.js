// routes/quotationRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// استيراد الوظائف من الـ Controller
const {
  createQuotation,
  getAllQuotations,
  getQuotationById,
  updateQuotation,
  deleteQuotation,
} = require('../controllers/quotationController');

// حماية جميع مسارات عروض الأسعار
router.use(protect);

// GET /api/quotations  -> جلب كل عروض الأسعار
// POST /api/quotations -> إنشاء عرض سعر جديد
router.route('/')
  .get(getAllQuotations)
  .post(createQuotation);

// GET /api/quotations/:id    -> جلب عرض سعر واحد
// PUT /api/quotations/:id    -> تحديث عرض سعر
// DELETE /api/quotations/:id -> حذف عرض سعر
router.route('/:id')
  .get(getQuotationById)
  .put(updateQuotation)
  .delete(deleteQuotation);

module.exports = router;
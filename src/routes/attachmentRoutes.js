// routes/attachmentRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware'); // وسيط الرفع
const {
  uploadFile,
  getAttachmentsForTransaction,
  deleteAttachment,
  uploadAttachment
} = require('../controllers/attachmentController');

// حماية جميع المسارات
router.use(protect);

// ===============================================
// مسار الرفع (يستخدم وسيط الرفع + وسيط الحماية)
// 'file' هو اسم الحقل في الـ form-data
// ===============================================
router.post(
  '/upload',
  protect, // (لحماية المسار)
  upload.single('file'), // (لاستقبال ملف واحد اسمه 'file')
  uploadAttachment
);

// ===============================================
// مسار جلب مرفقات معاملة
// ===============================================
router.route('/transaction/:transactionId')
  .get(getAttachmentsForTransaction);

// ===============================================
// مسار حذف مرفق
// ===============================================
router.route('/:id')
  .delete(deleteAttachment);
  
module.exports = router;
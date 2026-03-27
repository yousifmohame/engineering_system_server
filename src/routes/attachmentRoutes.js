const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

// 👈 إضافة uploadGeneralFile للاستيراد
const {
  uploadFile,
  getAttachmentsForTransaction,
  deleteAttachment,
  uploadAttachment,
  uploadGeneralFile,
} = require("../controllers/attachmentController");

// حماية جميع المسارات
router.use(protect);

// مسار الرفع القديم
router.post("/upload", upload.single("file"), uploadAttachment);

// ===============================================
// 💡 المسار الجديد: للرفع العام الحر (يستخدم في الرخص)
// POST /api/attachments/upload-general
// ===============================================
router.post("/upload-general", upload.single("file"), uploadGeneralFile);

// مسار جلب مرفقات معاملة
router.route("/transaction/:transactionId").get(getAttachmentsForTransaction);

// مسار حذف مرفق
router.route("/:id").delete(deleteAttachment);

module.exports = router;

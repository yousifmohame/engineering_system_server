const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware"); // تأكد من مسار حماية الروتس الخاص بك
const multer = require("multer");
const path = require("path");

// ==================================================
// إعداد Multer لرفع ملفات ومرفقات المالية (التسويات)
// ==================================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/finance/"); // تأكد من إنشاء مجلد uploads/finance
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// ==================================================
// استدعاء الدوال من الكنترولر
// ==================================================
const {
  createSettlement,
  deliverSettlement,
  recordInventory,
} = require("../controllers/financeController");

// حماية جميع المسارات (يجب أن يكون المستخدم مسجل الدخول)
router.use(protect);

// 1. تسجيل تسوية (إنشاء مستحق جديد)
router.post("/settlements", createSettlement);

// 2. تسليم تسوية (دفع فعلي مع إمكانية إرفاق صورة)
router.post("/settlements/deliver", upload.single("file"), deliverSettlement);

// 3. جرد (خزنة أو حساب بنكي)
router.post("/inventory", recordInventory);

module.exports = router;
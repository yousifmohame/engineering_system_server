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
  getMonthlySettlementData,
  executeMonthlySettlement,
  getOutsourceSalaries,
  createOutsourceSalary,
  getOutsourcePayments,
  createOutsourcePayment,
  getPersonStatement,
  executeNetting,
  createExpense // 👈 تمت إضافة هذه الدالة تحسباً لاستخدامها
} = require("../controllers/financeController");

// حماية جميع المسارات (يجب أن يكون المستخدم مسجل الدخول)
router.use(protect);

// ==================================================
// 💡 المسارات الجديدة التي يبحث عنها الفرونت إند
// ==================================================

// 1. مسار تسجيل الدفعات السريعة (الذي كان يعطي 404)
router.post("/payments", upload.single("file"), deliverSettlement);

// 2. مسار تسجيل المصروفات العامة (إضافي للحماية)
router.post("/expenses", upload.single("file"), createExpense);

// ==================================================
// المسارات السابقة
// ==================================================

// 1. تسجيل تسوية (إنشاء مستحق جديد)
router.post("/settlements", createSettlement);

router.get("/monthly-settlement", getMonthlySettlementData);
router.post("/monthly-settlement/execute", executeMonthlySettlement);

// مسارات رواتب المتعاونين الخارجيين
router.get("/outsource-salaries", getOutsourceSalaries);
router.post("/outsource-salaries", createOutsourceSalary);
router.get("/outsource-payments", getOutsourcePayments);
router.post("/outsource-payments", createOutsourcePayment);

// 2. تسليم تسوية (دفع فعلي مع إمكانية إرفاق صورة)
router.post("/settlements/deliver", upload.single("file"), deliverSettlement);

// 3. جرد (خزنة أو حساب بنكي)
router.post("/inventory", recordInventory);

// 4. كشف الحساب والمقاصة
router.get("/statement/:personId", getPersonStatement);
router.post("/netting", executeNetting);

module.exports = router;
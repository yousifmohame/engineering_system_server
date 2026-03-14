const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const fs = require("fs");
const path = require("path"); // 👈 1. استيراد مكتبة المسارات لمعرفة صيغة الملف

// =================================================================
// 💡 إعدادات الحفظ الاحترافية للمرفقات العامة (تحافظ على الـ Extension)
// =================================================================
const receiptsStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "uploads/receipts/";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // إنشاء اسم فريد يدمج الوقت العشوائي مع صيغة الملف الأصلية (.pdf, .jpg)
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: receiptsStorage });

// =================================================================
// 💡 إعدادات الحفظ لمرفقات حالات المعاملة
// =================================================================
const statusStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const statusDir = "uploads/status_notes/";
    if (!fs.existsSync(statusDir)) fs.mkdirSync(statusDir, { recursive: true });
    cb(null, statusDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const uploadStatusNote = multer({ storage: statusStorage });

// =================================================================

const {
  createPrivateTransaction,
  getPrivateTransactions,
  addPrivatePayment,
  deletePrivatePayment,
  addTransactionAttachment,
  addCollectionDate,
  getDashboardStats,
  assignAgentToTransaction,
  deletePrivateTransaction,
  toggleFreezeTransaction,
  assignBrokerToTransaction,
  removeBrokerFromTransaction,
  updateTransactionStatus,
  updatePrivateTransaction,
  addPrivateExpense,
  deleteCollectionDate,
} = require("../controllers/privateTransactionController");

router.use(protect);

router.get("/dashboard-stats", getDashboardStats);

router.post("/", createPrivateTransaction);
router.get("/", getPrivateTransactions);

// 💡 مسارات التحصيلات (Payments)
// ملاحظة: نستخدم upload.single("file") إذا كان الفرونت يرسله باسم file
router.post("/payments", upload.single("file"), addPrivatePayment);
router.delete("/payments/:id", deletePrivatePayment);

router.post("/:id/brokers", assignBrokerToTransaction);
router.delete("/brokers/:brokerRecordId", removeBrokerFromTransaction);
router.post("/:id/agents", assignAgentToTransaction);

// 💡 تحديث حالة المعاملة (يستقبل أي ملفات مرسلة)
router.post(
  "/:id/status",
  uploadStatusNote.any(), // 👈 التعديل هنا مهم جداً لاستقبال مصفوفة الملفات
  updateTransactionStatus
);
router.put("/:id", updatePrivateTransaction);
router.delete("/:id", deletePrivateTransaction);
router.patch("/:id/toggle-freeze", toggleFreezeTransaction);
router.post("/:id/expenses", addPrivateExpense);

// 💡 مسار رفع المرفقات (تستقبل ملف باسم files كما كتبناه في الفرونت)
router.post(
  "/:id/attachments",
  upload.single("files"),
  addTransactionAttachment,
);

// 💡 مسار مواعيد التحصيل
router.post("/:id/collection-dates", addCollectionDate);
router.delete("/:id/collection-dates/:dateId", deleteCollectionDate); // 👈 المسار الجديد
module.exports = router;

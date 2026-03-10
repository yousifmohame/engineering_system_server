const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const fs = require("fs");

// التأكد من وجود المجلد
const dir = "uploads/receipts/";
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const upload = multer({ dest: dir });

const {
  createPrivateTransaction,
  getPrivateTransactions,
  addPrivatePayment,
  deletePrivatePayment, // 👈 استيراد
  addTransactionAttachment, // 👈 استيراد
  addCollectionDate, // 👈 استيراد
  getDashboardStats,
  assignAgentToTransaction,
  deletePrivateTransaction,
  toggleFreezeTransaction,
  assignBrokerToTransaction,
  removeBrokerFromTransaction
} = require("../controllers/privateTransactionController");

router.use(protect);

router.get("/dashboard-stats", getDashboardStats);

router.post("/", createPrivateTransaction);
router.get("/", getPrivateTransactions);

// 💡 مسارات التحصيلات (Payments)
router.post("/payments", upload.single("file"), addPrivatePayment);
router.delete("/payments/:id", deletePrivatePayment); // 👈 مسار حذف التحصيل
router.post("/:id/brokers", assignBrokerToTransaction); // لإضافة الوسيط
router.delete("/brokers/:brokerRecordId", removeBrokerFromTransaction); // لحذف الوسيط
router.post("/:id/agents", assignAgentToTransaction);
// 💡 مسارات المعاملة المحددة (Specific Transaction Actions)
router.delete("/:id", deletePrivateTransaction);
router.patch("/:id/toggle-freeze", toggleFreezeTransaction);

// 💡 مسار رفع المرفقات (تستقبل ملف array أو single حسب الفرونت)
router.post(
  "/:id/attachments",
  upload.single("files"),
  addTransactionAttachment,
);

// 💡 مسار مواعيد التحصيل
router.post("/:id/collection-dates", addCollectionDate);

module.exports = router;

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

// =================================================================
// 1. إعدادات الحفظ للإيصالات (Receipts)
// =================================================================
const receiptsStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "uploads/receipts/";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: receiptsStorage });

// =================================================================
// 2. إعدادات الحفظ لحالات المعاملة
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
// 🚀 3. إعدادات الحفظ لمرفقات المعاملات وملاحظات الجهات (التعديل الجديد)
// =================================================================
const transactionsStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const transDir = "uploads/transactions/"; // 👈 يتطابق مع المسار في الكنترولر
    if (!fs.existsSync(transDir)) fs.mkdirSync(transDir, { recursive: true });
    cb(null, transDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const uploadTransaction = multer({ storage: transactionsStorage }); // 👈 إنشاء ميدل وير جديد
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
  assignTask,
  submitTask,
  deleteTask,
  addAuthorityNote,
  updateAuthorityNote,
  deleteAuthorityNote,
} = require("../controllers/privateTransactionController");

router.use(protect);

router.get("/dashboard-stats", getDashboardStats);

router.post("/", createPrivateTransaction);
router.get("/", getPrivateTransactions);

router.post("/payments", upload.single("file"), addPrivatePayment);
router.delete("/payments/:id", deletePrivatePayment);

router.post("/:id/brokers", assignBrokerToTransaction);
router.delete("/brokers/:brokerRecordId", removeBrokerFromTransaction);
router.post("/:id/agents", assignAgentToTransaction);

router.post("/:id/status", uploadStatusNote.any(), updateTransactionStatus);
router.put("/:id", uploadTransaction.any(), updatePrivateTransaction);
router.delete("/:id", deletePrivateTransaction);
router.patch("/:id/toggle-freeze", toggleFreezeTransaction);
router.post("/:id/expenses", addPrivateExpense);

// مسار رفع المرفقات
router.post(
  "/:id/attachments",
  upload.single("files"),
  addTransactionAttachment,
);

router.post("/:id/collection-dates", addCollectionDate);
router.delete("/:id/collection-dates/:dateId", deleteCollectionDate);

router.post("/:id/tasks", assignTask);
router.post("/:id/tasks/:taskId/submit", upload.single("file"), submitTask);
router.delete("/:id/tasks/:taskId", deleteTask);

// 🚀 استخدام الميدل وير الجديد (uploadTransaction) هنا:
router.post(
  "/:id/authority-notes",
  uploadTransaction.single("file"),
  addAuthorityNote,
);
router.put(
  "/:id/authority-notes/:noteId",
  uploadTransaction.single("file"),
  updateAuthorityNote,
);
router.delete("/:id/authority-notes/:noteId", deleteAuthorityNote);

module.exports = router;

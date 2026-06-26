const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");

// إعداد التخزين للمرفقات المالية
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/vaults/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// استدعاء الدوال من المتحكم
const {
  getAllVaults,
  createVault,
  getVaultTransactions,     // 👈 دالة جديدة لجلب الحركات
  createVaultTransaction,
  cancelTransaction,        // 👈 دالة جديدة لإلغاء القيد
  createExternalDeal,
  executeSettlement,
  getVaultAuditLogs
} = require("../controllers/cashVaultController");

router.use(protect);

// ==========================================
// مسارات الخزن (Cash Vaults)
// ==========================================
router.get("/cash-vaults", getAllVaults);
router.post("/cash-vaults", createVault);
router.get("/cash-vaults/:id/transactions", getVaultTransactions); // جلب حركات خزنة معينة
// جلب سجل التدقيق التاريخي للخزنة
router.get("/cash-vaults/:id/logs", getVaultAuditLogs);
// ==========================================
// مسارات الحركات المالية (Transactions)
// ==========================================
router.post("/transactions", upload.array("files", 5), createVaultTransaction);
router.post("/transactions/:id/cancel", cancelTransaction); // إلغاء حركة (قيد عكسي)

// ==========================================
// مسارات المعاملات الخارجية (External Deals)
// ==========================================
router.post("/external-deals", createExternalDeal);

// ==========================================
// مسارات التسويات وتصفية الأرباح (Settlements)
// ==========================================
router.post("/settlements/approve", executeSettlement);

module.exports = router;
// routes/tailscaleRoutes.js
const express = require("express");
const router = express.Router();
// استدعِ الميدل وير الخاص بالتحقق من تسجيل الدخول وصلاحيات الإدمن (عدل المسار حسب مشروعك)
const { protect } = require("../middleware/authMiddleware");

const {
  getConfig,
  saveConfig,
  testConnection,
  getProvisioningCommand,
} = require("../controllers/tailscaleController");

// حماية مسارات الإعدادات بحيث لا يدخلها إلا الأدمن
router.get("/", protect, getConfig);
router.post("/", protect, saveConfig);
router.get("/test", protect, testConnection);

// مسار الـ provision سنحميه بطريقة مختلفة (انظر الخطوة 2)
router.get("/provision", getProvisioningCommand);

module.exports = router;

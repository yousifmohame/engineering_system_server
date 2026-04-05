// routes/tailscaleRoutes.js
const express = require("express");
const router = express.Router();
// استدعِ الميدل وير الخاص بالتحقق من تسجيل الدخول وصلاحيات الإدمن (عدل المسار حسب مشروعك)


const {
  getConfig,
  saveConfig,
  testConnection,
  getProvisioningCommand,
} = require("../controllers/tailscaleController");

// حماية مسارات الإعدادات بحيث لا يدخلها إلا الأدمن
router.get("/", getConfig);
router.post("/", saveConfig);
router.get("/test", testConnection);

// مسار الـ provision سنحميه بطريقة مختلفة (انظر الخطوة 2)
router.get("/provision", getProvisioningCommand);

module.exports = router;

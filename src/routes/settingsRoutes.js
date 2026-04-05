const express = require("express");
const router = express.Router();


// استيراد دوال الكنترولر
const {
  getSettings,
  updateSettings,
} = require("../controllers/settingsController");

// حماية جميع مسارات الإعدادات (يجب أن يكون المستخدم مسجلاً للدخول)


// 1. مسار جلب إعدادات النظام
// GET /api/settings
router.get("/", getSettings);

// 2. مسار تحديث إعدادات النظام
// PUT /api/settings
router.put("/", updateSettings);

module.exports = router;
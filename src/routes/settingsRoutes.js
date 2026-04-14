const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// إعداد Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, "../../uploads/system");
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });
// استيراد دوال الكنترولر
const {
  getSettings,
  updateSettings,
  getSidebarSettings,
  updateSidebarSettings,
} = require("../controllers/settingsController");

// حماية جميع مسارات الإعدادات (يجب أن يكون المستخدم مسجلاً للدخول)

// 1. مسار جلب إعدادات النظام
// GET /api/settings
router.get("/", getSettings);

// 2. مسار تحديث إعدادات النظام
// PUT /api/settings
router.put("/", updateSettings);

// أضف هذه المسارات الجديدة
router.get("/sidebar", getSidebarSettings);
router.put("/sidebar", updateSidebarSettings);
router.post("/upload-logo", upload.single("logo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "لم يتم رفع أي ملف" });
  res.json({ logoUrl: `/uploads/system/${req.file.filename}` });
});

module.exports = router;

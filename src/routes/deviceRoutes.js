const express = require("express");
const router = express.Router();
const deviceController = require("../controllers/deviceController");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ==========================================
// 🚀 إعداد Multer لمعالجة ورفع الملفات
// ==========================================
const uploadDir = path.join(__dirname, "../../uploads/devices"); // مسار حفظ الملفات داخل مجلد المشروع
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true }); // إنشاء المجلد تلقائياً إذا لم يكن موجوداً
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // إنشاء اسم فريد للملف لمنع تداخل الأسماء
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, "dev-doc-" + uniqueSuffix + path.extname(file.originalname));
  }
});

// فلترة حجم الملف (مثلاً الحد الأقصى 10 ميجابايت)
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } 
});

// ==========================================
// المسارات
// ==========================================
router.get("/", deviceController.getDevices);
router.post("/", deviceController.createDevice);
router.put("/:id", deviceController.updateDevice);
router.delete("/:id", deviceController.deleteDevice);

// 🚀 مسار رفع الملف (يجب أن يكون اسم الحقل 'file' كما هو في الواجهة الأمامية)
router.post("/upload", upload.single("file"), deviceController.uploadAttachment);

module.exports = router;
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const transferController = require("../controllers/transferCenterController");

// إعداد مجلد حفظ الملفات
const uploadDir = path.join(__dirname, '../../public/uploads/transfer-center');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// إعداد Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } }); // أقصى حجم 50MB


// ===================================
// 🌐 مسارات الإدارة الداخلية (الداشبورد)
// ===================================
router.get("/dashboard", transferController.getCenterData);
router.put("/settings", transferController.updateSettings);

// إدارة الطلبات (الوارد)
router.post("/requests", transferController.createFileRequest);
router.put("/requests/:id", transferController.updateFileRequest);
router.delete("/requests/:id", transferController.deleteFileRequest);


// 💡 أضفنا upload.array('files', 20) ليقوم بمسك الملفات وتوفير req.body
router.post("/packages", upload.array('files', 20), transferController.createDocumentPackage);
router.delete("/packages/:id", transferController.deleteDocumentPackage);

// في ملف Routes
router.put("/packages/:id", transferController.updateDocumentPackage); // لتعديل حزم الصادر
router.put("/files/:id", transferController.updateReceivedFile); // لتعديل الملفات المستلمة (الصندوق الوارد)
router.delete("/files/:id", transferController.deleteReceivedFile);

// إدارة القوالب
router.get("/templates", transferController.getTemplates);
router.post("/templates", transferController.createTemplate);
router.put("/templates/:id", transferController.updateTemplate);
router.delete("/templates/:id", transferController.deleteTemplate);

// الإرسال والذكاء الاصطناعي
router.post("/send-notification", transferController.sendNotification);
router.post("/ai/rephrase", transferController.aiRephrase);
router.post("/ai/analyze/:fileId", transferController.aiAnalyzeFile);


// ===================================
// 🌐 مسارات العميل الخارجي (Public)
// ===================================
// التحقق من الرابط (هل هو فعال؟)
router.get("/verify/:type/:shortLink", transferController.verifyExternalLink);

// 🚀 مسار الرفع من العميل (الذي كان يعطي 404) 
// نستخدم upload.array('files') لاستقبال ملفات متعددة
router.post("/upload/:shortLink", upload.array('files', 20), transferController.uploadFilesFromClient);


module.exports = router;
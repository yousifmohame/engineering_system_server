const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 💡 استيراد الكنترولر والميدلوير الخاص بالمصادقة
const archivedProjectController = require("../controllers/archivedProjectController"); 
// ملاحظة: تأكد من صحة مسار الكنترولر (أو Service) لديك

const { protect } = require("../middleware/authMiddleware");

// ==========================================
// 💡 إعداد Multer (DiskStorage) المخصص للأرشيف
// ==========================================

// 1. تحديد مسار الحفظ (والتأكد من إنشائه إذا لم يكن موجوداً)
const uploadDir = "uploads/archived_projects/";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 2. إعداد محرك التخزين المحلي
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    // دمج السريال الفريد مع لاحقة الملف الأصلي (مثل: .pdf أو .png)
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

// 3. تهيئة Multer مع إضافة حد أقصى لحجم الملف (مثال: 50 ميجا للملف الواحد لتجنب إرهاق السيرفر)
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ==========================================
// 🔗 مسارات أرشفة المشاريع (Archived Projects Routes)
// ==========================================

// تطبيق حماية المصادقة على جميع مسارات الأرشيف
router.use(protect);

// 1. مسار إنشاء أرشيف جديد وإطلاق عملية تحليل Gemini
// استخدام upload.array("files", 20) لاستقبال ما يصل إلى 20 ملف في الدفعة الواحدة
router.post(
  "/",
  upload.array("files", 20),
  archivedProjectController.initiateProjectArchive
);

// 2. مسار جلب قائمة جميع المشاريع المؤرشفة (لعرضها في شاشة الأرشيف)
router.get("/", archivedProjectController.getAllArchivedProjects);

router.post('/manual', archivedProjectController.createManualArchive);
// 3. مسار جلب تفاصيل مشروع مؤرشف محدد (لعرضه في شاشة التفاصيل أو الخطوة 3)
router.get("/:id", archivedProjectController.getArchivedProjectDetails);

// 4. مسار تحديث واعتماد بيانات المشروع بعد مراجعة المستخدم لنتائج الذكاء الاصطناعي
router.put("/:id", archivedProjectController.updateArchivedProject);

router.delete("/:id", archivedProjectController.deleteArchivedProject);

module.exports = router;
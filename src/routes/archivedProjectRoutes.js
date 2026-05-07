const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ==========================================
// 💡 1. استيراد الكنترولر والميدلوير
// ==========================================
const archivedProjectController = require("../controllers/archivedProjectController"); 
const { protect } = require("../middleware/authMiddleware");

// ==========================================
// 💡 2. إعداد Multer (DiskStorage) المخصص للأرشيف
// ==========================================

// أ) تحديد مسار الحفظ (والتأكد من إنشائه إذا لم يكن موجوداً لمنع الأخطاء)
const uploadDir = "uploads/archived_projects/";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ب) إعداد محرك التخزين المحلي (تسمية الملفات وحفظها)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // توجيه الملفات للمجلد المخصص
  },
  filename: function (req, file, cb) {
    // إنشاء اسم فريد للملف لتجنب استبدال الملفات ذات الأسماء المتشابهة
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    // دمج السريال الفريد مع لاحقة الملف الأصلي (مثل: .pdf أو .png)
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

// ج) تهيئة Multer مع إضافة حد أقصى لحجم الملف (300 ميجا للملف الواحد)
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 300 * 1024 * 1024 } // 300MB
});

// ==========================================
// 🔗 3. تطبيق حماية المصادقة (Authentication)
// ==========================================
// جميع المسارات أسفل هذا السطر ستتطلب أن يكون المستخدم مسجلاً للدخول
router.use(protect);


// ==========================================
// 🔗 4. مسارات إدارة المشاريع (Projects Routes)
// ==========================================

// مسار إنشاء أرشيف جديد وإطلاق عملية تحليل Gemini (يستقبل حتى 20 ملف)
router.post("/", upload.array("files", 20), archivedProjectController.initiateProjectArchive);

// مسار إنشاء مشروع أرشفة يدوياً (بدون ذكاء اصطناعي وبدون ملفات مبدئياً)
router.post("/manual", archivedProjectController.createManualArchive);

// مسار جلب قائمة جميع المشاريع المؤرشفة (للعرض في الجدول)
router.get("/", archivedProjectController.getAllArchivedProjects);

// مسار جلب تفاصيل مشروع مؤرشف محدد (للعرض داخل النافذة المنبثقة)
router.get("/:id", archivedProjectController.getArchivedProjectDetails);

// مسار تحديث واعتماد بيانات المشروع (بعد مراجعة نتائج الذكاء الاصطناعي)
router.put("/:id", archivedProjectController.updateArchivedProject);

// مسار حذف مشروع مؤرشف بالكامل (مع ملفاته)
router.delete("/:id", archivedProjectController.deleteArchivedProject);

router.post("/:id/reanalyze", archivedProjectController.reanalyzeProject);

router.post("/:currentProjectId/merge", archivedProjectController.mergeProjects);
// ==========================================
// 🔗 5. مسارات إدارة المرفقات الفردية (Files Routes)
// ==========================================

// مسار رفع ملف إضافي جديد لمشروع موجود (نستخدم upload.single لاستقبال ملف واحد)
router.post("/:projectId/files", upload.single("file"), archivedProjectController.uploadArchiveFile);

// مسار تعديل اسم ملف موجود في الأرشيف
router.put("/files/:fileId", archivedProjectController.renameArchiveFile);

// مسار حذف ملف فردي من قاعدة البيانات ومن السيرفر
router.delete("/files/:fileId", archivedProjectController.deleteArchiveFile);

// تصدير الراوتر لاستخدامه في الملف الرئيسي (server.js أو app.js)
module.exports = router;
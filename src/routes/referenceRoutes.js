const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");

// استيراد ميدل وير الحماية (تأكد من مساره في مشروعك)
const { protect } = require("../middleware/authMiddleware");

// استيراد دوال الكنترولر
const {
  getReferences,
  createReference,
  updateManualNotes,
  deleteReference,
  getReferenceLogs,
  reanalyzeReference,
} = require("../controllers/referenceController");

// ==========================================
// 💡 إعدادات Multer لرفع الملفات
// ==========================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "uploads/references/";
    // التأكد من وجود المجلد، وإذا لم يوجد نقوم بإنشائه تلقائياً
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // توليد اسم فريد للملف لتجنب التكرار وضياع الملفات
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "REF-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // الحد الأقصى لحجم الملف: 20 ميجابايت
});

// ==========================================
// 💡 حماية جميع المسارات
// ==========================================
// لا يمكن لأي شخص الوصول لهذه المسارات إلا إذا كان مسجلاً للدخول
router.use(protect);

// ==========================================
// 💡 تعريف المسارات (Routes)
// ==========================================

// 1. مسار جلب المراجع وإنشاء مرجع جديد (مع استقبال ملف باسم 'file')
router
  .route("/")
  .get(getReferences)
  .post(upload.single("file"), createReference);

// 2. مسار حذف المستند المرجعي
router.route("/:id").delete(deleteReference);

// 3. مسار تحديث التوجيهات والملاحظات الإدارية
router.route("/:id/notes").put(updateManualNotes);

// 4. مسار جلب سجل التحديثات والأحداث (Audit Logs)
router.route("/:id/logs").get(getReferenceLogs);

// 5. مسار طلب إعادة التحليل الذكي عبر الذكاء الاصطناعي (شامل أو سريع)
router.route("/:id/reanalyze").post(reanalyzeReference);

module.exports = router;

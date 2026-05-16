const express = require("express");
const router = express.Router();
const documentationController = require("../controllers/electronicDocController");
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

// ==========================================
// 📁 إعدادات رفع الملفات (Multer Configuration)
// ==========================================
const uploadDir = path.join(__dirname, "../../uploads/documented");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // تنظيف اسم الملف من المسافات والرموز الغريبة
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, "_");
    cb(null, Date.now() + "-" + safeName);
  },
});

const upload = multer({ storage: storage });

// ==========================================
// 🌍 المسارات العامة (Public Routes) 
// 💡 (يجب أن تكون قبل router.use(protect) لكي تعمل للعامة)
// ==========================================
// التحقق من المستند عبر مسح הـ QR (لاحظ استخدمنا :token وليس :serial ليتطابق مع الكنترولر)
router.get("/verify/:token", documentationController.verifyDocument);
router.post("/verify-otp", documentationController.verifyOTP);

// ==========================================
// 🛡️ تفعيل الحماية على باقي المسارات
// ==========================================
router.use(protect);

// ==========================================
// 📊 لوحة التحكم والإحصائيات
// ==========================================
router.get("/dashboard", documentationController.getDashboardStats);

// ==========================================
// 📝 إنشاء وتوثيق المستندات
// ==========================================
// مسار التوثيق الأساسي (استقبال ملفات وربطها)
router.post(
  "/",
  upload.single("file"),
  documentationController.createDocumentation
);

// مسار بديل (Alias) للتوثيق
router.post(
  "/document",
  upload.single("externalFile"),
  documentationController.createDocumentation
);

// حرق الأختام وتقديم المستند للاعتماد (PENDING_APPROVAL)
router.put("/:id/approve", documentationController.approveAndBurnDocument);

// ==========================================
// 🚦 دورة الاعتماد وإجراءات المشرف (Supervisor Workflow)
// ==========================================
// 1. جلب المستندات المعلقة لاعتمادها
router.get("/pending", documentationController.getPendingApprovals);

router.delete("/:id", documentationController.deleteDocument);
// 2. اعتماد المستند نهائياً (VALID)
router.put("/:id/final-approve", documentationController.approveDocumentFinal);

// 3. رفض المستند (REJECTED)
router.put("/:id/reject", documentationController.rejectDocument);

// 4. إبطال مستند ساري (REVOKED) - أمان
router.put("/:id/revoke", documentationController.revokeDocument);

// الحذف النهائي للمستند
// ==========================================
// 🗄️ السجل المركزي والتدقيق (Registry & Audit)
// ==========================================
// جلب سجل الوثائق
router.get("/registry", documentationController.getRegistry);

// جلب سجل الأنشطة والعمليات (Audit Logs)
router.get("/logs", documentationController.getDocumentationLogs);

// تسجيل حركة موظف (طباعة، تنزيل، مشاهدة)
router.post("/logs/action", documentationController.logDocumentAction);

// ==========================================
// 🎨 إدارة قوالب الأختام (Templates)
// ==========================================
router.route("/templates")
  .get(documentationController.getTemplates)
  .post(documentationController.saveTemplate);

router.delete("/templates/:id", documentationController.deleteTemplate);

module.exports = router;
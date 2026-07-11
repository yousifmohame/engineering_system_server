const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const {
  analyzeFormWithAI,
  createFormTemplate,
  getForms,
  addNewFormVersion,
  logFormUsage,
  getFormById,
  updateFormTemplate,
  deleteFormTemplate,
  uploadAttachment,
  deleteAttachment,
} = require("../controllers/projectFormsController");
const { protect } = require("../middleware/authMiddleware");

// =============================
// إعداد مجلد الرفع الخاص بالنماذج
// =============================
const uploadDir = path.join(__dirname, "../../uploads/project-forms");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // دعم الأسماء العربية
    file.originalname = Buffer.from(file.originalname, "latin1").toString(
      "utf8",
    );
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `FORM-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({ storage });

// تطبيق حماية المسارات
router.use(protect);

// 1. الذكاء الاصطناعي
router.post("/analyze", upload.single("file"), analyzeFormWithAI);

// 2. إدارة النماذج
router.get("/", getForms);
router.post("/", upload.array("files", 5), createFormTemplate); // يسمح برفع النموذج مع المرفقات الداعمة

router.get("/:id", getFormById); // 👈 جلب تفاصيل نموذج
router.put("/:id", updateFormTemplate); // 👈 تحديث البيانات
router.delete("/:id", deleteFormTemplate); // 👈 حذف النموذج نهائياً

// 3. إدارة الإصدارات والاستخدام
router.post("/:id/versions", upload.single("file"), addNewFormVersion);
router.post("/:id/log", logFormUsage);
router.post("/:id/attachments", upload.single("file"), uploadAttachment);
router.delete("/:id/attachments/:attachmentId", deleteAttachment);

module.exports = router;

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

const {
  getPermits,
  createPermit,
  updatePermit,
  deletePermit,
  analyzePermitAI,
  autoMergePermit,
  getDuplicates,
  uploadPermitAttachments, // 💡 الدوال الجديدة
  renamePermitAttachment,  // 💡 الدوال الجديدة
  deletePermitAttachment   // 💡 الدوال الجديدة
} = require("../controllers/permitsController");
const { protect } = require("../middleware/authMiddleware");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/permits/");
  },
  filename: function (req, file, cb) {
    // 💡 الحل الجذري لمشكلة الأسماء العربية:
    // إعادة تحويل النص من التشفير الخاطئ (latin1) إلى التشفير الصحيح (utf8)
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');

    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    let ext = path.extname(file.originalname);

    if (!ext) {
      if (file.mimetype === "application/pdf") ext = ".pdf";
      else if (file.mimetype === "image/jpeg") ext = ".jpg";
      else if (file.mimetype === "image/png") ext = ".png";
      else ext = ".pdf"; 
    }

    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({ storage: storage });

router.use(protect); // حماية المسارات

// --- المسارات الأساسية ---
router.get("/", getPermits);
router.post("/", upload.single("file"), createPermit);
router.put("/:id", upload.single("file"), updatePermit);
router.delete("/:id", deletePermit);

// --- مسارات الذكاء الاصطناعي والدمج ---
router.post("/analyze", upload.single("file"), analyzePermitAI);
router.get("/duplicates", getDuplicates);
router.post("/:id/auto-merge", autoMergePermit);

// ==========================================
// 💡 مسارات إدارة المرفقات الإضافية الجديدة
// ==========================================
// رفع مرفقات متعددة (بحد أقصى 10 ملفات في الدفعة)
router.post("/:id/attachments", upload.array("attachments", 10), uploadPermitAttachments);

// تعديل اسم المرفق
router.patch("/:id/attachments/:attachmentId", renamePermitAttachment);

// حذف المرفق
router.delete("/:id/attachments/:attachmentId", deletePermitAttachment);

module.exports = router;
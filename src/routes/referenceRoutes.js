const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");

// استيراد ميدل وير الحماية (تأكد من المسار حسب مشروعك)
const { protect } = require("../middleware/authMiddleware");

const {
  getReferences,
  createReference,
  updateManualNotes,
  deleteReference,
  getReferenceLogs,
  reanalyzeReference,
} = require("../controllers/referenceController");

// إعدادات Multer لرفع الملفات بأمان
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "uploads/references/";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "REF-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // الحد الأقصى 25 ميجابايت
});

// حماية المسارات
router.use(protect);

// مسارات المكتبة المرجعية
router
  .route("/")
  .get(getReferences)
  .post(upload.array('files'), createReference);

router.route("/:id").delete(deleteReference);

router.route("/:id/notes").put(updateManualNotes);

router.route("/:id/logs").get(getReferenceLogs);

router.route("/:id/reanalyze").post(reanalyzeReference);

module.exports = router;

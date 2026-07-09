const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const {
  createBundle,
  getBundles,
  uploadFilesToBundle,
  extractDataWithAI,
  findSimilarBundles,
  getBundleById,
  deleteBundle,
  deleteFile,
  createBundleInBackground,
  updateBundle
} = require("../controllers/permitsAutocadController");
const { protect } = require("../middleware/authMiddleware");

// =============================
// إنشاء مجلد الرفع إذا لم يكن موجودًا
// =============================
const uploadDir = path.join(__dirname, "../uploads/permits-autocad");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// إعدادات Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },

  filename: function (req, file, cb) {
    // إصلاح أسماء الملفات العربية
    file.originalname = Buffer.from(file.originalname, "latin1").toString(
      "utf8",
    );

    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);

    const ext = path.extname(file.originalname);

    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({ storage });

// حماية جميع المسارات
router.use(protect);

router.post("/extract-ai", upload.array("files", 10), extractDataWithAI);
router.post("/background-create", upload.array("files", 10), createBundleInBackground);

router.post("/similar", findSimilarBundles);

router.get("/", getBundles);
router.post("/", upload.array("files", 20), createBundle);

router.get("/:id", getBundleById); 
router.put("/:id", upload.array("files", 20), updateBundle); 
router.delete("/:id", deleteBundle);
router.post("/:id/files", upload.array("files", 10), uploadFilesToBundle);
router.delete("/:id/files/:fileId", deleteFile);

module.exports = router;

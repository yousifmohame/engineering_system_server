const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const {
  uploadIdentity,
  getIdentities,
  getIdentityById,
  mergeIdentities
} = require("../controllers/identityArchiveController");

const { protect } = require("../middleware/authMiddleware");

// إعداد مجلد حفظ الهويات
const uploadDir = path.join(__dirname, "../../uploads/identities");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    file.originalname = Buffer.from(file.originalname, "latin1").toString("utf8");
    const ext = path.extname(file.originalname);
    cb(null, `ID-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({ storage });

// حماية المسارات
router.use(protect);

// مسارات رفع وإدارة الهويات
router.post("/upload", upload.array("files", 10), uploadIdentity); // يدعم رفع حتى 10 ملفات مرة واحدة
router.get("/", getIdentities);
router.get("/:id", getIdentityById);

// مسارات إدارة التكرارات
router.post("/duplicates/:duplicateId/merge", mergeIdentities);

module.exports = router;
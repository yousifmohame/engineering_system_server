const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const {
  uploadBuildingCode,
  getBuildingCodes,
  getRecordDuplicates,
  scanForDuplicates,
  deleteDuplicateRecord,
  getBuildingCodeById,
  updateBuildingCode,
  mergeBuildingCodes,
  deleteBuildingCode
} = require("../controllers/buildingCodeArchiveController");

const { protect } = require("../middleware/authMiddleware");

// 1. تجهيز مجلد الحفظ المخصص لأنظمة البناء
const uploadDir = path.join(__dirname, "../../uploads/building-codes");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 2. إعدادات Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // حل مشكلة الأسماء العربية في الملفات المرفوعة
    file.originalname = Buffer.from(file.originalname, "latin1").toString(
      "utf8",
    );
    const ext = path.extname(file.originalname);
    cb(null, `BC-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({ storage });

// تطبيق حماية المسارات
router.use(protect);

// 3. ربط المسارات بالدوال (Routes)
router.post("/upload", upload.array("files", 20), uploadBuildingCode); // يقبل حتى 20 نظام بناء دفعة واحدة
router.get("/", getBuildingCodes);
router.get("/:id", getBuildingCodeById);
router.put("/:id", updateBuildingCode);
router.delete("/:id", deleteBuildingCode);
router.get("/:id/duplicates", getRecordDuplicates);
router.post("/scan-duplicates", scanForDuplicates);
router.post("/resolve-duplicate", deleteDuplicateRecord);

// مسارات إدارة التكرارات (Merge)
router.post("/duplicates/:duplicateId/merge", mergeBuildingCodes);

module.exports = router;

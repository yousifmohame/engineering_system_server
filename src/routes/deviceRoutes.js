const express = require("express");
const router = express.Router();
const deviceController = require("../controllers/deviceController");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// إعداد مجلد المرفقات
const uploadDir = path.join(__dirname, "../../uploads/devices");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadDir); },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, "dev-" + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 15 * 1024 * 1024 } });

// ==========================================
// المسارات (Routes)
// ==========================================
router.get("/categories", deviceController.getCategories);
router.post("/categories", deviceController.addCategory);

router.get("/", deviceController.getDevices);
router.post("/", deviceController.createDevice);
router.put("/:id", deviceController.updateDevice);
router.delete("/:id", deviceController.deleteDevice);

// مسار رفع المرفقات (الفواتير/الضمان)
router.post("/upload", upload.single("file"), deviceController.uploadAttachment);

// 🚀 مسار رفع صورة المواصفات للذكاء الاصطناعي
router.post("/extract-specs", upload.single("image"), deviceController.extractSpecsFromImage);

module.exports = router;
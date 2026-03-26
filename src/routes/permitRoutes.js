const express = require("express");
const router = express.Router();
const multer = require("multer");

// 💡 استدعاء updatePermit هنا
const {
  getPermits,
  createPermit,
  updatePermit,
  deletePermit,
  analyzePermitAI,
} = require("../controllers/permitsController");
const { protect } = require("../middleware/authMiddleware");

const path = require("path");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/permits/"); // تأكد من مسار المجلد لديك
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    let ext = path.extname(file.originalname);

    // 💡 الحل الجذري: إذا كان الملف بدون امتداد، نستنتج الامتداد من نوع الملف (MimeType)
    if (!ext) {
      if (file.mimetype === "application/pdf") ext = ".pdf";
      else if (file.mimetype === "image/jpeg") ext = ".jpg";
      else if (file.mimetype === "image/png") ext = ".png";
      else ext = ".pdf"; // افتراضي إذا كان نوعاً غير معروف في نظام هندسي
    }

    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({ storage: storage });

router.use(protect); // حماية المسارات

router.get("/", getPermits);
router.post("/", upload.single("file"), createPermit);

// 💡 الراوت الجديد الخاص بالتعديل
router.put("/:id", upload.single("file"), updatePermit);

router.delete("/:id", deletePermit);

router.post("/analyze", upload.single("file"), analyzePermitAI);

module.exports = router;

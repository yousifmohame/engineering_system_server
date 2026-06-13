const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { protect } = require("../middleware/authMiddleware");

// استيراد الكنترولر
const {
  uploadAttachment,
  uploadGeneralFile,
  getAttachmentsForTransaction,
  getAttachmentsForEmployee,
  deleteAttachment,
} = require("../controllers/attachmentController");

// ==============================================================
// 🛠️ إعداد Multer بالمسار المطلق
// ==============================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // تحديد المجلد: إما attachments أو general
    const folderName = req.originalUrl.includes("upload-general")
      ? "general"
      : "attachments";

    // المسار المطلق: يخرج من src/routes إلى الجذر ثم يدخل uploads
    const dest = path.join(__dirname, `../../uploads/${folderName}`);

    // إنشاء المجلد برمجياً إذا لم يكن موجوداً
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // إنشاء اسم مميز للملف
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

// ✅ تهيئة المُتغير upload هنا (وهو الذي سيتم استخدامه في المسارات)
const upload = multer({ storage: storage });

// ==============================================================
// 🚀 المسارات (Routes)
// ==============================================================

router.use(protect); // حماية جميع المسارات

// مسارات الرفع
router.post("/upload", upload.single("file"), uploadAttachment);
router.post("/upload-general", upload.single("file"), uploadGeneralFile);

// مسارات الجلب
router.get("/transaction/:transactionId", getAttachmentsForTransaction);
router.get("/employee/:employeeId", getAttachmentsForEmployee);

// مسار الحذف
router.delete("/:id", deleteAttachment);

module.exports = router;

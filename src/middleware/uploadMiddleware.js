const multer = require("multer");

/**
 * إعداد multer لاستخدام الذاكرة (Memory Storage)
 * هذا ضروري لأننا نحتاج لتحويل الملف إلى Buffer لإرساله لـ OpenAI
 * دون الحاجة لكتابته على القرص الصلب أولاً
 */
const storage = multer.memoryStorage();

// إعداد القيود لضمان حماية السيرفر
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // حد أقصى 10 ميجابايت للملف الواحد
  },
  fileFilter: (req, file, cb) => {
    // قبول الصور وملفات PDF فقط كما هو مطلوب في تحليل الصكوك
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf"
    ) {
      cb(null, true);
    } else {
      cb(new Error("نوع الملف غير مدعوم. يرجى رفع صورة أو ملف PDF."), false);
    }
  },
});

module.exports = upload;

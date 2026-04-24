const express = require('express');
const router = express.Router();
const documentationController = require('../controllers/documentationController');
const { protect } = require('../middleware/authMiddleware');
const multer = require('multer');
const fs = require('fs');
const path = require('path'); // استدعاء مكتبة المسارات

// 1. تحديد المسار المطلق للمجلد (بناءً على أن هذا الملف داخل src/routes)
// هذا سيشير إلى مجلد uploads في الجذر الرئيسي للمشروع
const uploadDir = path.join(__dirname, '../../uploads/documented');

// 2. التأكد من إنشاء المجلد برمجياً إذا لم يكن موجوداً
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 3. إعداد التخزين في Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // استخدام المسار المطلق
  },
  filename: function (req, file, cb) {
    // تنظيف اسم الملف من المسافات والرموز الغريبة التي تسبب مشاكل (مثل أسماء صور واتساب)
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    cb(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({ storage: storage });

// ==========================================
// المسارات (Routes)
// ==========================================
router.use(protect); // حماية المسارات

router.get('/dashboard', documentationController.getDashboardStats);
router.get('/registry', documentationController.getRegistry);

router.route('/templates')
  .get(documentationController.getTemplates)
  .post(documentationController.saveTemplate);

// مسار التوثيق مع رفع الملف
router.post('/document', upload.single('externalFile'), documentationController.createDocumentation);
// Public Verification Route (لا يحتاج protect)
router.get('/verify/:serial', documentationController.verifyDocument);

module.exports = router;
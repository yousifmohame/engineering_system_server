// middleware/uploadMiddleware.js
const multer = require('multer');
const path = require('path');

// إعداد مساحة التخزين (يمكنك التعديل عليها لاحقاً لتخزينها في السحابة)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // (تأكد من إنشاء مجلد 'uploads' في جذر المشروع)
  },
  filename: function (req, file, cb) {
    // إنشاء اسم فريد للملف
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

module.exports = upload;
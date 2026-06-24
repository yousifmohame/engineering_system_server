const express = require('express');
const router = express.Router();
const multer = require('multer');
const payrollController = require('../controllers/payrollController');
const path = require("path");
const fs = require("fs");
// 💡 التعديل هنا: إعداد Multer لحفظ الملف مع امتداده الحقيقي

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, "../../uploads/mudad_temp");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, `offer-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage: storage });


// العمليات الأساسية
router.post('/generate', payrollController.generatePayroll);
router.get('/', payrollController.getPayrolls);
router.put('/:id', payrollController.updatePayroll);

// مسار رفع منصة مدد
router.post('/upload-mudad', upload.single('file'), payrollController.uploadMudadPayroll);

// مسارات سير العمل (Workflow) والاعتمادات
// 1. الموارد البشرية ترسل للمراجعة
router.patch('/:id/request-review', payrollController.requestSupervisorReview);

// 2. مشرف العمليات يعتمد المسير
router.patch('/:id/approve', payrollController.approvePayroll);

module.exports = router;
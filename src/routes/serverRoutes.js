const express = require('express');
const router = express.Router();
const serverController = require('../controllers/serverController');

// 💡 استدعاء ميدل وير الحماية (قم بتعديل المسار حسب مشروعك)
const { protect } = require('../middleware/authMiddleware');

// تطبيق الحماية على جميع مسارات السيرفر (يجب أن يكون مسجلاً وصلاحيته مدير)
router.use(protect);
// router.use(adminOnly); // قم بتفعيلها إذا كان لديك ميدل وير للتحقق من صلاحية المدير

router.get('/stats', serverController.getServerStats);
router.get('/backup', serverController.downloadBackup);

// 💡 الراوت الجديد الخاص بتحميل المرفقات
router.get('/backup-uploads', serverController.downloadUploadsBackup);

router.post('/restart', serverController.restartServer);

module.exports = router;
const express = require('express');
const router = express.Router();

// استيراد الكنترولر الذي أنشأناه سابقاً
const notificationController = require('../controllers/notificationController');

// استيراد ميدل وير الحماية (للتأكد من أن المستخدم مسجل دخوله لمعرفة req.user.id)
// تأكد من مسار واسم ميدل وير المصادقة الخاص بك
const { protect } = require('../middleware/authMiddleware'); 

// جميع مسارات الإشعارات يجب أن تكون محمية
router.use(protect);

// 1. جلب الإشعارات الخاصة بالموظف
router.get('/', notificationController.getMyNotifications);

// 2. تحديد جميع الإشعارات كمقروءة
// ⚠️ ملاحظة هندسية: نضع هذا المسار قبل المسار الذي يحتوي على :id لتجنب تضارب المسارات (Route Collision)
router.put('/read-all', notificationController.markAllAsRead);

// 3. تحديد إشعار واحد كمقروء (بناءً على الـ ID)
router.put('/:id/read', notificationController.markAsRead);

module.exports = router;
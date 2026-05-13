const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

// هذا الرابط ستطلبه واجهة React لجلب الجدول
router.get('/daily', attendanceController.getDailyLog);
router.get('/policies', attendanceController.getPolicies);
router.put('/policies', attendanceController.updatePolicies);
router.get('/report', attendanceController.getEmployeeReport);
// أضف هذه الأسطر مع مسارات الـ API الخاصة بك
router.get('/zk-devices', attendanceController.getAllDevices);
router.get('/stats', attendanceController.getDashboardStats);

module.exports = router;
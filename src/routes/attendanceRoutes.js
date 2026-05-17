const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

// مسارات السجل والتقارير
router.get('/daily', attendanceController.getDailyLog);
router.get('/report', attendanceController.getEmployeeReport);

// مسارات الداشبورد والأجهزة
router.get('/zk-devices', attendanceController.getAllDevices);
router.get('/stats', attendanceController.getDashboardStats);

// 🚀 مسارات الإجراءات الإدارية (الجديدة)
router.put('/excuse-delay', attendanceController.excuseDelay);
router.post('/grant-leave', attendanceController.grantLeave);

// مسارات سياسات الدوام
router.route("/policies/full")
  .get(attendanceController.getFullPolicies)
  .put(attendanceController.updateFullPolicies);

module.exports = router;
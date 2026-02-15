// routes/appointmentRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware'); // (اختياري حسب إعداداتك)
const {
  createAppointment,
  getAppointmentsByTransaction,
  updateAppointment,
  deleteAppointment
} = require('../controllers/appointmentController');

// حماية المسارات (إذا كنت تستخدم المصادقة)
// router.use(protect); 

router.post('/', createAppointment);
router.get('/transaction/:transactionId', getAppointmentsByTransaction);
router.put('/:id', updateAppointment);
router.delete('/:id', deleteAppointment);

module.exports = router;
// [NEW FILE: routes/dashboardRoutes.js]
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getDashboardStats } = require('../controllers/dashboardController');

// حماية جميع المسارات التالية
router.use(protect);

router.route('/stats').get(getDashboardStats);
  
module.exports = router;
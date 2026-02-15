// [NEW FILE: routes/dashboardRoutes.js]
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getRoleDashboardStats } = require('../controllers/dashboardController');

// حماية جميع المسارات التالية
router.use(protect);

router.route('/roles-stats').get(getRoleDashboardStats);
  
module.exports = router;
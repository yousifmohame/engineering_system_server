const express = require('express');
const router = express.Router();
const { getClientClassifications } = require('../controllers/classificationController');
const { protect } = require('../middleware/authMiddleware');

// GET /api/classifications/client
// هذا المسار محمي ويتطلب تسجيل الدخول
router.get('/client', protect, getClientClassifications);

module.exports = router;
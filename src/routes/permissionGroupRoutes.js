// [NEW FILE: routes/permissionGroupRoutes.js]

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

const {
  createPermissionGroup,
  getAllPermissionGroups
} = require('../controllers/permissionGroupController');

// حماية جميع المسارات التالية
router.use(protect);

// المسارات الأساسية
router.route('/')
  .post(createPermissionGroup)
  .get(getAllPermissionGroups);
  
module.exports = router;
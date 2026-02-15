// [File: routes/permissionRoutes.js]
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

const {
  createPermission,
  getIndividualPermissions, // ✅ استخدام الاسم الجديد
  getPermissionGroups,      // ✅ استيراد الدالة الجديدة
  assignPermissionToRole,
  assignPermissionToEmployee
} = require('../controllers/permissionController');

// حماية جميع المسارات التالية
router.use(protect);

// --- ✅ إضافة المسارات الجديدة هنا ---
router.route('/groups').get(getPermissionGroups);
router.route('/individual').get(getIndividualPermissions);


// المسارات الأساسية
router.route('/')
  .post(createPermission)
  .get(getIndividualPermissions); // ✅ تحديث الدالة هنا أيضاً

// مسارات الإسناد
router.route('/assign-to-role')
  .post(assignPermissionToRole);

router.route('/assign-to-employee')
  .post(assignPermissionToEmployee);
  
module.exports = router;
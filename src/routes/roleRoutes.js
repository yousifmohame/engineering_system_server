// [File: routes/roleRoutes.js]
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

const {
  createRole,
  getAllRoles,
  assignEmployeeToRole,
  removeEmployeeFromRole,
  getRoleChanges,
  getAssignmentLists,
  getRoleNotifications,
  getRoleById,
  updateRolePermissions,
  assignPermissionToRole,
  updateRole, // ✅ استيراد
  deleteRole  // ✅ استيراد
} = require('../controllers/roleController');

// حماية جميع المسارات التالية
router.use(protect);

// المسارات الأساسية
router.route('/')
  .post(createRole)
  .get(getAllRoles);

// المسارات الإضافية
router.route('/changes').get(getRoleChanges);
router.route('/assignment-lists').get(getAssignmentLists);
router.route('/notifications').get(getRoleNotifications);

// مسارات إسناد وإزالة الموظفين
router.route('/assign-employee').post(assignEmployeeToRole);
router.route('/remove-employee').post(removeEmployeeFromRole);

// ===============================================
// ✅ مسارات العمليات على دور واحد (تحديث، حذف، جلب)
// ===============================================
router.route('/:id')
  .get(getRoleById)    // جلب تفاصيل الدور
  .put(updateRole)     // تحديث البيانات الأساسية
  .delete(deleteRole); // حذف الدور

// مسارات الصلاحيات الخاصة بالدور
router.route('/:id/permissions').put(updateRolePermissions);
router.route('/:id/assign-permission').post(assignPermissionToRole);
  
module.exports = router;
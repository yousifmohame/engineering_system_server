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
  getRoleById,            // ✅ إضافة
  updateRolePermissions   // ✅ إضافة
} = require('../controllers/roleController');

// حماية جميع المسارات التالية
router.use(protect);

// المسارات الأساسية
router.route('/')
  .post(createRole)
  .get(getAllRoles);

// المسارات الجديدة
router.route('/changes').get(getRoleChanges);
router.route('/assignment-lists').get(getAssignmentLists);
router.route('/notifications').get(getRoleNotifications);

// مسارات إسناد الموظفين
router.route('/assign-employee')
  .post(assignEmployeeToRole);

router.route('/remove-employee')
  .post(removeEmployeeFromRole);

// --- ✅ إضافة مسارات التفاصيل والتحديث ---
// (يجب أن يكون هذا المسار قبل :id لمنع التعارض)
// (لا يوجد تعارض حالياً، لكنه جيد للتنظيم)

// مسار لجلب دور واحد وتحديث صلاحياته
router.route('/:id')
  .get(getRoleById); // GET /api/roles/ROLE_ID_HERE

router.route('/:id/permissions')
  .put(updateRolePermissions); // PUT /api/roles/ROLE_ID_HERE/permissions
  
module.exports = router;
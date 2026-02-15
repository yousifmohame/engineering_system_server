// routes/projectRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// استيراد الوظائف من الـ Controller
const {
  createProject,
  getAllProjects,
  getProjectById,
  updateProject,
  deleteProject,
} = require('../controllers/projectController');

// حماية جميع المسارات التالية (يجب أن يكون المستخدم مسجلاً دخوله)
router.use(protect);

// تعريف المسارات وربطها بالـ Controller
// لاحظ كيف أصبح الملف بسيطاً ومنظماً

// GET /api/projects  -> جلب كل المشاريع
// POST /api/projects -> إنشاء مشروع جديد
router.route('/')
  .get(getAllProjects)
  .post(createProject);

// GET /api/projects/:id    -> جلب مشروع واحد
// PUT /api/projects/:id    -> تحديث مشروع
// DELETE /api/projects/:id -> حذف مشروع
router.route('/:id')
  .get(getProjectById)
  .put(updateProject)
  .delete(deleteProject);

module.exports = router;
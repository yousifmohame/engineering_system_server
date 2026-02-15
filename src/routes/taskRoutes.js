const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getAllTasks,
  createTask,
  getTaskById,
  updateTask,
  deleteTask,
  updateTaskStatus,
  transferTask,  
  getMyTasks
} = require('../controllers/taskController');

router.get('/my-tasks', protect, getMyTasks);
// (المسارات الحالية)
router.get('/', protect, getAllTasks);
router.post('/', protect, createTask);
router.get('/:id', protect, getTaskById);
router.patch('/:id', protect, updateTask); // (هذا مسار تحديث عام)
router.delete('/:id', protect, deleteTask);

// --- 💡 إضافة المسارات الجديدة ---
// (هذه المسارات مخصصة للنوافذ المنبثقة)
router.patch('/:id/status', protect, updateTaskStatus);
router.patch('/:id/transfer', protect, transferTask);
// ---------------------------------

module.exports = router;
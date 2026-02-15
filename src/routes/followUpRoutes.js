// routes/followUpRoutes.js
const express = require('express');
const router = express.Router();
const followUpController = require('../controllers/followUpController');
const { protect } = require('../middleware/authMiddleware'); // تأكد من مسار الميدلوير الصحيح لديك

// --- مسارات المعقبين ---
router.post('/agents', protect, followUpController.createAgent);
router.get('/agents', protect, followUpController.getAllAgents);
router.get('/agents/:id', protect, followUpController.getAgentById);
router.put('/agents/:id', protect, followUpController.updateAgent);

// --- مسارات المهام ---
router.post('/tasks', protect, followUpController.createTask);
router.get('/tasks', protect, followUpController.getAllTasks);
router.put('/tasks/:id', protect, followUpController.updateTaskStatus);

module.exports = router;
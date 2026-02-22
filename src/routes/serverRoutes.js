const express = require('express');
const router = express.Router();
const serverController = require('../controllers/serverController');
// يجب إضافة Middleware هنا للتأكد أن المستخدم Admin فقط!

router.get('/stats', serverController.getServerStats);
router.get('/backup', serverController.downloadBackup);
router.post('/restart', serverController.restartServer);

module.exports = router;
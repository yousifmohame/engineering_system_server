const express = require('express');
const router = express.Router();
const controller = require('../controllers/riyadhStreetsController');
// const { protect } = require('../middleware/authMiddleware'); // فعل هذا السطر إذا كان لديك حماية

router.post('/', controller.createStreet);
router.get('/', controller.getAllStreets);
router.get('/lookups', controller.getLookups);
router.get('/stats', controller.getStatistics);

module.exports = router;
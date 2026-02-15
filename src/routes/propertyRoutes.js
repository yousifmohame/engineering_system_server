const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/propertyController');
const upload = require('../middleware/uploadMiddleware'); // تأكد من وجوده (Multer)

router.get('/', propertyController.getAllPropertyFiles);
router.post('/extract-ai', upload.single('file'), propertyController.processPropertyAI);

module.exports = router;
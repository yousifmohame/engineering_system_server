// routes/docClassificationRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getClassifications,
  createClassification,
  updateClassification,
  deleteClassification,
} = require('../controllers/docClassificationController'); // (سننشئه الآن)

router.use(protect); // حماية جميع المسارات

router.route('/')
  .get(getClassifications)
  .post(createClassification);

router.route('/:id')
  .put(updateClassification)
  .delete(deleteClassification);

module.exports = router;
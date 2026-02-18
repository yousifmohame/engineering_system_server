const express = require("express");
const router = express.Router();
const propertyController = require("../controllers/propertyController");
const upload = require("../middleware/uploadMiddleware");

router.get("/", propertyController.getAllProperties); // الدوال المحدثة
router.post("/", propertyController.createProperty); // الدالة المصححة
router.get("/:id", propertyController.getPropertyById);
router.put('/:id', propertyController.updateProperty);

router.post('/analyze-ai', propertyController.analyzeDeedAI);

module.exports = router;

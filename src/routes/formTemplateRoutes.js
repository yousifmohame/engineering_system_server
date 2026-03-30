// routes/formTemplateRoutes.js
const express = require("express");
const router = express.Router();
const {
  createTemplate,
  getAllTemplates,
  getTemplateById,   // 💡 الدالة الجديدة
  updateTemplate,    // 💡 الدالة الجديدة
  useTemplate,
  saveUsageData,
} = require("../controllers/formTemplateController.js");

router.get("/templates", getAllTemplates);
router.post("/templates", createTemplate);

// 💡 إضافة الروابط المفقودة
router.get("/templates/:id", getTemplateById);
router.put("/templates/:id", updateTemplate);

router.post("/use", useTemplate);
router.put("/usage/:usageId", saveUsageData);

module.exports = router;
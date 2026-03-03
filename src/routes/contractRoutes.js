// routes/contractRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

// استيراد الوظائف من الـ Controller
const {
  createContract,
  updateContract,
  getContracts,
  deleteContract,
  getTemplates,
  createTemplate,
  deleteTemplate,
  incrementTemplateUse,
  updateTemplate,
  analyzeContractAI
} = require("../controllers/contractController");

// حماية جميع مسارات العقود (يجب أن يكون المستخدم مسجل الدخول)
router.use(protect);

// ==========================================
// مسارات العقود (Contract Routes)
// ==========================================

// GET /api/contracts  -> جلب كل العقود
router.get("/", getContracts);

// POST /api/contracts -> إنشاء عقد جديد
router.post("/", createContract);
router.post("/analyze-ai", analyzeContractAI);
router.get("/templates", getTemplates);
router.post("/templates", createTemplate);
router.put('/templates/:id', updateTemplate);
router.delete("/templates/:id", deleteTemplate);
router.put("/templates/:id/use", incrementTemplateUse);
router.put('/:id', updateContract);
// DELETE /api/contracts/:id -> حذف عقد محدد
router.delete("/:id", deleteContract);

module.exports = router;

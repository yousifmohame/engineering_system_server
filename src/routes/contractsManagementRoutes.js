const express = require("express");
const router = express.Router();
const controller = require("../controllers/contractsManagementController");

// --- مسارات العمليات الأساسية (CRUD) ---
router.post("/", controller.saveContract); // إنشاء عقد جديد
router.get("/", controller.getAllContracts); // جلب جميع العقود
router.get("/:id", controller.getContractById); // جلب عقد بواسطة ID
router.put("/:id", controller.updateContract); // تعديل عقد
router.delete("/:id", controller.deleteContract); // حذف عقد

// --- مسارات الذكاء الاصطناعي (AI) ---
router.post("/ai/rephrase", controller.rephraseText); // إعادة صياغة
router.post("/ai/risk-assessment", controller.assessRisks); // تقييم المخاطر (تم تصحيح الربط)
router.post("/ai/summary", controller.generateSummary); // توليد ملخص ذكي

module.exports = router;

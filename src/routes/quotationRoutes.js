// routes/quotationRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

const {
  createQuotation,
  getAllQuotations,
  getQuotationById,
  updateQuotation,
  deleteQuotation,
  hardDeleteQuotation,
  restoreFromTrash,
  getQuotationStats,
  recordPayment,
  stampQuotation,
  signQuotation,
  generatePdfPreview,
  generateAndSavePdf,
  submitForApproval,
  requestModification,
  rejectQuotationWorkflow,
  approveQuotationWorkflow,
  verifyQuotation
} = require("../controllers/quotationController");

router.use(protect);

router.route("/").get(getAllQuotations).post(createQuotation);

router.get("/stats", getQuotationStats);
router.post("/generate-pdf", generatePdfPreview);
router.post("/generate-and-save-pdf", generateAndSavePdf);
// إضافة هذا السطر للمسارات العامة (Public Routes)
router.get('/verify/:barcode', verifyQuotation);
// 🚀 مسارات دورة الاعتماد (Approval Workflow)
router.put("/:id/submit", submitForApproval);
router.put("/:id/approve", approveQuotationWorkflow);
router.put("/:id/modify", requestModification);
router.put("/:id/reject", rejectQuotationWorkflow);
router.put("/:id/restore", restoreFromTrash); // مسار الاسترجاع من السلة

router.post("/:id/payments", recordPayment);
router.patch("/:id/stamp", stampQuotation); // اختياري الإبقاء عليه إذا كان مستخدماً في مكان آخر
router.patch("/:id/sign", signQuotation);
router.delete("/:id/force", hardDeleteQuotation);
router
  .route("/:id")
  .get(getQuotationById)
  .put(updateQuotation)
  .delete(deleteQuotation);

module.exports = router;

const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");

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
  verifyQuotation,
  uploadTempAttachments // 👈 الدالة الجديدة
} = require("../controllers/quotationController");

// ==========================================
// 💡 إعدادات Multer للرفع "المؤقت" (Temp)
// ==========================================
const tempStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "uploads/temp/";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    // سيتم حفظ الملف باسم يبدأ بـ TEMP
    cb(null, "TEMP-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const uploadTemp = multer({
  storage: tempStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // الحد الأقصى 50 ميجابايت للملف
});

// ==========================================

// مسار عام (لا يحتاج توثيق) للتحقق من الـ QR
router.get('/verify/:barcode', verifyQuotation);

// حماية باقي المسارات
router.use(protect);

// 🚀 المسار الجديد للرفع السريع المؤقت
router.post('/upload-temp', uploadTemp.array('files'), uploadTempAttachments);

router.route("/")
  .get(getAllQuotations)
  .post(createQuotation);

router.get("/stats", getQuotationStats);
router.post("/generate-pdf", generatePdfPreview);
router.post("/generate-and-save-pdf", generateAndSavePdf);

// مسارات دورة الاعتماد (Approval Workflow)
router.put("/:id/submit", submitForApproval);
router.put("/:id/approve", approveQuotationWorkflow);
router.put("/:id/modify", requestModification);
router.put("/:id/reject", rejectQuotationWorkflow);
router.put("/:id/restore", restoreFromTrash); 

router.post("/:id/payments", recordPayment);
router.patch("/:id/stamp", stampQuotation); 
router.patch("/:id/sign", signQuotation);
router.delete("/:id/force", hardDeleteQuotation);

router.route("/:id")
  .get(getQuotationById)
  .put(updateQuotation)
  .delete(deleteQuotation);

module.exports = router;
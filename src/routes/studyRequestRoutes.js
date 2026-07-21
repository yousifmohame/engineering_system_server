const express = require("express");
const router = express.Router();
const studyController = require("../controllers/studyRequestController");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// إعداد Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, "../../uploads/study-requests");
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });
// =======================================
// مسارات "معاملات تحت الدراسة" (Study Requests)
// =======================================

// العمليات الأساسية (CRUD)
router.post("/", studyController.createStudyRequest); // File 01 & 03
router.get("/", studyController.getAllStudyRequests); // File 02 (Grid)
router.post(
  "/instant-analysis",
  upload.array("files", 30),
  studyController.instantAiAnalysis,
);
router.post(
  "/batch-upload",
  upload.array("files", 30),
  studyController.uploadBatch,
);
router.get("/:id", studyController.getStudyRequestById); // File 03 (Modal)
router.put("/:id", studyController.updateStudyRequest); // File 03 & 10 (Cumulative Update)
router.delete("/:id", studyController.deleteStudyRequest);
// الملاحظات والقرارات والـ Timeline (File 04 & 10)
router.post("/:id/decisions", studyController.addDecision);
// التحويل والعمليات الحساسة (File 07)
router.post("/:id/convert", studyController.convertToTransaction);

router.post("/:id/re-analyze", studyController.reAnalyzeStudyRequest);

router.post(
  "/:id/batch-upload",
  upload.array("files", 30),
  studyController.uploadBatch,
);

// مسارات إدارة المرفقات المباشرة
router.put("/attachments/:attachmentId/name", studyController.updateAttachmentName);
router.delete("/attachments/:attachmentId", studyController.deleteAttachment);

// مسارات الملاحظات
router.post("/:id/notes", studyController.addStudyNote);

router.post(
  "/:id/attachments", 
  upload.array("files", 30), 
  studyController.uploadDirectAttachment
);

module.exports = router;

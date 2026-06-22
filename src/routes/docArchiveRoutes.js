const express = require("express");
const router = express.Router();
const docArchiveController = require("../controllers/docArchiveController");

// المسار الجديد للتحليل الذكي
router.post("/analyze", docArchiveController.uploadAndAnalyzeDoc); 

router.get("/", docArchiveController.getAllArchiveDocs);
router.post("/", docArchiveController.saveArchivedDoc);
router.get("/:id", docArchiveController.getArchiveDocById);
router.delete("/:id", docArchiveController.deleteArchiveDoc);

// 🚀 أضف هذا السطر الجديد لتحديث واعتماد الوثيقة
router.put("/:id", docArchiveController.updateArchivedDoc); 

module.exports = router;
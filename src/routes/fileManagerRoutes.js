const express = require("express");
const router = express.Router();

const {
  getFolderContents,
  createFolder,
  uploadFiles,
  renameItem,
  softDeleteItems,
  restoreItems,
  permanentDeleteItems,
  getCategories,
  saveCategories,
  // 💡 استيراد الدوال الجديدة
  getFileLogs,
  getFileVersions,
  uploadNewVersion,
  getTrashItems
} = require("../controllers/fileManagerController");

// العمليات الأساسية للمحتوى
router.get("/contents", getFolderContents);
router.post("/folder", createFolder);
router.post("/upload", uploadFiles);
router.put("/rename", renameItem);

// عمليات الحذف والاستعادة
router.get("/trash", getTrashItems);
router.post("/delete", softDeleteItems);
router.post("/restore", restoreItems);
router.post("/permanent-delete", permanentDeleteItems);

// إعدادات المجلدات
router.get("/categories", getCategories);
router.post("/categories", saveCategories);

// 💡 المسارات الجديدة للاحترافية (Enterprise Features)
router.get("/logs/:fileId", getFileLogs);
router.get("/versions/:fileId", getFileVersions);
router.post("/upload-version", uploadNewVersion);

module.exports = router;
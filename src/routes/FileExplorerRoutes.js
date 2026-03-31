// routes/FileExplorerRoutes.js
const express = require("express");
const router = express.Router();

const {
  getContents,
  createFolder,
  uploadFiles,
  uploadVersion,
  renameItem,
  softDeleteItems,
  getTrash,
  restoreItems,
  permanentDeleteItems,
  getFileLogs,
  getFileVersions,
} = require("../controllers/FileExplorerController");

// =======================================
// 💡 مسارات إدارة الملفات المركزية
// =======================================

// 1. جلب المحتوى والمجلدات
router.get("/contents", getContents);
router.post("/folder", createFolder);

// 2. رفع الملفات والإصدارات (بدون Middleware الـ Multer هنا)
router.post("/upload", uploadFiles);
router.post("/upload-version", uploadVersion);

// 3. التعديلات
router.put("/rename", renameItem);

// 4. سلة المحذوفات والحذف النهائي
router.post("/delete", softDeleteItems);
router.get("/trash", getTrash);
router.post("/restore", restoreItems);
router.post("/permanent-delete", permanentDeleteItems);

// 5. السجلات والإصدارات السابقة
router.get("/logs/:fileId", getFileLogs);
router.get("/versions/:fileId", getFileVersions);

module.exports = router;
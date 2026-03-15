const express = require("express");
const router = express.Router();
const multer = require("multer");
const uploadQE = multer({ dest: "uploads/quick_entries/" });

// 💡 1. استيراد جميع الدوال من الكنترولر
const {
  getQuickEntries,
  createQuickEntry,
  processEntry,
  deleteEntry,
  addComment, // 👈 تمت إضافة دالة التعليقات
  undoProcessEntry, // 👈 تمت إضافة دالة التراجع
} = require("../controllers/quickEntryController");

// ==================================================
// المسارات (Endpoints)
// ==================================================

router.get("/", getQuickEntries);
router.post("/", uploadQE.array("files"), createQuickEntry);
router.post("/:id/process", uploadQE.array("files"), processEntry);
router.delete("/:id", deleteEntry);

// 💡 2. المسارات الجديدة التي تنتظرها الواجهة
router.post("/:id/comments", addComment);
router.patch("/:id/undo", undoProcessEntry);

module.exports = router;

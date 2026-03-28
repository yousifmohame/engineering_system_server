// ==========================================
// 💡 مسارات نظام إدارة الملفات (File Management Routes)
// ==========================================

const express = require("express");
const router = express.Router();

// استيراد الدوال من الكنترولر الذي أنشأناه سابقاً
const {
  getFolderContents,
  createFolder,
  uploadFiles,
  deleteItems,
} = require("../controllers/fileManagerController"); // 👈 تأكد من مسار الكنترولر الصحيح

// ==========================================
// 📌 المسارات (Endpoints)
// ==========================================

// 1. جلب محتويات مجلد معين لمعاملة محددة
// URL: GET /api/files/contents?transactionId=123&folderId=456
router.get("/contents", getFolderContents);

// 2. إنشاء مجلد جديد
// URL: POST /api/files/folder
router.post("/folder", createFolder);

// 3. رفع الملفات (المتعددة) 
// URL: POST /api/files/upload
// ملاحظة: الـ Multer middleware مدمج داخل الكنترولر نفسه للتعامل مع الرفع وحساب السرعة
router.post("/upload", uploadFiles);

// 4. حذف الملفات والمجلدات (بشكل جماعي)
// URL: POST /api/files/delete
// استخدمنا POST بدلاً من DELETE لأنه يرسل Arrays (مصفوفات) في الـ Body بشكل أسهل وأكثر أماناً
router.post("/delete", deleteItems);

module.exports = router;
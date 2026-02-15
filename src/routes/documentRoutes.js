// routes/documentRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware'); // سنستخدم نفس middleware الرفع

const {
  getDocuments,
  uploadDocument,
  getDocumentStats,
  getDocumentActivities,
  downloadDocument,
  deleteDocument,
  createFolder,
} = require('../controllers/documentController');

// حماية جميع المسارات
router.use(protect);

// GET /api/documents/stats -> جلب الإحصائيات (لتاب 901-01)
router.get('/stats', getDocumentStats);

// GET /api/documents/activities -> جلب الأنشطة (لتاب 901-11)
router.get('/activities', getDocumentActivities);

// GET /api/documents -> جلب كل الملفات والمجلدات (لتاب 901-02)
router.get('/', getDocuments);

// POST /api/documents/upload -> رفع ملف جديد
// نستخدم "upload.single('file')" حيث 'file' هو اسم الحقل في FormData
router.post('/upload', upload.single('file'), uploadDocument);

// POST /api/documents/folder -> إنشاء مجلد جديد
router.post('/folder', createFolder);

// GET /api/documents/:id/download -> تنزيل ملف
router.get('/:id/download', downloadDocument);

// DELETE /api/documents/:id -> حذف ملف
router.delete('/:id', deleteDocument);

module.exports = router;
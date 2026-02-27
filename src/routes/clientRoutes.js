// routes/clientRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
// استيراد الوظائف الجديدة
const {
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient,
  getSimpleClients, // ✅ 1. استيراد الدالة الجديدة
  analyzeIdentityImage,
  analyzeAddressDocument,
  getClientStats,
  uploadClientDocument,
  analyzeRepresentative,
} = require("../controllers/clientController");

// ==========================================
// تأكد من وجود المجلد الذي ستحفظ فيه الملفات
const uploadDir = path.join(__dirname, "../../uploads/clients");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // تحديد مجلد الحفظ
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    // إضافة امتداد الملف الأصلي
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
    );
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // الحد الأقصى 50 ميجابايت
});

// الطريقة الصحيحة لدمج Multer مع مسار الإنشاء
router
  .route("/")
  .get(getAllClients)
  .post(upload.array("files", 10), createClient); // 👈 الـ upload يكون داخل الـ post

// ✅ 2. إضافة المسار المبسط الجديد هنا (قبل :id)
router.route("/simple").get(getSimpleClients);

router.get("/stats", getClientStats);

router.post("/:id/documents", upload.single("file"), uploadClientDocument);

router.post("/analyze-identity", analyzeIdentityImage);
router.post("/analyze-address", analyzeAddressDocument);
router.post("/analyze-representative", analyzeRepresentative);

router.route("/:id").get(getClientById).put(updateClient).delete(deleteClient);

module.exports = router;

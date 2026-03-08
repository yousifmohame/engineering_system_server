const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware"); 

// استيراد multer لرفع المرفقات (تأكد من وجود إعدادات multer لديك)
const multer = require("multer");
const upload = multer({ dest: "uploads/receipts/" }); // مسار حفظ الإيصالات المؤقت/الدائم

const { 
  createPrivateTransaction, 
  getPrivateTransactions,
  addPrivatePayment, // <-- استيراد الدالة الجديدة
  getDashboardStats
} = require("../controllers/privateTransactionController");

router.use(protect);

router.get("/dashboard-stats", getDashboardStats);
// المسارات السابقة
router.post("/", createPrivateTransaction); 
router.get("/", getPrivateTransactions);   

// المسار الجديد للتحصيل (يستخدم upload.single لاستقبال ملف واحد باسم 'file')
router.post("/payments", upload.single("file"), addPrivatePayment);

module.exports = router;
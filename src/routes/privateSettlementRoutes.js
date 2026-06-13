const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ==============================================================
// 🛠️ إعداد Multer بالمسار المطلق لحل مشكلة الدوكر (EPERM)
// ==============================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // استخدام المسار المطلق لضمان التوافق مع Docker
    const dest = path.join(__dirname, "../../uploads/settlements");
    
    // إنشاء المجلد برمجياً إذا لم يكن موجوداً لتفادي خطأ EPERM
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // إنشاء اسم مميز للملف مع الحفاظ على امتداده الأصلي (.pdf, .png)
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

// ==============================================================
// 🚀 استيراد الكنترولر والمسارات
// ==============================================================
const {
  getSettlementsDashboard,
  addPreviousSettlement,
  recordSettlement,
  deliverSettlement,
  getBrokerTransactions,
  getBrokerSettlementsList,
  getBrokerPaymentsList,
  deleteBrokerSettlements,
  getSpecialAccountData
} = require("../controllers/privateSettlementController");

router.use(protect);

router.get("/dashboard", getSettlementsDashboard);
router.post("/previous", addPreviousSettlement);
router.post("/record", recordSettlement);

// 👈 استخدام upload.single("file") التي أعددناها بالأعلى
router.post("/deliver", upload.single("file"), deliverSettlement);

router.get("/special-account/:accountName", getSpecialAccountData);
router.get("/broker/:brokerId/transactions", getBrokerTransactions);
router.get("/broker/:brokerId/settlements", getBrokerSettlementsList);
router.get("/broker/:brokerId/payments", getBrokerPaymentsList);
router.delete("/broker/:brokerId", deleteBrokerSettlements);

module.exports = router;
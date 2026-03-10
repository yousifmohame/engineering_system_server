const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/treasury/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

const {
  getTreasuryTransactions,
  createTreasuryTransaction,
  updateTreasuryTransaction,
  toggleTransactionStatus,
  getReserveSettings,
  updateReserveSettings,
} = require("../controllers/treasuryController");

router.use(protect);

// 1. مسارات إعدادات الاحتياطي (يجب أن تكون في الأعلى)
router.get("/settings/reserve", getReserveSettings);
router.post("/settings/reserve", updateReserveSettings);

// 2. مسارات الحركات
router.get("/", getTreasuryTransactions);
router.post("/", upload.single("file"), createTreasuryTransaction);

// 3. مسارات التعديل والحالة
router.put("/:id", upload.single("file"), updateTreasuryTransaction);
router.put("/:id/toggle", toggleTransactionStatus);

module.exports = router;

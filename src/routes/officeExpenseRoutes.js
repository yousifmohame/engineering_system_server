const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");

// 💡 التعديل هنا: إعداد Multer لحفظ الملف مع امتداده الحقيقي
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // تأكد أن المجلد uploads/expenses موجود فعلياً في مشروعك
    cb(null, "uploads/expenses/");
  },
  filename: function (req, file, cb) {
    // توليد اسم فريد للملف + الامتداد الأصلي (مثال: 169384938-file.pdf)
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

// استيراد الكنترولر
const {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
} = require("../controllers/officeExpenseController");

router.use(protect);

router.get("/", getExpenses);
// استخدام الـ upload الجديد هنا
router.post("/", upload.single("file"), createExpense);

router.put("/:id", upload.single("file"), updateExpense);
router.delete("/:id", deleteExpense);

module.exports = router;

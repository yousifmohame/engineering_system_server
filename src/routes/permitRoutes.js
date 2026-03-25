const express = require("express");
const router = express.Router();
const multer = require("multer");

// 💡 استدعاء updatePermit هنا
const {
  getPermits,
  createPermit,
  updatePermit,
  deletePermit,
  analyzePermitAI
} = require("../controllers/permitsController");
const { protect } = require("../middleware/authMiddleware");

// إعداد Multer لرفع ملفات الرخص
const upload = multer({ dest: "uploads/permits/" });

router.use(protect); // حماية المسارات

router.get("/", getPermits);
router.post("/", upload.single("file"), createPermit);

// 💡 الراوت الجديد الخاص بالتعديل
router.put("/:id", upload.single("file"), updatePermit);

router.delete("/:id", deletePermit);

router.post('/analyze', upload.single('file'), analyzePermitAI);

module.exports = router;

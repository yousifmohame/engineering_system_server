// routes/jobOfferRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { protect } = require("../middleware/authMiddleware"); // تأكد من مسار ميدلوير الحماية لديك
const {
  createJobOffer,
  getAllJobOffers,
  getJobOfferById,
  acceptJobOffer,
  generateJobOfferPdf
} = require("../controllers/jobOfferController");

// تجهيز مجلد الرفع
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, "../../uploads/hr/offers");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, `offer-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage: storage });

// المسارات
router.post(
  "/",
  protect,
  upload.fields([
    { name: "frontCover", maxCount: 1 },
    { name: "backCover", maxCount: 1 },
    { name: "cvFile", maxCount: 1 }
  ]),
  createJobOffer
);

router.post("/generate-pdf", protect, generateJobOfferPdf);
router.get("/", protect, getAllJobOffers);
router.get("/:id", protect, getJobOfferById);

// مسار تسجيل القبول ورفع الملف الموقع
router.post(
  "/:id/accept",
  protect,
  upload.single("signedOfferFile"), // اسم الحقل الذي سيرسله الفرونت إند
  acceptJobOffer
);

module.exports = router;
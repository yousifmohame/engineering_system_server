const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/disbursements/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

const {
  getDisbursements,
  createDisbursement,
  executeDisbursement,
  updateDisbursement,
  deleteDisbursement,
} = require("../controllers/disbursementController");

router.use(protect);
router.get("/", getDisbursements);
router.post("/", upload.single("file"), createDisbursement);
// مسار التنفيذ/الاعتماد (يمكن أن يحتوي على إيصال الدفع)
router.put("/:id/execute", upload.single("file"), executeDisbursement);
router.put("/:id", upload.single("file"), updateDisbursement);
router.delete("/:id", deleteDisbursement);

module.exports = router;

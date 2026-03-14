const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

const {
  getFees,
  createFee,
  updateFee,
  deleteFee
} = require("../controllers/coopOfficeFeeController");

router.use(protect);

router.get("/", getFees);
router.post("/", createFee);
router.put("/:id", updateFee); // 👈 مسار التعديل وتحديث حالة الدفع
router.delete("/:id", deleteFee); // 👈 مسار الحذف

module.exports = router;
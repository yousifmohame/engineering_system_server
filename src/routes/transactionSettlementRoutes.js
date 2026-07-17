const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  createSettlementCycle,
  getSettlementCycles,
  getSettlementCycleById,
  updateSettlementCycleStatus,
  deleteSettlementCycle,
  linkTransactionsToCycle,
  addSettlementAdjustment,
  deleteSettlementAdjustment
} = require("../controllers/transactionSettlementController");

router.use(protect);

// المسارات الأساسية للتصفية
router.route("/")
  .post(createSettlementCycle)
  .get(getSettlementCycles);

router.route("/:id")
  .get(getSettlementCycleById)
  .delete(deleteSettlementCycle);

// تحديث حالة التصفية (اعتماد، تسليم، إلخ)
router.patch("/:id/status", updateSettlementCycleStatus);

// 🚀 مسار ربط المعاملات بدورة التصفية
router.post("/:id/link-transactions", linkTransactionsToCycle);

// 🚀 مسارات التسويات المستقلة (الإضافات والخصومات للأشخاص)
router.post("/:id/adjustments", addSettlementAdjustment);
router.delete("/:id/adjustments/:adjustmentId", deleteSettlementAdjustment);

module.exports = router;
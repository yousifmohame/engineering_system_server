const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  createSettlementCycle,
  getSettlementCycles,
  getSettlementCycleById,
  updateSettlementCycleStatus,
  deleteSettlementCycle
} = require("../controllers/transactionSettlementController");

router.use(protect);

router.route("/")
  .post(createSettlementCycle)
  .get(getSettlementCycles);

router.route("/:id")
  .get(getSettlementCycleById)
  .delete(deleteSettlementCycle);

router.patch("/:id/status", updateSettlementCycleStatus);

module.exports = router;
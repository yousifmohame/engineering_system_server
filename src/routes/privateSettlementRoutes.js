const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/settlements/" });

const {
  getSettlementsDashboard,
  addPreviousSettlement,
  recordSettlement,
  deliverSettlement,
  getBrokerTransactions,
  getBrokerSettlementsList,
  getBrokerPaymentsList,
  deleteBrokerSettlements
} = require("../controllers/privateSettlementController");

router.use(protect);
router.get("/dashboard", getSettlementsDashboard);
router.post("/previous", addPreviousSettlement);
router.post("/record", recordSettlement);
router.post("/deliver", upload.single("file"), deliverSettlement);
router.get("/broker/:brokerId/transactions", getBrokerTransactions);
router.get("/broker/:brokerId/settlements", getBrokerSettlementsList);
router.get("/broker/:brokerId/payments", getBrokerPaymentsList);
router.delete("/broker/:brokerId", deleteBrokerSettlements);

module.exports = router;

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  getBankAccounts,
  createBankAccount,
  addPersonalRecharge,
} = require("../controllers/bankAccountController");

router.use(protect);
router.get("/", getBankAccounts);
router.post("/", createBankAccount);
router.post("/recharge", addPersonalRecharge);

module.exports = router;

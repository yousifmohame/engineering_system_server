const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  getBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  addPersonalRecharge,
  createBankTransaction,
  getPublicBankAccount
} = require("../controllers/bankAccountController");

router.get("/public/:id", getPublicBankAccount); // 👈 مسار جلب الحساب للزوار

router.use(protect);

router.get("/", getBankAccounts);
router.post("/", createBankAccount);
router.put("/:id", updateBankAccount); // 👈 مسار التعديل الذي كان مفقوداً
router.delete("/:id", deleteBankAccount); // 👈 مسار الحذف الذي كان مفقوداً

router.post("/recharge", addPersonalRecharge);
router.post("/transaction", createBankTransaction); // 👈 مسار (الإيداع، السحب، المصروف)

module.exports = router;
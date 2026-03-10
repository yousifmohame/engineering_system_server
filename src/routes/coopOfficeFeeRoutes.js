const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

const {
  getFees,
  createFee,
} = require("../controllers/coopOfficeFeeController");

router.use(protect);
router.get("/", getFees);
router.post("/", createFee);

module.exports = router;

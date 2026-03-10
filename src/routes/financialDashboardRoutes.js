const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { getDashboardData } = require("../controllers/financialDashboardController");

router.use(protect);
router.get("/", getDashboardData);

module.exports = router;
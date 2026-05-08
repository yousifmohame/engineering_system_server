// ملف: src/routes/aiDashboardRoutes.js
const express = require("express");
const router = express.Router();
const aiDashboardController = require("../controllers/aiDashboardController");


router.get("/stats", aiDashboardController.getDashboardStats);
router.get("/jobs", aiDashboardController.getRecentJobs);

module.exports = router;
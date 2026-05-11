// ملف: src/routes/aiDashboardRoutes.js
const express = require("express");
const router = express.Router();
const aiDashboardController = require("../controllers/aiDashboardController");


router.get("/stats", aiDashboardController.getDashboardStats);
router.get("/jobs", aiDashboardController.getRecentJobs);
// جلب حالة مهمة الذكاء الاصطناعي
router.get("/ai-jobs/:id", aiDashboardController.getJobStatus);

module.exports = router;
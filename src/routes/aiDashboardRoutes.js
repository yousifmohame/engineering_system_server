// ملف: src/routes/aiDashboardRoutes.js
const express = require("express");
const router = express.Router();
const aiDashboardController = require("../controllers/aiDashboardController");

// ==================================================
// 📊 مسارات القراءة وعرض البيانات (GET)
// ==================================================
router.get("/stats", aiDashboardController.getDashboardStats);
router.get("/jobs", aiDashboardController.getRecentJobs);
router.get("/ai-jobs/:id", aiDashboardController.getJobStatus); // جلب حالة مهمة محددة

// ==================================================
// ⚙️ مسارات الإجراءات والتحكم بالمهام (POST / DELETE)
// ==================================================
router.post("/jobs/:id/retry", aiDashboardController.retryJob);   // زر إعادة المحاولة
router.post("/jobs/:id/cancel", aiDashboardController.cancelJob); // زر الإيقاف الإجباري
router.delete("/jobs/:id", aiDashboardController.deleteJob);      // زر الحذف

module.exports = router;
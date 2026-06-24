// routes/employeeRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { protect } = require("../middleware/authMiddleware");

const { analyzeEmploymentContract } = require("../controllers/contractAiController");
// ==============================================================
// 🛠️ إعداد Multer المخصص لمرفقات الموظفين
// ==============================================================

const employeeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, "../../uploads/employees");
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // 🚀 الحل هنا: تحويل الترميز من Latin-1 إلى UTF-8 لفك تشفير الحروف العربية
    const originalNameUtf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
    
    // تنظيف الاسم وإنشاء اسم فريد باستخدام الاسم المعالج
    const cleanName = originalNameUtf8.replace(/[^a-zA-Z0-9.\-_أ-ي]/g, "_").replace(/\s+/g, "_");
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    
    cb(null, `${uniqueSuffix}-${cleanName}`);
  },
});

const uploadEmployeeDoc = multer({ 
  storage: employeeStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const {
  getMe,
  getAllEmployees,
  updateEmployee,
  deleteEmployee,
  
  // 👈 دوال المرفقات الجديدة (سنضيفها في الكنترولر)
  uploadEmployeeAttachment, 
  getEmployeeAttachments,
  deleteEmployeeAttachment,

  getEmployeeAttendance,
  getEmployeeLeaveRequests,
  createEmployeeLeaveRequest,
  getAllLeaveRequests,
  updateLeaveRequestStatus,
  getEmployeeSkills,
  getEmployeeCertifications,
  getEmployeeEvaluations,
  getEmployeePromotions,
  getEmployeePermissions,
  updateEmployeeStatus,
  updateEmployeePromotion,
  createEmployee,
  getEmployeesWithStats,
  getEmployeeAttendanceAnalysis,
  getEmployeeById,
  createEmployeeContract,
  getAllEmployeeContracts,
  renewEmployeeAttachment,
} = require("../controllers/employeeController");

router.route("/").get(getAllEmployees).post(createEmployee);
router.get("/with-stats", getEmployeesWithStats);
router.route("/me").get(protect, getMe);
router.post("/analyze", protect, uploadEmployeeDoc.single("contractFile"), analyzeEmploymentContract);

router.get("/all/leave-requests", protect, getAllLeaveRequests);
router.put("/leave-requests/:leaveId/status", protect, updateLeaveRequestStatus);
router.post("/contracts/auto-link", protect, createEmployeeContract); // مسار حفظ وربط العقد التلقائي
router.get("/all/contracts", protect, getAllEmployeeContracts);

router.route("/:id")
  .get(getEmployeeById)
  .put(updateEmployee)
  .delete(deleteEmployee);

router.get("/:id/attendance", getEmployeeAttendance);
router.get("/:id/attendance-analysis", getEmployeeAttendanceAnalysis);
router.get("/:id/leave-requests", getEmployeeLeaveRequests);
router.post("/:id/leave-requests", createEmployeeLeaveRequest);
router.get("/:id/skills", getEmployeeSkills);
router.get("/:id/certifications", getEmployeeCertifications);
router.get("/:id/evaluations", getEmployeeEvaluations);
router.get("/:id/promotions", getEmployeePromotions);
router.get("/:id/permissions", getEmployeePermissions);
router.patch("/:id/status", updateEmployeeStatus);
router.post("/:id/promotion", updateEmployeePromotion);

// ==============================================================
// 🚀 مسارات محرك مستندات الموظف
// ==============================================================
// 1. جلب مرفقات موظف معين
router.get("/:id/attachments", protect, getEmployeeAttachments);

// 2. رفع مرفق لموظف معين
router.post("/:id/attachments", protect, uploadEmployeeDoc.single("file"), uploadEmployeeAttachment);

// 3. 🚀 تجديد مستند منتهي (المسار الجديد)
router.post("/attachments/:attachmentId/renew", protect, uploadEmployeeDoc.single("file"), renewEmployeeAttachment);

// 4. حذف مرفق (للموظف)
router.delete("/attachments/:attachmentId", protect, deleteEmployeeAttachment);

module.exports = router;
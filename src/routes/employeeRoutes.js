// routes/employeeRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { protect } = require("../middleware/authMiddleware");

// ==============================================================
// 🛠️ إعداد Multer المخصص لمرفقات الموظفين
// ==============================================================
const employeeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // المسار المخصص لمرفقات الـ HR
    const dest = path.join(__dirname, "../../uploads/employees");
    
    // إنشاء المجلد إذا لم يكن موجوداً
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // تنظيف الاسم وإنشاء اسم فريد
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.\-_أ-ي]/g, "_").replace(/\s+/g, "_");
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
} = require("../controllers/employeeController");

router.route("/").get(getAllEmployees).post(createEmployee);
router.get("/with-stats", getEmployeesWithStats);
router.route("/me").get(protect, getMe);

router.get("/all/leave-requests", protect, getAllLeaveRequests);
router.put("/leave-requests/:leaveId/status", protect, updateLeaveRequestStatus);

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

// 3. حذف مرفق (للموظف) - لاحظ أننا نستخدم :attachmentId
router.delete("/attachments/:attachmentId", protect, deleteEmployeeAttachment);

module.exports = router;
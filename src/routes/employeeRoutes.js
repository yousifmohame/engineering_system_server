// routes/employeeRoutes.js
const express = require("express");
const router = express.Router();

// استيراد الوظائف من الـ Controller
const {
  getMe,
  getAllEmployees,
  updateEmployee,
  deleteEmployee,
  getEmployeeAttachments,
  getEmployeeAttendance,
  getEmployeeLeaveRequests,
  getEmployeeSkills,
  getEmployeeCertifications,
  getEmployeeEvaluations,
  getEmployeePromotions,
  getEmployeePermissions,
  updateEmployeeStatus,
  updateEmployeePromotion,
  createEmployee,
  getEmployeesWithStats,
} = require("../controllers/employeeController");

router.route("/")
  .get(getAllEmployees)
  .post(createEmployee);
// حماية جميع المسارات التالية


router.get('/with-stats', getEmployeesWithStats);
// GET /api/employees/me -> جلب بياناتي (من التوكن)
router.route("/me").get(getMe);


// GET /api/employees -> جلب كل الموظفين (لشاشة 817)


// PUT /api/employees/:id -> تحديث موظف
// DELETE /api/employees/:id -> حذف/أرشفة موظف
router.route("/:id").put(updateEmployee).delete(deleteEmployee);

router.get("/:id/attendance", getEmployeeAttendance);

// (تاب 817-07) جلب طلبات الإجازات
router.get("/:id/leave-requests", getEmployeeLeaveRequests);
router.get("/:id/skills", getEmployeeSkills);
router.get("/:id/certifications", getEmployeeCertifications);

// (تاب 817-09)
router.get("/:id/evaluations", getEmployeeEvaluations);

// (تاب 817-10)
router.get("/:id/promotions", getEmployeePromotions);

// (تاب 817-11) - (ملف Attachment موجود بالفعل في الـ Schema)
router.get("/:id/attachments", getEmployeeAttachments);

// (نافذة الصلاحيات)
router.get("/:id/permissions", getEmployeePermissions);

// (النوافذ المنبثقة)
router.patch("/:id/status", updateEmployeeStatus);
router.post("/:id/promotion", updateEmployeePromotion);

module.exports = router;
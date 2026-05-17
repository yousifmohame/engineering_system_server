// routes/employeeRoutes.js
const express = require("express");
const router = express.Router();

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
  getEmployeeAttendanceAnalysis, // 👈 تم استيراد الدالة الذكية الجديدة
  
} = require("../controllers/employeeController");

router.route("/").get(getAllEmployees).post(createEmployee);
router.get("/with-stats", getEmployeesWithStats);
router.route("/me").get(getMe);
router.route("/:id").put(updateEmployee).delete(deleteEmployee);

router.get("/:id/attendance", getEmployeeAttendance);

// 🚀 👈 المسار الجديد الخاص بمحرك التايم شيت الذكي
router.get("/:id/attendance-analysis", getEmployeeAttendanceAnalysis);

router.get("/:id/leave-requests", getEmployeeLeaveRequests);
router.get("/:id/skills", getEmployeeSkills);
router.get("/:id/certifications", getEmployeeCertifications);
router.get("/:id/evaluations", getEmployeeEvaluations);
router.get("/:id/promotions", getEmployeePromotions);
router.get("/:id/attachments", getEmployeeAttachments);
router.get("/:id/permissions", getEmployeePermissions);
router.patch("/:id/status", updateEmployeeStatus);
router.post("/:id/promotion", updateEmployeePromotion);

module.exports = router;
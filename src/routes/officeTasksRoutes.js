const express = require("express");
const router = express.Router();
const controller = require("../controllers/officeTasksController");
const upload = require('../middleware/uploadMiddleware');

// مهام المكتب الأساسية
router.get("/", controller.getTasks);
router.post("/", upload.single("file"), controller.createTask); // دعم رفع ملف عند الإنشاء
router.put("/:id", upload.single("file"), controller.updateTask); // دعم تعديل المهمة ورفع ملف جديد
router.delete("/:id", controller.deleteTask);

// إدارة الحالة
router.put("/:id/status", controller.updateTaskStatus);

// المهام الفرعية
router.post("/:id/subtasks", controller.addSubTask);
router.put("/subtasks/:subtaskId", controller.updateSubTask);
router.put("/subtasks/:subtaskId/toggle", controller.toggleSubTask);
router.delete("/subtasks/:subtaskId", controller.deleteSubTask);

// التعليقات
// التعليقات
router.post("/:id/comments", controller.addComment); // موجود مسبقاً
router.put("/comments/:commentId", controller.updateComment); // 👈 السطر الجديد للتعديل
router.delete("/comments/:commentId", controller.deleteComment); // 👈 السطر الجديد للحذف

module.exports = router;

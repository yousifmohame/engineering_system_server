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
router.put("/subtasks/:subtaskId/toggle", controller.toggleSubTask);
router.delete("/subtasks/:subtaskId", controller.deleteSubTask);

// التعليقات
router.post("/:id/comments", controller.addComment);

module.exports = router;

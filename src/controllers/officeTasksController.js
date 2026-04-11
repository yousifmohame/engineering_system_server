const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 💡 دالة مساعدة لمعالجة بيانات الموظفين القادمة من الواجهة
const parseEmployees = (data) => {
    if (!data) return [];
    if (typeof data === 'string') {
        try { return JSON.parse(data); } catch (e) { return []; }
    }
    return data;
};

// 1. جلب كافة المهام
exports.getTasks = async (req, res) => {
  try {
    const tasks = await prisma.officeTask.findMany({
      include: { 
        subTasks: { orderBy: { createdAt: 'asc' } }, 
        comments: { orderBy: { createdAt: 'asc' } } 
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: tasks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 2. إنشاء مهمة جديدة مع دعم المرفقات
exports.createTask = async (req, res) => {
  try {
    const data = req.body;
    const filePath = req.file ? `/uploads/tasks/${req.file.filename}` : (data.filePath || "");

    const task = await prisma.officeTask.create({
      data: {
        description: data.description,
        priority: data.priority || "medium",
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        filePath: filePath,
        additionalNotes: data.additionalNotes || "",
        assignedEmployees: parseEmployees(data.assignedEmployees),
        creatorName: data.creatorName || "المستخدم",
        status: "active"
      },
      include: { subTasks: true, comments: true }
    });
    res.status(201).json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 3. تعديل المهمة بالكامل
exports.updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    
    const updateData = {
      description: data.description,
      priority: data.priority,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      status: data.status,
      additionalNotes: data.additionalNotes,
      assignedEmployees: parseEmployees(data.assignedEmployees),
    };

    if (req.file) {
      updateData.filePath = `/uploads/tasks/${req.file.filename}`;
    }

    const updatedTask = await prisma.officeTask.update({
      where: { id },
      data: updateData,
      include: { subTasks: true, comments: true }
    });

    res.json({ success: true, data: updatedTask });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 4. تغيير حالة المهمة وإضافة تعليق نظام آلي
exports.updateTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, commentText, authorName } = req.body;

    const task = await prisma.officeTask.update({
      where: { id },
      data: { status }
    });

    // إضافة تعليق تلقائي في سجل التعليقات يوضح تغيير الحالة
    await prisma.taskComment.create({
      data: {
        taskId: id,
        text: `📢 تم تغيير الحالة إلى [${status}] ${commentText ? '- ' + commentText : ''}`,
        authorName: authorName || "النظام",
        isSystem: true
      }
    });

    res.json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 5. إدارة المهام الفرعية (إضافة / تبديل حالة / حذف)
exports.addSubTask = async (req, res) => {
  try {
    const subTask = await prisma.subTask.create({
      data: { taskId: req.params.id, title: req.body.title }
    });
    res.json({ success: true, data: subTask });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.toggleSubTask = async (req, res) => {
  try {
    const { subtaskId } = req.params;
    const existing = await prisma.subTask.findUnique({ where: { id: subtaskId } });
    const subTask = await prisma.subTask.update({
      where: { id: subtaskId },
      data: { isCompleted: !existing.isCompleted }
    });
    res.json({ success: true, data: subTask });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteSubTask = async (req, res) => {
    try {
      await prisma.subTask.delete({ where: { id: req.params.subtaskId } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
};

// 6. إضافة تعليق يدوي
exports.addComment = async (req, res) => {
  try {
    const comment = await prisma.taskComment.create({
      data: {
        taskId: req.params.id,
        text: req.body.text,
        authorName: req.body.authorName || "المستخدم",
        isSystem: false
      }
    });
    res.json({ success: true, data: comment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 7. حذف المهمة نهائياً (سيتم حذف المهام الفرعية والتعليقات تلقائياً بسبب onDelete: Cascade في الـ Prisma)
exports.deleteTask = async (req, res) => {
  try {
    await prisma.officeTask.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "تم حذف المهمة نهائياً" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
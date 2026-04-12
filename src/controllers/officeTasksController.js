const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 💡 دالة توليد السريال الذكي (تضمن عدم التكرار)
const generateSmartSerial = async (modelName, prefix) => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, ""); // 20260411
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));

  const countToday = await prisma[modelName].count({
    where: { createdAt: { gte: startOfDay, lte: endOfDay } },
  });

  const sequence = String(countToday + 1).padStart(3, "0");
  return `${prefix}-${dateStr}-${sequence}`;
};

const parseEmployees = (data) => {
  if (!data) return [];
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  }
  return data;
};

// 1. جلب كافة المهام (مع جلب بيانات العميل والمعاملة المرتبطة)
exports.getTasks = async (req, res) => {
  try {
    const tasks = await prisma.officeTask.findMany({
      include: {
        subTasks: { orderBy: { createdAt: "asc" } },
        comments: { orderBy: { createdAt: "asc" } },
        client: { select: { name: true } },
        transaction: { select: { transactionCode: true, title: true } },
        ownership: { select: { deedNumber: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: tasks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 2. إنشاء مهمة جديدة (دعم كامل للربط، المرفقات، السريال، والعنوان)
exports.createTask = async (req, res) => {
  try {
    const data = req.body;
    const filePath = req.file
      ? `/uploads/tasks/${req.file.filename}`
      : data.filePath || "";

    const serial = await generateSmartSerial("officeTask", "T");

    const task = await prisma.officeTask.create({
      data: {
        serialNumber: serial,
        title: data.title || "مهمة بدون عنوان", // 👈 إضافة حقل العنوان الجديد
        description: data.description,
        priority: data.priority || "medium",
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        filePath: filePath,
        additionalNotes: data.additionalNotes || "",
        assignedEmployees: parseEmployees(data.assignedEmployees),
        creatorName: data.creatorName || "المستخدم",
        status: "active",
        clientId: data.clientId || null,
        transactionId: data.transactionId || null,
        ownershipId: data.ownershipId || null,
      },
      include: {
        subTasks: true,
        comments: true,
        client: true,
        transaction: true,
      },
    });
    res.status(201).json({ success: true, data: task });
  } catch (error) {
    console.error("Create Task Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// 3. تعديل المهمة (تحديث العنوان والبيانات الأخرى)
exports.updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updateData = {
      title: data.title, // 👈 تحديث حقل العنوان
      description: data.description,
      priority: data.priority,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      status: data.status,
      additionalNotes: data.additionalNotes,
      assignedEmployees: parseEmployees(data.assignedEmployees),
      clientId: data.clientId || null,
      transactionId: data.transactionId || null,
      ownershipId: data.ownershipId || null,
    };

    if (req.file) {
      updateData.filePath = `/uploads/tasks/${req.file.filename}`;
    }

    const updatedTask = await prisma.officeTask.update({
      where: { id },
      data: updateData,
      include: { subTasks: true, comments: true },
    });

    res.json({ success: true, data: updatedTask });
  } catch (error) {
    console.error("Update Task Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// --- إدارة الحالات والتعليقات ---
exports.updateTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, commentText, authorName } = req.body;

    const task = await prisma.officeTask.update({
      where: { id },
      data: { status },
    });

    await prisma.taskComment.create({
      data: {
        taskId: id,
        text: `📢 تم تغيير الحالة إلى [${status}] ${commentText ? "- " + commentText : ""}`,
        authorName: authorName || "النظام",
        isSystem: true,
      },
    });

    res.json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// --- إدارة المهام الفرعية ---
exports.addSubTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, authorName } = req.body;

    const serial = await generateSmartSerial("subTask", "ST");
    const subTask = await prisma.subTask.create({
      data: {
        serialNumber: serial,
        taskId: id,
        title: title,
        authorName: authorName || "غير معروف",
      },
    });

    res.json({ success: true, data: subTask });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.toggleSubTask = async (req, res) => {
  try {
    const { subtaskId } = req.params;
    const existing = await prisma.subTask.findUnique({
      where: { id: subtaskId },
    });
    const subTask = await prisma.subTask.update({
      where: { id: subtaskId },
      data: { isCompleted: !existing.isCompleted },
    });
    res.json({ success: true, data: subTask });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.addComment = async (req, res) => {
  try {
    const comment = await prisma.taskComment.create({
      data: {
        taskId: req.params.id,
        text: req.body.text,
        authorName: req.body.authorName || "المستخدم",
        isSystem: false,
      },
    });
    res.json({ success: true, data: comment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { text } = req.body;
    const updatedComment = await prisma.taskComment.update({
      where: { id: commentId },
      data: { text },
    });
    res.json({ success: true, data: updatedComment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    await prisma.taskComment.delete({ where: { id: commentId } });
    res.json({ success: true, message: "تم حذف التعليق بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    await prisma.officeTask.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "تم حذف المهمة نهائياً" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateSubTask = async (req, res) => {
  try {
    const { subtaskId } = req.params;
    const { title } = req.body;
    const updatedSubTask = await prisma.subTask.update({
      where: { id: subtaskId },
      data: { title },
    });
    res.json({ success: true, data: updatedSubTask });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteSubTask = async (req, res) => {
  try {
    const { subtaskId } = req.params;
    await prisma.subTask.delete({ where: { id: subtaskId } });
    res.json({ success: true, message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

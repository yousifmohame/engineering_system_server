const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const generateNextTaskCode = async () => {
  const year = new Date().getFullYear();
  const prefix = `TSK-${year}-`;

  const lastTask = await prisma.task.findFirst({
    where: { taskNumber: { startsWith: prefix } },
    orderBy: { taskNumber: 'desc' },
  });

  let nextNumber = 1;
  if (lastTask) {
    try {
      const lastNumberStr = lastTask.taskNumber.split('-')[2];
      nextNumber = parseInt(lastNumberStr) + 1;
    } catch (e) {
      nextNumber = 1;
    }
  }
  
  return `${prefix}${String(nextNumber).padStart(5, '0')}`; // TSK-2025-00001
};


// @desc    جلب المهام الخاصة بالموظف المسجل دخوله (لشاشة 999)
// @route   GET /api/tasks/my-tasks
const getMyTasks = async (req, res) => {
  try {
    const employeeId = req.user.id; // <-- من middleware (protect)

    const tasks = await prisma.task.findMany({
      where: {
        assignedToId: employeeId, // <-- [مهم] الفلترة هنا
      },
      include: {
        transaction: {
          select: {
            transactionCode: true,
          },
        },
        // (يمكن إضافة assignedBy لاحقاً)
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    // تنسيق البيانات لتطابق الواجهة
    const formattedTasks = tasks.map(task => ({
      ...task,
      // (الواجهة تتوقع transactionNumber وليس transaction.transactionCode)
      transactionNumber: task.transaction?.transactionCode || 'N/A',
      // (الواجهة تتوقع assignedBy كاسم، سنحتاج لتعديلها لاحقاً)
      assignedBy: 'النظام' // (قيمة مؤقتة، يجب جلب اسم المسند)
    }));

    res.status(200).json(formattedTasks);

  } catch (error) {
    console.error('Error fetching my tasks:', error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};


// @desc    إنشاء مهمة جديدة
// @route   POST /api/tasks
const createTask = async (req, res) => {
  try {
    const {
      title,
      description,
      status,
      dueDate,
      priority,
      estimatedHours, // (هذا من الخطأ السابق)
      progress,
      category,
      fees,
      transactionId,
      assignedToId
    } = req.body;
    
    const assignedById = req.user.id; // (الموظف الحالي هو من أنشأها)

    if (!title || !transactionId) {
      return res.status(400).json({ message: 'العنوان و ID المعاملة مطلوبان' });
    }

    // --- [جديد] ---
    const taskNumber = await generateNextTaskCode();

    const newTask = await prisma.task.create({
      data: {
        taskNumber, // <-- [جديد]
        title,
        description,
        status: status || 'not-received',
        dueDate: dueDate ? new Date(dueDate) : null,
        
        // --- الحقول الجديدة من الـ Schema ---
        priority: priority || 'medium',
        progress: progress || 0,
        category: category,
        fees: fees,
        assignedById: assignedById,
        // ------------------------------------

        transaction: {
          connect: { id: transactionId }
        },
        ...(assignedToId && {
          assignedTo: {
            connect: { id: assignedToId }
          }
        })
      }
    });
    res.status(201).json(newTask);
  } catch (error) {
    console.error('Error creating task:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'بيانات مكررة' });
    }
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// @desc    تحديث مهمة
// @route   PUT /api/tasks/:id
const updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const dataToUpdate = req.body;
    
    // (إزالة الحقول التي لا يجب تحديثها بهذه الطريقة)
    delete dataToUpdate.id;
    delete dataToUpdate.taskNumber;
    delete dataToUpdate.transactionId;
    delete dataToUpdate.assignedToId;

    const updatedTask = await prisma.task.update({
      where: { id: id },
      data: {
        ...dataToUpdate,
        ...(dataToUpdate.dueDate && { dueDate: new Date(dataToUpdate.dueDate) }),
      },
    });
    res.status(200).json(updatedTask);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// 1. جلب جميع المهام (مع البيانات التفصيلية)
const getAllTasks = async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      include: {
        // لجلب بيانات الموظف المسند إليه
        assignedTo: {
          select: {
            id: true,
            name: true,
            employeeCode: true
          }
        },
        // لجلب بيانات المعاملة
        transaction: {
          select: {
            id: true,
            transactionCode: true,
            description: true // (أو أي حقل يمثل "العنوان")
          }
        }
      }
    });

    // 💡 إعادة هيكلة البيانات لتطابق الواجهة الأمامية
    const detailedTasks = tasks.map(task => ({
      ...task,
      taskNumber: task.id, // يمكنك تغييره إذا كان لديك حقل مخصص
      transactionTitle: task.transaction?.description || 'معاملة غير معنونة',
      transactionCode: task.transaction?.transactionCode || 'N/A',
      // ... باقي الحقول موجودة بالفعل
    }));

    res.status(200).json(detailedTasks); // إرسال البيانات المفصلة

  } catch (error) {
    res.status(500).json({ message: 'Error fetching tasks', error: error.message });
  }
};


// 3. جلب مهمة واحدة
const getTaskById = async (req, res) => {
  try {
    const { id } = req.params;
    const task = await prisma.task.findUnique({
      where: { id },
      include: { assignedTo: true, transaction: true } // (جلب البيانات المرتبطة)
    });
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }
    res.status(200).json(task);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching task', error: error.message });
  }
};

// 5. حذف مهمة
const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.task.delete({
      where: { id }
    });
    res.status(200).json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting task', error: error.message });
  }
};

// --- (دوال إضافية للـ Dialogs) ---

// 6. تحديث حالة المهمة (للإلغاء، الإكمال، التجميد)
const updateTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, ...otherData } = req.body; // (مثل: frozenReason, progress)

    const task = await prisma.task.update({
      where: { id },
      data: {
        status: status,
        notes: notes,
        ...otherData // (لتمرير أي بيانات إضافية مثل التجميد أو نسبة الإنجاز)
      }
    });
    res.status(200).json(task);
  } catch (error) {
    res.status(500).json({ message: 'Error updating task status', error: error.message });
  }
};

// 7. تحويل مهمة (تغيير الموظف)
const transferTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { newEmployeeId, transferReason } = req.body;
    // const transferBy = req.user.id; // (المشرف الذي قام بالتحويل)

    const task = await prisma.task.update({
      where: { id },
      data: {
        assignedToId: newEmployeeId,
        // (يمكن إضافة سجل للتحويل في الملاحظات)
        notes: `تم التحويل إلى موظف جديد. السبب: ${transferReason}`
      }
    });
    res.status(200).json(task);
  } catch (error) {
    res.status(500).json({ message: 'Error transferring task', error: error.message });
  }
};


// (تصدير جميع الدوال)
module.exports = {
  getMyTasks,
  getAllTasks,
  createTask,
  getTaskById,
  updateTask,
  deleteTask,
  updateTaskStatus,
  transferTask
};
// controllers/followUpController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ============================================================
// 1. إدارة المعقبين (Agents)
// ============================================================

// إنشاء معقب جديد (فرد أو كيان)
const createAgent = async (req, res) => {
  try {
    const {
      type, name, nationalId, commercialRegister,
      phone, email, address, specialization, governmentEntities, notes
    } = req.body;

    // التحقق من التكرار (رقم الهوية أو السجل)
    if (nationalId) {
      const exists = await prisma.followUpAgent.findFirst({ where: { nationalId } });
      if (exists) return res.status(400).json({ message: 'رقم الهوية مسجل مسبقاً' });
    }
    if (commercialRegister) {
      const exists = await prisma.followUpAgent.findFirst({ where: { commercialRegister } });
      if (exists) return res.status(400).json({ message: 'السجل التجاري مسجل مسبقاً' });
    }

    const newAgent = await prisma.followUpAgent.create({
      data: {
        type, name, nationalId, commercialRegister,
        phone, email, address,
        specialization: specialization || [], // مصفوفة
        governmentEntities: governmentEntities || [], // مصفوفة
        notes,
        status: 'active'
      }
    });

    res.status(201).json(newAgent);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'فشل في إنشاء المعقب', error: error.message });
  }
};

// جلب جميع المعقبين مع الإحصائيات المحسوبة
const getAllAgents = async (req, res) => {
  try {
    const { type, status } = req.query;

    // بناء فلتر البحث
    const where = {};
    if (type && type !== 'all') where.type = type;
    if (status && status !== 'all') where.status = status;

    const agents = await prisma.followUpAgent.findMany({
      where,
      include: {
        tasks: true // جلب المهام لحساب الإحصائيات
      },
      orderBy: { createdAt: 'desc' }
    });

    // ✅ حساب الإحصائيات ديناميكياً لكل معقب
    const agentsWithStats = agents.map(agent => {
      const totalTasks = agent.tasks.length;
      const successfulTasks = agent.tasks.filter(t => t.successStatus === 'success').length;
      const failedTasks = agent.tasks.filter(t => t.successStatus === 'failed').length;
      const activeTasks = agent.tasks.filter(t => ['pending', 'in-progress'].includes(t.status)).length;
      
      // حساب نسبة النجاح
      const successRate = totalTasks > 0 
        ? parseFloat(((successfulTasks / totalTasks) * 100).toFixed(1)) 
        : 0;

      // حساب متوسط وقت الإنجاز (تقريبي)
      // يمكن تطويره لاحقاً ليحسب الفرق بين تاريخ البدء والانتهاء الفعلي
      const averageCompletionTime = 3; // قيمة افتراضية حالياً

      // تنظيف الكائن (إزالة المهام التفصيلية لتخفيف الحمل)
      const { tasks, ...agentData } = agent;

      return {
        ...agentData,
        totalTasks,
        successfulTasks,
        failedTasks,
        activeTransactions: activeTasks, // نعتبر المهام النشطة كمعاملات نشطة
        totalTransactions: totalTasks,   // مجازاً
        completedTransactions: successfulTasks,
        successRate,
        averageCompletionTime
      };
    });

    res.json(agentsWithStats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'فشل في جلب المعقبين', error: error.message });
  }
};

// جلب تفاصيل معقب واحد
const getAgentById = async (req, res) => {
  try {
    const { id } = req.params;
    const agent = await prisma.followUpAgent.findUnique({
      where: { id },
      include: {
        tasks: {
          include: { transaction: { select: { title: true, transactionCode: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!agent) return res.status(404).json({ message: 'المعقب غير موجود' });

    res.json(agent);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

// تحديث بيانات معقب
const updateAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedAgent = await prisma.followUpAgent.update({
      where: { id },
      data: req.body
    });
    res.json(updatedAgent);
  } catch (error) {
    res.status(500).json({ message: 'فشل التحديث', error: error.message });
  }
};

// ============================================================
// 2. إدارة المهام (Tasks)
// ============================================================

// إسناد مهمة جديدة لمعقب
const createTask = async (req, res) => {
  try {
    const { 
      agentId, transactionId, governmentEntity, description, 
      startDate, targetDate, notes 
    } = req.body;

    const newTask = await prisma.followUpTask.create({
      data: {
        agentId,
        transactionId,
        governmentEntity,
        description,
        startDate: startDate ? new Date(startDate) : new Date(),
        targetDate: targetDate ? new Date(targetDate) : null,
        notes,
        status: 'pending',
        attempts: 0
      }
    });

    res.status(201).json(newTask);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'فشل في إسناد المهمة', error: error.message });
  }
};

// تحديث حالة المهمة (إضافة تعقيب/إنجاز)
const updateTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, successStatus, feedback, addAttempt } = req.body;

    const updateData = {};
    if (status) updateData.status = status;
    if (successStatus) updateData.successStatus = successStatus;
    
    // إذا تم الانتهاء، نضع تاريخ الانتهاء
    if (status === 'completed' || status === 'failed') {
      updateData.completionDate = new Date();
    }

    // زيادة عدد المحاولات
    if (addAttempt) {
      updateData.attempts = { increment: 1 };
    }

    // إضافة إفادة جديدة للمصفوفة
    if (feedback) {
      updateData.feedbacks = { push: feedback };
    }

    const updatedTask = await prisma.followUpTask.update({
      where: { id },
      data: updateData
    });

    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ message: 'فشل تحديث المهمة', error: error.message });
  }
};

// جلب سجل المهام (للتاب 937-08)
const getAllTasks = async (req, res) => {
  try {
    const tasks = await prisma.followUpTask.findMany({
      include: {
        agent: { select: { name: true, type: true } },
        transaction: { select: { title: true, transactionCode: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    // تنسيق البيانات لتطابق الواجهة
    const formattedTasks = tasks.map(t => ({
      id: t.id,
      agentId: t.agentId,
      agentName: t.agent.name,
      transactionId: t.transaction?.transactionCode,
      transactionTitle: t.transaction?.title,
      governmentEntity: t.governmentEntity,
      taskDescription: t.description,
      startDate: t.startDate,
      status: t.status,
      attempts: t.attempts,
      successStatus: t.successStatus,
      feedbacks: t.feedbacks
    }));

    res.json(formattedTasks);
  } catch (error) {
    res.status(500).json({ message: 'فشل جلب المهام', error: error.message });
  }
};

module.exports = {
  createAgent,
  getAllAgents,
  getAgentById,
  updateAgent,
  createTask,
  updateTaskStatus,
  getAllTasks
};
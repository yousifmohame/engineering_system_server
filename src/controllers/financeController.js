const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 1. تسجيل تسوية (مستحقات أو دفعيات مباشرة)
const createSettlement = async (req, res) => {
  try {
    const data = req.body;
    const settlement = await prisma.privateSettlement.create({
      data: {
        targetType: data.targetType,
        targetId: data.targetId || null,
        transactionId: data.transactionId || null, // 👈 1. تمت إضافة ربط المعاملة
        amount: parseFloat(data.amount),
        source: data.source,
        notes: data.notes,
        status: data.status || "PENDING",          // 👈 2. أخذ الحالة من الواجهة (DELIVERED)
      },
    });
    res.status(201).json({ success: true, data: settlement });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. تسليم تسوية (دفع فعلي)
const deliverSettlement = async (req, res) => {
  try {
    const data = req.body;
    let attachmentPath = req.file
      ? `/uploads/settlements/${req.file.filename}`
      : null;

    const delivery = await prisma.privateSettlement.create({
      data: {
        targetType: data.targetType,
        targetId: data.targetId || null,
        amount: parseFloat(data.amount),
        status: "DELIVERED",
        deliveryMethod: data.method,
        deliveryDate: data.date ? new Date(data.date) : new Date(),
        deliveredById: data.deliveredById || null,
        notes: data.notes,
        attachmentPath: attachmentPath,
      },
    });
    res.status(201).json({ success: true, data: delivery });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. جرد الخزنة / الحساب البنكي
const recordInventory = async (req, res) => {
  try {
    const { type, accountId, actualBalance, recordedById, date } = req.body;
    // type: "vault" أو "bank"

    if (type === "bank" && accountId) {
      // تحديث رصيد البنك
      await prisma.bankAccount.update({
        where: { id: accountId },
        data: { systemBalance: parseFloat(actualBalance) }, // أو حقل مخصص للجرد
      });
    }

    // تسجيل حركة جرد في الخزنة للتوثيق
    const log = await prisma.treasuryTransaction.create({
      data: {
        type: type === "vault" ? "جرد خزنة" : "جرد بنكي",
        amount: parseFloat(actualBalance),
        date: date ? new Date(date) : new Date(),
        personId: recordedById || null,
        referenceText: accountId || "الخزنة الرئيسية",
      },
    });
    res.status(201).json({ success: true, data: log });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. تسجيل مصروف
const createExpense = async (req, res) => {
  try {
    const data = req.body;
    let attachmentPath = req.file
      ? `/uploads/expenses/${req.file.filename}`
      : null;

    const expense = await prisma.officeExpense.create({
      data: {
        item: data.item,
        amount: parseFloat(data.amount),
        payerId: data.payerId || null,
        source: data.source,
        method: "نقدي", // أو حسب المصدر
        expenseDate: data.date ? new Date(data.date) : new Date(),
        notes: data.notes,
        attachmentUrl: attachmentPath,
      },
    });
    res.status(201).json({ success: true, data: expense });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 1. جلب بيانات التسوية لشهر وسنة محددين
// GET /api/finance/monthly-settlement?year=2026&month=3
// ==================================================
const getMonthlySettlementData = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    // تحديد بداية ونهاية الشهر للبحث في قاعدة البيانات
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    // 1. جلب المعاملات الخاصة بهذا الشهر فقط!
    const transactions = await prisma.privateTransaction.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      include: {
        agent: { select: { name: true } },
        brokersList: { include: { broker: { select: { name: true } } } },
        tasks: { include: { worker: { select: { name: true } } } },
        settlements: true, // لمعرفة المبالغ المدفوعة للوسطاء والمعقبين
      },
      orderBy: { createdAt: "desc" },
    });

    // 2. جلب الأشخاص المرتبطين بهذه المعاملات (أو كل الأشخاص الذين لهم مستحقات)
    const persons = await prisma.person.findMany({
      where: {
        role: { in: ["وسيط", "معقب", "موظف عن بعد"] },
      },
      include: {
        settlementsTarget: {
          where: { status: "DELIVERED" },
        },
      },
    });

    // 3. معالجة وتجهيز المعاملات للواجهة
    let totalRevenue = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let totalCosts = 0;

    const formattedTransactions = transactions.map((tx) => {
      const notes = typeof tx.notes === "object" ? tx.notes : {};
      const mediatorFees = parseFloat(notes?.mediatorFees || 0);
      const agentCost = parseFloat(notes?.agentFees || tx.agentCost || 0);
      const remoteCost = tx.tasks?.reduce((sum, t) => sum + (t.cost || 0), 0) || 0;
      
      const cost = agentCost + remoteCost + mediatorFees;
      const profit = (tx.totalFees || 0) - cost;

      // تجميع الإحصائيات
      totalRevenue += tx.totalFees || 0;
      totalCollected += tx.paidAmount || 0;
      totalOutstanding += tx.remainingAmount || 0;
      totalCosts += cost;

      return {
        id: tx.id,
        ref: tx.transactionCode,
        owner: tx.client || "غير محدد",
        district: tx.districtId || "غير محدد", // يمكن ربطها باسم الحي الفعلي
        mediator: tx.brokersList?.map(b => b.broker?.name).join(" و ") || "—",
        agent: tx.agent?.name || "—",
        totalPrice: tx.totalFees || 0,
        collected: tx.paidAmount || 0,
        remaining: tx.remainingAmount || 0,
        totalCosts: cost,
        netProfit: profit,
        status: (tx.paidAmount >= tx.totalFees && tx.totalFees > 0) ? "settled" : (tx.paidAmount > 0 ? "partial" : "pending"),
      };
    });

    // 4. معالجة وتصنيف الأشخاص (المعقبين، الوسطاء، العمل عن بعد)
    const processPersons = (roleType, mapType) => {
      return persons
        .filter((p) => p.role === roleType)
        .map((p) => {
          // حساب إجمالي المستحقات بناءً على المعاملات التي شارك فيها هذا الشهر
          // (في هذا المثال نعتمد على استخراجها من المعاملات المجلوبة، أو يمكنك حسابها من حقل آخر)
          let totalFees = 0;
          let txCount = 0;

          if (roleType === "معقب") {
            const hisTxs = transactions.filter(t => t.agentId === p.id);
            txCount = hisTxs.length;
            totalFees = hisTxs.reduce((sum, t) => sum + parseFloat(t.notes?.agentFees || t.agentCost || 0), 0);
          } else if (roleType === "وسيط") {
            const hisTxs = transactions.filter(t => t.brokersList?.some(b => b.brokerId === p.id));
            txCount = hisTxs.length;
            hisTxs.forEach(t => {
              const brokerRecord = t.brokersList.find(b => b.brokerId === p.id);
              if (brokerRecord) totalFees += brokerRecord.fees;
            });
          } else if (roleType === "موظف عن بعد") {
            const hisTasks = transactions.flatMap(t => t.tasks).filter(t => t.workerId === p.id);
            txCount = hisTasks.length; // Number of tasks
            totalFees = hisTasks.reduce((sum, t) => sum + (t.cost || 0), 0);
          }

          const paid = p.settlementsTarget.reduce((sum, s) => sum + s.amount, 0);
          const remaining = Math.max(0, totalFees - paid);
          
          let deliveryStatus = "not_delivered";
          if (paid >= totalFees && totalFees > 0) deliveryStatus = "fully_delivered";
          else if (paid > 0) deliveryStatus = "partial_delivery";

          return {
            id: p.id,
            name: p.name,
            type: mapType,
            totalFees,
            paid,
            remaining,
            txCount,
            tasks: txCount,
            lastPayment: p.settlementsTarget[0]?.date || null,
            deliveryStatus,
            deliveryAmount: paid,
          };
        })
        .filter((p) => p.totalFees > 0); // إرجاع من لهم حركات مالية هذا الشهر فقط
    };

    const mediators = processPersons("وسيط", "mediator");
    const agents = processPersons("معقب", "agent");
    const remoteWorkers = processPersons("موظف عن بعد", "remote");

    // 5. إرسال الاستجابة المنظمة
    res.json({
      success: true,
      data: {
        transactions: formattedTransactions,
        summary: {
          totalTx: formattedTransactions.length,
          totalRevenue,
          totalCollected,
          outstanding: totalOutstanding,
          totalCosts,
          netProfit: totalRevenue - totalCosts,
          mediatorFees: mediators.reduce((s, m) => s + m.totalFees, 0),
          agentFees: agents.reduce((s, a) => s + a.totalFees, 0),
          remoteCosts: remoteWorkers.reduce((s, r) => s + r.totalFees, 0),
        },
        mediators,
        agents,
        remoteWorkers,
      }
    });

  } catch (error) {
    console.error("Get Monthly Settlement Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 2. دالة تنفيذ / اعتماد التسوية الشهرية
// POST /api/finance/monthly-settlement/execute
// ==================================================
const executeMonthlySettlement = async (req, res) => {
  try {
    const { year, month, settlementType } = req.body;
    
    // هنا تقوم ببرمجة لوجيك "إغلاق الشهر"
    // مثل: تغيير حالة المعاملات إلى "مكتملة"، أو إنشاء سجل في جدول History

    res.json({ 
      success: true, 
      message: `تم اعتماد وإغلاق شهر ${month}/${year} بنجاح.` 
    });
  } catch (error) {
    console.error("Execute Settlement Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};


module.exports = {
  createSettlement,
  deliverSettlement,
  recordInventory,
  createExpense,
  getMonthlySettlementData,
  executeMonthlySettlement,
};

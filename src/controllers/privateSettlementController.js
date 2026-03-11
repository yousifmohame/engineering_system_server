const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ==================================================
// 1. جلب إحصائيات لوحة التسويات (الإصدار الدقيق 100%)
// GET /api/private-settlements/dashboard?type=شريك
// ==================================================
const getSettlementsDashboard = async (req, res) => {
  try {
    const targetTypeFilter = req.query.type || "شريك";

    // 1. حساب الرصيد البنكي والنقدي والغير مسلم للملخص العلوي
    const payments = await prisma.privatePayment.findMany();
    let bankBalance = 0;
    let cashBalance = 0;
    let undelivered = 0;

    payments.forEach((p) => {
      if (p.method === "بنكي") bankBalance += p.amount;
      if (p.method === "نقدي") cashBalance += p.amount;
      if (p.method === "غير مسلم للشركة") undelivered += p.amount;
    });

    const taxEstimate = (bankBalance + cashBalance) * 0.15;
    const availableBalance =
      bankBalance + cashBalance - taxEstimate - undelivered;

    // 2. 💡 الجلب الدقيق: نجلب الأشخاص بناءً على نوعهم مع جميع علاقاتهم بالمعاملات والتسويات
    const persons = await prisma.person.findMany({
      where: { role: targetTypeFilter },
      include: {
        // نجلب الـ ID فقط لعد المعاملات الحقيقية لتخفيف الضغط على السيرفر
        brokeredTransactions: { select: { id: true } },
        agentTransactions: { select: { id: true } },
        stakeholderTransactions: { select: { id: true } },

        // نجلب التسويات لحساب المبالغ المالية
        settlementsTarget: true,
      },
    });

    // 3. تنسيق البيانات وحساب الأرقام بدقة متناهية
    const formattedBrokers = persons.map((person) => {
      // أ) حساب عدد المعاملات الحقيقي بناءً على دور الشخص
      let realTxCount = 0;
      if (targetTypeFilter === "وسيط")
        realTxCount = person.brokeredTransactions.length;
      else if (targetTypeFilter === "معقب")
        realTxCount = person.agentTransactions.length;
      else if (targetTypeFilter === "صاحب مصلحة")
        realTxCount = person.stakeholderTransactions.length;
      else {
        // للشركاء أو الموظفين (نجمع كل ما شاركوا فيه)
        realTxCount =
          person.brokeredTransactions.length +
          person.agentTransactions.length +
          person.stakeholderTransactions.length;
      }

      // ب) حساب المبالغ المالية من جدول التسويات المرتبط به
      let totalFees = 0;
      let received = 0;

      person.settlementsTarget.forEach((s) => {
        // إذا كانت مستحقات (دين للوسيط/الشريك)
        if (
          s.status === "PENDING" ||
          (s.status === "PENDING" && s.isOpeningBalance)
        ) {
          totalFees += s.amount;
        }
        // إذا تم تسليمها
        if (s.status === "DELIVERED") {
          received += s.amount;
        }
      });

      const remaining = totalFees - received;

      return {
        id: person.id,
        name: person.name,
        txCount: realTxCount, // 👈 هنا يكمن السحر! الرقم الحقيقي للمعاملات
        totalFees: totalFees,
        received: received,
        remaining: remaining,
        statusText:
          remaining <= 0 && totalFees > 0
            ? "مُسوّى"
            : received > 0 && remaining > 0
              ? "جزئي"
              : remaining > 0
                ? "غير مدفوع"
                : "لا يوجد مستحقات",
      };
    });

    res.json({
      success: true,
      financials: {
        bankBalance,
        cashBalance,
        taxEstimate,
        undelivered,
        availableBalance,
      },
      brokers: formattedBrokers, // نرسلها للفرونت إند ليعرضها في الجدول
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 2. جلب معاملات شخص محدد (وسيط، معقب، شريك...)
// ==================================================
const getBrokerTransactions = async (req, res) => {
  try {
    const { brokerId } = req.params;

    // 💡 التحديث هنا: البحث في الأعمدة الأساسية + البحث في جدول الوسطاء المتعددين (brokersList)
    const transactions = await prisma.privateTransaction.findMany({
      where: {
        OR: [
          { brokerId: brokerId },
          { agentId: brokerId },
          { stakeholderId: brokerId },
          { receiverId: brokerId },
          { engOfficeBrokerId: brokerId },
          // 🚀 إضافة هذا السطر للبحث داخل الجدول الجديد (TransactionBroker)
          { brokersList: { some: { brokerId: brokerId } } },
        ],
      },
      include: {
        client: { select: { name: true } },
        districtNode: {
          select: { name: true, sector: { select: { name: true } } },
        },
        // 🚀 تضمين جدول الوسطاء لمعرفة أتعاب الوسيط المطلوب تحديداً
        brokersList: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedData = transactions.map((tx) => {
      let clientName = "غير محدد";
      if (tx.client?.name) {
        clientName =
          typeof tx.client.name === "string"
            ? JSON.parse(tx.client.name).ar
            : tx.client.name.ar;
      }

      // 💡 محاولة استخراج الأتعاب الخاصة بهذا الوسيط تحديداً في هذه المعاملة
      let specificBrokerFees = 0;
      const notes =
        typeof tx.notes === "object" && tx.notes !== null ? tx.notes : {};

      // إذا كان هو الوسيط الأساسي القديم
      if (tx.brokerId === brokerId)
        specificBrokerFees = notes.mediatorFees || 0;
      // أو نبحث عن أتعابه في الجدول المتعدد
      const foundInList = tx.brokersList?.find((b) => b.brokerId === brokerId);
      if (foundInList) specificBrokerFees = foundInList.fees;

      return {
        id: tx.id,
        ref: tx.transactionCode,
        client: clientName,
        district: tx.districtNode?.name || "غير محدد",
        sector: tx.districtNode?.sector?.name || "غير محدد",
        type: tx.category || "غير محدد",
        totalFees: tx.totalFees || 0,
        paidAmount: tx.paidAmount || 0,
        remainingAmount: tx.remainingAmount || 0,

        // 🚀 إضافة حقل الأتعاب المستحقة للوسيط في هذه المعاملة للواجهة
        personalFees: specificBrokerFees,

        status: tx.status,
        date: tx.createdAt.toISOString().split("T")[0],
      };
    });

    res.json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Get Broker Transactions Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 3. جلب سجل تسويات (مستحقات) شخص محدد
// ==================================================
const getBrokerSettlementsList = async (req, res) => {
  try {
    const { brokerId } = req.params;

    const settlements = await prisma.privateSettlement.findMany({
      where: {
        targetId: brokerId,
        status: "PENDING", // فقط المستحقات
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedData = settlements.map((s) => ({
      id: s.id,
      ref: `SET-${s.id.substring(s.id.length - 5).toUpperCase()}`,
      amount: s.amount,
      status: s.status,
      type: s.isOpeningBalance ? "رصيد افتتاحي" : "تسوية أتعاب",
      notes: s.notes || "—",
      date: s.createdAt.toISOString().split("T")[0],
    }));

    res.json({ success: true, data: formattedData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 4. جلب سجل مدفوعات (تسليمات) شخص محدد
// ==================================================
const getBrokerPaymentsList = async (req, res) => {
  try {
    const { brokerId } = req.params;

    const payments = await prisma.privateSettlement.findMany({
      where: {
        targetId: brokerId,
        status: "DELIVERED",
      },
      include: {
        deliveredBy: { select: { name: true } }, // 👈 جلب اسم الموظف المسلّم
      },
      orderBy: { deliveryDate: "desc" },
    });

    const formattedData = payments.map((p) => ({
      id: p.id,
      ref: `PAY-${p.id.substring(p.id.length - 5).toUpperCase()}`,
      amount: p.amount,
      method: p.deliveryMethod || "—",
      date: p.deliveryDate
        ? p.deliveryDate.toISOString().split("T")[0]
        : p.createdAt.toISOString().split("T")[0],
      deliveredBy: p.deliveredBy?.name || "النظام", // 👈 عرض اسم الموظف
    }));

    res.json({ success: true, data: formattedData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 5. تسجيل تسوية سابقة (رصيد افتتاحي)
// ==================================================
const addPreviousSettlement = async (req, res) => {
  try {
    const data = req.body;

    if (!data.targetId)
      return res
        .status(400)
        .json({ success: false, message: "يرجى تحديد الشريك" });

    const totalSettled = parseFloat(data.totalSettled) || 0;
    const totalDelivered = parseFloat(data.totalDelivered) || 0;
    const targetDate = data.periodDate ? new Date(data.periodDate) : new Date();

    if (totalSettled > 0) {
      await prisma.privateSettlement.create({
        data: {
          targetType: data.type,
          targetId: data.targetId,
          amount: totalSettled,
          isOpeningBalance: true,
          periodRef: data.periodDate,
          notes: data.notes
            ? `رصيد افتتاحي (مستحق): ${data.notes}`
            : "رصيد افتتاحي (إجمالي مستحق)",
          status: "PENDING",
        },
      });
    }

    if (totalDelivered > 0) {
      await prisma.privateSettlement.create({
        data: {
          targetType: data.type,
          targetId: data.targetId,
          amount: totalDelivered,
          isOpeningBalance: true,
          deliveryMethod: "رصيد افتتاحي",
          deliveryDate: targetDate,
          notes: "دفعة مسجلة ضمن الرصيد الافتتاحي",
          status: "DELIVERED",
        },
      });
    }

    res.json({
      success: true,
      message: "تم تسجيل الرصيد الافتتاحي والدفعات بنجاح",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 6. تسجيل تسوية (إضافة مستحق جديد)
// ==================================================
const recordSettlement = async (req, res) => {
  try {
    const data = req.body;

    if (!data.targetId)
      return res.status(400).json({
        success: false,
        message: "يجب تحديد اسم الشخص (الـ ID) المراد تسجيل التسوية له",
      });

    await prisma.privateSettlement.create({
      data: {
        targetType: data.type || "غير محدد",
        targetId: data.targetId, // 💡 حفظ الـ ID بشكل صحيح
        amount: parseFloat(data.amount),
        source: data.source,
        notes: data.notes,
        status: "PENDING",
      },
    });
    res.json({ success: true, message: "تم تسجيل التسوية بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 7. تسليم تسوية (صرف مبلغ للشخص)
// ==================================================
const deliverSettlement = async (req, res) => {
  try {
    const data = req.body;
    let attachmentPath = null;
    if (req.file) attachmentPath = `/uploads/settlements/${req.file.filename}`;

    await prisma.privateSettlement.create({
      data: {
        targetType: data.type,
        targetId: data.targetId,
        amount: parseFloat(data.amount),
        deliveryMethod: data.method,
        deliveryDate: data.date ? new Date(data.date) : new Date(),
        deliveredById: data.deliveredById || null, // 💡 ربط بالموظف الذي سلم
        notes: data.notes,
        attachmentPath,
        status: "DELIVERED",
      },
    });
    res.json({ success: true, message: "تم تسليم المبلغ بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 8. حذف جميع تسويات ومدفوعات شخص محدد (تصفير الحساب)
// ==================================================
const deleteBrokerSettlements = async (req, res) => {
  try {
    const { brokerId } = req.params;

    await prisma.privateSettlement.deleteMany({
      where: { targetId: brokerId },
    });

    res.json({
      success: true,
      message: "تم مسح جميع تسويات ومدفوعات الشخص بنجاح",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// جلب بيانات "حساب خاص" (حاوية تجمع عدة أشخاص)
// GET /api/private-settlements/special-account/:accountName
// ==================================================
const getSpecialAccountData = async (req, res) => {
  try {
    const { accountName } = req.params;

    // 1. جلب إعدادات النظام لمعرفة من هم الأشخاص داخل هذه الحاوية
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    const specialAccounts = typeof settings.specialAccounts === 'string' 
      ? JSON.parse(settings.specialAccounts) 
      : (settings.specialAccounts || []);

    const targetAccount = specialAccounts.find(
      a => a.reportName === accountName || a.systemName === accountName
    );

    // إذا لم يكن هناك أشخاص مربوطين، نرجع مصفوفات فارغة
    if (!targetAccount || !targetAccount.linkedPersons || targetAccount.linkedPersons.length === 0) {
      return res.json({ success: true, data: { transactions: [], settlements: [], payments: [] } });
    }

    const personIds = targetAccount.linkedPersons; // مصفوفة من الـ IDs

    // 2. جلب جميع المعاملات التي يتواجد فيها أي شخص من هذه الحاوية
    const transactions = await prisma.privateTransaction.findMany({
      where: {
        OR: [
          { brokerId: { in: personIds } },
          { agentId: { in: personIds } },
          { stakeholderId: { in: personIds } },
          { receiverId: { in: personIds } },
          { engOfficeBrokerId: { in: personIds } },
          { brokersList: { some: { brokerId: { in: personIds } } } }
        ]
      },
      include: {
        client: { select: { name: true } },
        districtNode: { select: { name: true, sector: { select: { name: true } } } },
        brokersList: true,
      },
      orderBy: { createdAt: "desc" }
    });

    const formattedTxs = transactions.map(tx => {
      let clientName = "غير محدد";
      if (tx.client?.name) {
        clientName = typeof tx.client.name === "string" ? JSON.parse(tx.client.name).ar : tx.client.name.ar;
      }
      return {
        id: tx.id,
        ref: tx.transactionCode,
        client: clientName,
        district: tx.districtNode?.name || "غير محدد",
        type: tx.category || "غير محدد",
        totalFees: tx.totalFees || 0,
        paidAmount: tx.paidAmount || 0,
        remainingAmount: tx.remainingAmount || 0,
        status: tx.status,
        date: tx.createdAt.toISOString().split("T")[0],
      };
    });

    // 3. جلب جميع التسويات (المستحقات) لهؤلاء الأشخاص
    const settlements = await prisma.privateSettlement.findMany({
      where: { targetId: { in: personIds }, status: "PENDING" },
      orderBy: { createdAt: "desc" }
    });

    // 4. جلب جميع المدفوعات (المسلمة) لهؤلاء الأشخاص
    const payments = await prisma.privateSettlement.findMany({
      where: { targetId: { in: personIds }, status: "DELIVERED" },
      include: { deliveredBy: { select: { name: true } } },
      orderBy: { deliveryDate: "desc" }
    });

    const formattedSettlements = settlements.map(s => ({
      id: s.id, ref: `SET-${s.id.slice(-5).toUpperCase()}`, amount: s.amount, type: s.isOpeningBalance ? "رصيد افتتاحي" : "تسوية", notes: s.notes || "—", date: s.createdAt.toISOString().split("T")[0]
    }));

    const formattedPayments = payments.map(p => ({
      id: p.id, ref: `PAY-${p.id.slice(-5).toUpperCase()}`, amount: p.amount, method: p.deliveryMethod || "نقدي", deliveredBy: p.deliveredBy?.name || "النظام", date: (p.deliveryDate || p.createdAt).toISOString().split("T")[0]
    }));

    // إرسال البيانات المجمعة للحاوية
    res.json({ success: true, data: { transactions: formattedTxs, settlements: formattedSettlements, payments: formattedPayments } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


module.exports = {
  getSettlementsDashboard,
  getBrokerTransactions,
  getBrokerSettlementsList,
  getBrokerPaymentsList,
  addPreviousSettlement,
  recordSettlement,
  deliverSettlement,
  deleteBrokerSettlements,
  getSpecialAccountData
};

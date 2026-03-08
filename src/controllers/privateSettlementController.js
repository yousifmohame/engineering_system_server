const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 1. جلب إحصائيات لوحة التسويات
const getSettlementsDashboard = async (req, res) => {
  try {
    // حساب الرصيد البنكي والنقدي والغير مسلم (من المدفوعات التي تم تحصيلها PrivatePayment)
    // ملاحظة: نفترض أن لديك جدول PrivatePayment كما فعلنا في الطلب السابق
    const payments = await prisma.privatePayment.findMany();

    let bankBalance = 0;
    let cashBalance = 0;
    let undelivered = 0;

    payments.forEach((p) => {
      if (p.method === "بنكي") bankBalance += p.amount;
      if (p.method === "نقدي") cashBalance += p.amount;
      if (p.method === "غير مسلم للشركة") undelivered += p.amount;
    });

    const taxEstimate = (bankBalance + cashBalance) * 0.15; // تقدير ضريبي 15% كمثال
    const availableBalance =
      bankBalance + cashBalance - taxEstimate - undelivered;

    // جلب قائمة الوسطاء (نجلب الموظفين الذين لديهم معاملات أو تسويات)
    // للتبسيط في هذا المثال، سنرسل قائمة مجمعة
    const settlements = await prisma.privateSettlement.findMany({
      orderBy: { createdAt: "desc" },
    });

    // تجميع بيانات الوسطاء (يمكن تحسين هذا بـ SQL Group By)
    const brokersMap = {};
    settlements.forEach((s) => {
      const key = s.targetId || s.targetName || "مجهول";
      if (!brokersMap[key]) {
        brokersMap[key] = {
          id: key,
          name: s.targetName || "تم السحب من النظام", // يفترض جلب الاسم من جدول Employees
          txCount: 0,
          totalFees: 0,
          received: 0,
          remaining: 0,
          lastPayment: null,
          statusText: "غير محدد",
        };
      }

      brokersMap[key].txCount += 1;
      brokersMap[key].totalFees += s.amount;
      if (s.status === "DELIVERED") {
        brokersMap[key].received += s.amount;
        brokersMap[key].lastPayment = s.deliveryDate || s.createdAt;
      }
    });

    Object.values(brokersMap).forEach((b) => {
      b.remaining = b.totalFees - b.received;
      b.statusText =
        b.remaining === 0 ? "مُسوّى" : b.received > 0 ? "جزئي" : "غير مدفوع";
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
      brokers: Object.values(brokersMap),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. تسجيل تسوية سابقة (رصيد افتتاحي)
const addPreviousSettlement = async (req, res) => {
  try {
    const data = req.body;
    await prisma.privateSettlement.create({
      data: {
        targetType: data.type,
        targetId: data.targetId,
        amount: parseFloat(data.remaining), // المبلغ المتبقي كدين
        isOpeningBalance: true,
        openingTotal: parseFloat(data.totalSettled),
        openingDelivered: parseFloat(data.totalDelivered),
        periodRef: data.periodDate,
        notes: data.notes,
        status: "PENDING",
      },
    });
    res.json({ success: true, message: "تم تسجيل التسوية السابقة" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. تسجيل تسوية (مستحقات وسيط)
const recordSettlement = async (req, res) => {
  try {
    const data = req.body;
    await prisma.privateSettlement.create({
      data: {
        targetType: data.type,
        targetName: data.name, // ممكن يكون نص حر
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

// 4. تسليم تسوية (دفع للوسيط)
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
        deliveryDate: new Date(data.date),
        deliveredById: data.deliveredById,
        notes: data.notes,
        attachmentPath,
        status: "DELIVERED",
      },
    });
    res.json({ success: true, message: "تم تسليم التسوية بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 5. جلب معاملات وسيط محدد
// GET /api/private-settlements/broker/:brokerId/transactions
// ==================================================
const getBrokerTransactions = async (req, res) => {
  try {
    const { brokerId } = req.params;

    // البحث في المعاملات حيث يكون الـ brokerId داخل حقل notes (JSON)
    const transactions = await prisma.privateTransaction.findMany({
      where: {
        notes: {
          path: ["roles", "brokerId"],
          equals: brokerId,
        },
      },
      include: {
        client: { select: { name: true } },
        districtNode: {
          select: { name: true, sector: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // تنسيق البيانات للفرونت إند
    const formattedData = transactions.map((tx) => {
      let clientName = "غير محدد";
      if (tx.client?.name) {
        clientName =
          typeof tx.client.name === "string"
            ? JSON.parse(tx.client.name).ar
            : tx.client.name.ar;
      }

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
// 6. جلب سجل تسويات وسيط محدد
// GET /api/private-settlements/broker/:brokerId/settlements
// ==================================================
const getBrokerSettlementsList = async (req, res) => {
  try {
    const { brokerId } = req.params;

    const settlements = await prisma.privateSettlement.findMany({
      where: { targetId: brokerId },
      orderBy: { createdAt: "desc" },
    });

    const formattedData = settlements.map((s) => ({
      id: s.id,
      ref: `SET-${s.id.substring(s.id.length - 5).toUpperCase()}`, // إنشاء مرجع وهمي مؤقت
      amount: s.amount,
      status: s.status,
      type: s.isOpeningBalance ? "رصيد افتتاحي" : "تسوية",
      notes: s.notes || "—",
      date: s.createdAt.toISOString().split("T")[0],
    }));

    res.json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Get Broker Settlements Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 7. جلب سجل مدفوعات وسيط محدد (ما تم تسليمه له)
// GET /api/private-settlements/broker/:brokerId/payments
// ==================================================
const getBrokerPaymentsList = async (req, res) => {
  try {
    const { brokerId } = req.params;

    // نجلب فقط التسويات التي حالتها DELIVERED
    const payments = await prisma.privateSettlement.findMany({
      where: {
        targetId: brokerId,
        status: "DELIVERED",
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
      deliveredBy: "تم بواسطة النظام", // يجب ربطه بـ deliveredById في الحقيقة
    }));

    res.json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Get Broker Payments Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getSettlementsDashboard,
  addPreviousSettlement,
  recordSettlement,
  deliverSettlement,
  getBrokerTransactions,
  getBrokerSettlementsList,
  getBrokerPaymentsList,
};

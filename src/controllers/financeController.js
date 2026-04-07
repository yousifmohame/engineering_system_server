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
        status: data.status || "PENDING", // 👈 2. أخذ الحالة من الواجهة (DELIVERED)
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
      const remoteCost =
        tx.tasks?.reduce((sum, t) => sum + (t.cost || 0), 0) || 0;

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
        mediator: tx.brokersList?.map((b) => b.broker?.name).join(" و ") || "—",
        agent: tx.agent?.name || "—",
        totalPrice: tx.totalFees || 0,
        collected: tx.paidAmount || 0,
        remaining: tx.remainingAmount || 0,
        totalCosts: cost,
        netProfit: profit,
        status:
          tx.paidAmount >= tx.totalFees && tx.totalFees > 0
            ? "settled"
            : tx.paidAmount > 0
              ? "partial"
              : "pending",
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
            const hisTxs = transactions.filter((t) => t.agentId === p.id);
            txCount = hisTxs.length;
            totalFees = hisTxs.reduce(
              (sum, t) =>
                sum + parseFloat(t.notes?.agentFees || t.agentCost || 0),
              0,
            );
          } else if (roleType === "وسيط") {
            const hisTxs = transactions.filter((t) =>
              t.brokersList?.some((b) => b.brokerId === p.id),
            );
            txCount = hisTxs.length;
            hisTxs.forEach((t) => {
              const brokerRecord = t.brokersList.find(
                (b) => b.brokerId === p.id,
              );
              if (brokerRecord) totalFees += brokerRecord.fees;
            });
          } else if (roleType === "موظف عن بعد") {
            const hisTasks = transactions
              .flatMap((t) => t.tasks)
              .filter((t) => t.workerId === p.id);
            txCount = hisTasks.length; // Number of tasks
            totalFees = hisTasks.reduce((sum, t) => sum + (t.cost || 0), 0);
          }

          const paid = p.settlementsTarget.reduce(
            (sum, s) => sum + s.amount,
            0,
          );
          const remaining = Math.max(0, totalFees - paid);

          let deliveryStatus = "not_delivered";
          if (paid >= totalFees && totalFees > 0)
            deliveryStatus = "fully_delivered";
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
      },
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
      message: `تم اعتماد وإغلاق شهر ${month}/${year} بنجاح.`,
    });
  } catch (error) {
    console.error("Execute Settlement Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 💡 نظام رواتب المتعاونين الخارجيين (Outsource Salaries)
// ============================================================================

// 1. جلب سجلات الرواتب
const getOutsourceSalaries = async (req, res) => {
  try {
    const { month } = req.query; // مثال: "2026-03"

    const whereClause = {};
    if (month && month !== "all") {
      whereClause.period = month;
    }

    // نفترض أنك أنشأت جدول OutsourceSalary في Prisma
    const salaries = await prisma.outsourceSalary.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: salaries });
  } catch (error) {
    console.error("Get Salaries Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. تسجيل راتب / مستحق جديد كمديونية
const createOutsourceSalary = async (req, res) => {
  try {
    const data = req.body;

    const newSalary = await prisma.outsourceSalary.create({
      data: {
        employeeId: data.employeeId,
        employeeName: data.employeeName,
        period: data.period,
        startDate: data.startDate,
        endDate: data.endDate,
        daysCount: data.daysCount,
        dailyRate: data.dailyRate,
        grossAmount: data.grossAmount,
        deductions: data.deductions,
        netAmount: data.netAmount,
        roundedAmount: data.roundedAmount,
        status: "unpaid",
        paidAmount: 0,
        remainingAmount: data.roundedAmount,
        paymentType: data.paymentType,
      },
    });

    res
      .status(201)
      .json({ success: true, data: newSalary, message: "تم تسجيل الراتب" });
  } catch (error) {
    console.error("Create Salary Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. جلب سجل الدفعات
const getOutsourcePayments = async (req, res) => {
  try {
    // نفترض أنك أنشأت جدول OutsourcePayment في Prisma
    const payments = await prisma.outsourcePayment.findMany({
      orderBy: { paymentDate: "desc" },
    });

    res.json({ success: true, data: payments });
  } catch (error) {
    console.error("Get Payments Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. تسديد دفعة من الراتب (جزئي أو كلي)
// 4. تسديد دفعة من الراتب (جزئي أو كلي) مع دعم المرفقات
const createOutsourcePayment = async (req, res) => {
  try {
    // حماية في حال عدم وصول بيانات
    if (!req.body) throw new Error("لم يتم استلام أي بيانات.");

    const {
      salaryRecordId,
      amount,
      paymentMethod,
      paymentDate,
      paymentTime,
      currency,
      notes,
      isPartial,
    } = req.body;

    if (!salaryRecordId) throw new Error("معرف الراتب مفقود");

    // 💡 تحويل القيم القادمة من FormData (لأنها تأتي كنصوص String)
    const parsedAmount = parseFloat(amount);
    const parsedIsPartial = isPartial === "true" || isPartial === true;

    // 💡 معالجة الملف المرفق (صورة الحوالة) إن وجد
    let attachmentPath = null;
    if (req.file) {
      attachmentPath = `/../../uploads/payments/${req.file.filename}`; // تأكد أن مجلد الرفع مناسب لك
    }

    // استخدام Transaction لضمان تحديث الراتب وإنشاء الدفعة معاً
    const result = await prisma.$transaction(async (prismaDelegate) => {
      // 1. جلب سجل الراتب
      const salary = await prismaDelegate.outsourceSalary.findUnique({
        where: { id: salaryRecordId },
      });

      if (!salary) throw new Error("سجل الراتب غير موجود");
      if (parsedAmount > salary.remainingAmount)
        throw new Error("المبلغ أكبر من المتبقي");

      // 2. تحديث المبالغ والحالة في الراتب
      const newPaidAmount = salary.paidAmount + parsedAmount;
      const newRemainingAmount = salary.roundedAmount - newPaidAmount;
      let newStatus = "partial";
      if (newRemainingAmount <= 0) newStatus = "paid";

      await prismaDelegate.outsourceSalary.update({
        where: { id: salaryRecordId },
        data: {
          paidAmount: newPaidAmount,
          remainingAmount: newRemainingAmount,
          status: newStatus,
        },
      });

      // 3. إنشاء سجل الدفعة
      const newPayment = await prismaDelegate.outsourcePayment.create({
        data: {
          salaryRecordId,
          amount: parsedAmount,
          paymentMethod,
          paymentDate,
          paymentTime,
          currency,
          notes,
          isPartial: parsedIsPartial,
          receiptUrl: attachmentPath, // 💡 حفظ مسار المرفق في الداتابيز
        },
      });

      return newPayment;
    });

    res
      .status(201)
      .json({ success: true, data: result, message: "تم تسجيل الدفعة بنجاح" });
  } catch (error) {
    console.error("Create Payment Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 💡 نظام كشف الحساب والمقاصة (Person Statement & Netting)
// ============================================================================

const getPersonStatement = async (req, res) => {
  try {
    const { personId } = req.params;

    // 1. جلب الشخص مع كافة علاقاته المالية والتشغيلية
    const person = await prisma.person.findUnique({
      where: { id: personId },
      include: {
        disbursements: true, // السلف والمنصرفات
        settlementsTarget: true, // الدفعات والتسويات التي استلمها
        paymentsCollected: {
          include: { transaction: { select: { transactionCode: true } } },
        }, // المبالغ التي حصلها ولم يوردها
        // المعاملات التي عمل بها للحصول على أتعابه
        agentTransactions: true,
        assignedTasks: {
          include: { transaction: { select: { transactionCode: true } } },
        },
        assignedBrokers: {
          include: { transaction: { select: { transactionCode: true } } },
        },
      },
    });

    if (!person) {
      return res
        .status(404)
        .json({ success: false, message: "الشخص غير موجود" });
    }

    let statement = [];

    // ==========================================
    // 💰 أولاً: المستحقات (له - Credit)
    // ==========================================

    // أ. أتعاب التعقيب
    if (person.agentTransactions) {
      person.agentTransactions.forEach((tx) => {
        const notes = typeof tx.notes === "object" ? tx.notes : {};
        const fee = parseFloat(notes?.agentFees || tx.agentCost || 0);
        if (fee > 0) {
          statement.push({
            id: `FEE-AGT-${tx.id}`,
            date: tx.createdAt.toISOString().split("T")[0],
            type: "fee",
            description: `أتعاب تعقيب - معاملة ${tx.transactionCode}`,
            amount: fee,
            category: "credit",
            source: "المعاملات",
            settled: false,
            txStatus: tx.status,
          });
        }
      });
    }

    // ب. أتعاب الوساطة
    if (person.assignedBrokers) {
      person.assignedBrokers.forEach((b) => {
        if (b.fees > 0) {
          statement.push({
            id: `FEE-BRK-${b.id}`,
            date: b.createdAt.toISOString().split("T")[0],
            type: "fee",
            description: `أتعاب وساطة - معاملة ${b.transaction?.transactionCode || "بدون مرجع"}`,
            amount: parseFloat(b.fees),
            category: "credit",
            source: "المعاملات",
            settled: false,
          });
        }
      });
    }

    // ج. أتعاب مهام العمل عن بعد
    if (person.assignedTasks) {
      person.assignedTasks.forEach((t) => {
        if (t.cost > 0) {
          statement.push({
            id: `FEE-RMT-${t.id}`,
            date: t.createdAt.toISOString().split("T")[0],
            type: "fee",
            description: `أتعاب مهمة: ${t.name} - معاملة ${t.transaction?.transactionCode || ""}`,
            amount: parseFloat(t.cost),
            category: "credit",
            source: "العمل عن بعد",
            settled: t.isPaid || false,
          });
        }
      });
    }

    // ==========================================
    // 🔻 ثانياً: المديونيات (عليه - Debit)
    // ==========================================

    // أ. التحصيلات التي استلمها ولم يوردها للخزنة
    if (person.paymentsCollected) {
      person.paymentsCollected.forEach((p) => {
        statement.push({
          id: `COL-${p.id}`,
          date: p.date.toISOString().split("T")[0],
          type: "uncollected",
          description: `مبلغ تم تحصيله لمعاملة ${p.transaction?.transactionCode || ""}`,
          amount: parseFloat(p.amount),
          category: "debit",
          source: "تحصيلات العملاء",
          settled: false,
        });
      });
    }

    // ب. السلف والمصروفات التي تم صرفها له
    if (person.disbursements) {
      person.disbursements.forEach((d) => {
        statement.push({
          id: `DIS-${d.id}`,
          date: d.date.toISOString().split("T")[0],
          type: "advance",
          description: `صرف سلفة/عهدة: ${d.notes || d.type}`,
          amount: parseFloat(d.amount),
          category: "debit",
          source: "الخزنة / البنك",
          settled: false,
        });
      });
    }

    // ج. الدفعات النقدية المسددة له (تسويات سابقة)
    if (person.settlementsTarget) {
      person.settlementsTarget.forEach((s) => {
        if (s.status === "DELIVERED") {
          statement.push({
            id: `STL-${s.id}`,
            date: s.deliveryDate
              ? s.deliveryDate.toISOString().split("T")[0]
              : s.createdAt.toISOString().split("T")[0],
            type: "delivered",
            description: `دفعة مالية مسلمة له: ${s.notes || ""}`,
            amount: parseFloat(s.amount),
            category: "debit", // تعتبر عليه لأنه قبضها واستلمها فتنقص من حسابه
            source: s.source || "الإدارة المالية",
            settled: true, // التسليم هو بحد ذاته مسوى
          });
        }
      });
    }

    // ترتيب السجل حسب التاريخ من الأحدث للأقدم
    statement.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      data: {
        statement,
        nettingHistory: [], // يمكننا لاحقاً جلب المقاصات السابقة من جدول مخصص
      },
    });
  } catch (error) {
    console.error("Get Person Statement Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const executeNetting = async (req, res) => {
  try {
    const { personId, itemIds, totalCredit, totalDebit, netAmount } = req.body;

    // إنشاء سجل تسوية من نوع "مقاصة" لضبط الحسابات
    const nettingRecord = await prisma.privateSettlement.create({
      data: {
        targetType: "مقاصة_شخصية",
        targetId: personId,
        amount: Math.abs(netAmount),
        status: "DELIVERED",
        source: "نظام المقاصة الآلي",
        notes: `تمت مقاصة ${itemIds.length} بنود. إجمالي له: ${totalCredit} ر.س | إجمالي عليه: ${totalDebit} ر.س | الصافي: ${netAmount} ر.س`,
        deliveryDate: new Date(),
      },
    });

    // 💡 في الأنظمة المتقدمة يتم الذهاب لكل جدول بناءً على ID وتغيير حالته إلى settled: true
    // (مثلاً استخراج IDs التي تبدأ بـ FEE- وتحديث المعاملات)

    res.json({
      success: true,
      message: "تمت المقاصة بنجاح وتصفية الحسابات",
      data: nettingRecord,
    });
  } catch (error) {
    console.error("Netting Error:", error.message);
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
  getOutsourceSalaries,
  getOutsourcePayments,
  createOutsourcePayment,
  createOutsourceSalary,
  getPersonStatement,
  executeNetting,
};

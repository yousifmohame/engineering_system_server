const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ==================================================
// 💡 دالة مراقب الأحداث (Event Logger) للعمل عن بعد
// ==================================================
const logTransactionEvent = async (
  prismaClient,
  transactionId,
  type,
  action,
  details,
  user,
) => {
  try {
    if (!transactionId) return;
    const tx = await prismaClient.privateTransaction.findUnique({
      where: { id: transactionId },
    });
    if (!tx) return;

    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};
    let logs = currentNotes.logs || [];

    // إضافة الحدث الجديد (يتم وضعه في بداية المصفوفة ليكون الأحدث أولاً)
    logs.unshift({
      type,
      action,
      details,
      date: new Date().toISOString(),
      user: user || "موظف النظام",
    });

    currentNotes.logs = logs;

    await prismaClient.privateTransaction.update({
      where: { id: transactionId },
      data: { notes: currentNotes },
    });
  } catch (error) {
    console.error("Logging Error:", error.message);
  }
};

// 1. جلب جميع الموظفين عن بعد مع إحصائياتهم
const getRemoteWorkers = async (req, res) => {
  try {
    const workers = await prisma.person.findMany({
      where: { role: "موظف عن بعد" },
      include: {
        assignedTasks: { include: { transaction: true } },
        settlementsTarget: true,
      },
    });

    const formatted = workers.map((worker) => {
      const prev = worker.settlementsTarget
        .filter(
          (s) => s.source === "رصيد افتتاحي" || s.notes?.includes("دفعة سابقة"),
        )
        .reduce((sum, s) => sum + s.amount, 0);

      const txFees = worker.assignedTasks.reduce((sum, t) => sum + t.cost, 0);

      const settled = worker.settlementsTarget
        .filter(
          (s) =>
            s.status !== "DELIVERED" &&
            s.source !== "رصيد افتتاحي" &&
            !s.notes?.includes("دفعة سابقة"),
        )
        .reduce((sum, s) => sum + s.amount, 0);

      const transferred = worker.settlementsTarget
        .filter((s) => s.status === "DELIVERED")
        .reduce((sum, s) => sum + s.amount, 0);

      const total = settled + prev;
      const remaining = total - transferred;

      const transfersRecords = worker.settlementsTarget
        .filter((s) => s.status === "DELIVERED")
        .map((t) => ({ ...t, date: t.createdAt, method: t.source || "تحويل" }));

      const settlementsRecords = worker.settlementsTarget.filter(
        (s) => s.status !== "DELIVERED",
      );

      return {
        id: worker.id,
        name: worker.name,
        phone: worker.phone || "—",
        email: worker.email || "—",
        joinDate: worker.createdAt.toISOString().split("T")[0],
        currency: worker.preferredCurrency || "SAR",
        status: worker.isActive ? "نشط" : "متوقف",
        stats: { prev, txFees, total, settled, remaining, transferred },
        tasks: worker.assignedTasks,
        settlements: settlementsRecords,
        transfers: transfersRecords,
      };
    });

    res.json({ success: true, data: formatted });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. إضافة موظف جديد
const addRemoteWorker = async (req, res) => {
  try {
    const { name, phone, email, currency } = req.body;
    const personCode = `R-EMP-${Date.now().toString().slice(-4)}`;
    const worker = await prisma.person.create({
      data: {
        personCode,
        name,
        role: "موظف عن بعد",
        phone,
        email,
        preferredCurrency: currency,
      },
    });
    res.json({ success: true, data: worker });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. تعديل بيانات موظف عن بعد
const editRemoteWorker = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, currency } = req.body;
    const updated = await prisma.person.update({
      where: { id },
      data: { name, phone, email, preferredCurrency: currency },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. حذف موظف عن بعد
const deleteRemoteWorker = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.person.delete({ where: { id } });
    res.json({ success: true, message: "تم الحذف بنجاح" });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "لا يمكن حذف موظف مرتبط بمهام أو حسابات.",
      });
  }
};

// 5. تعيين مهام (مع دعم تسجيل الدفعة الفورية إذا تم تحديدها)
const assignTasks = async (req, res) => {
  try {
    const {
      workerId,
      transactionId,
      tasks,
      isFinal,
      isPaid,
      paymentAmount,
      paymentCurrency,
      paymentDate,
      assignedBy,
    } = req.body;

    if (!workerId || !transactionId || !tasks || tasks.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "بيانات المهمة غير مكتملة." });
    }

    const worker = await prisma.person.findUnique({ where: { id: workerId } });

    await prisma.$transaction(async (prismaDelegate) => {
      const payAmount = parseFloat(paymentAmount) || 0;

      await Promise.all(
        tasks.map((t) => {
          const taskCost = parseFloat(t.cost) || 0;
          const isTaskFullyPaid = isPaid && payAmount >= taskCost;

          return prismaDelegate.transactionTask.create({
            data: {
              workerId,
              transactionId,
              taskName: t.name,
              cost: taskCost,
              isFinal: isFinal || false,
              assignedBy: assignedBy || "موظف النظام",
              isPaid: isTaskFullyPaid,
              paidAmount: isPaid ? payAmount : 0,
              paymentCurrency: isPaid ? paymentCurrency : null,
              paymentDate: isPaid && paymentDate ? new Date(paymentDate) : null,
            },
          });
        }),
      );

      if (isPaid && payAmount > 0) {
        await prismaDelegate.privateSettlement.create({
          data: {
            targetType: "موظف عن بعد",
            targetId: workerId,
            transactionId: transactionId,
            amount: payAmount,
            status: "DELIVERED",
            source: "دفعة فورية مع التعيين",
            notes: `تم الإسناد والدفع بواسطة: ${assignedBy || "موظف النظام"} | عملة الدفع: ${paymentCurrency} | تاريخ الدفع: ${paymentDate || new Date().toISOString().split("T")[0]}`,
          },
        });
      }

      // 💡 توثيق إسناد المهمة في سجل أحداث المعاملة
      const taskNames = tasks.map((t) => t.name).join("، ");
      await logTransactionEvent(
        prismaDelegate,
        transactionId,
        "العمل عن بعد",
        "تعيين مهمة",
        `تم تعيين مهمة (${taskNames}) للموظف (${worker?.name || "غير محدد"})`,
        assignedBy,
      );

      if (isPaid && payAmount > 0) {
        await logTransactionEvent(
          prismaDelegate,
          transactionId,
          "ماليات",
          "سداد مهمة",
          `تم سداد مبلغ ${payAmount} ر.س كدفعة فورية للموظف (${worker?.name || "غير محدد"})`,
          assignedBy,
        );
      }
    });

    res.json({
      success: true,
      message: "تم تعيين المهام بنجاح" + (isPaid ? " وتم تسجيل الدفعة" : ""),
    });
  } catch (error) {
    console.error("Assign Tasks Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 6. تسجيل تحويل مالي
const addTransfer = async (req, res) => {
  try {
    const { workerId, amount, date, method, currency, targetName, notes } =
      req.body;

    await prisma.privateSettlement.create({
      data: {
        targetType: "موظف عن بعد",
        targetId: workerId,
        amount: parseFloat(amount),
        status: "DELIVERED",
        source: method,
        notes: `تاريخ: ${date} | عملة: ${currency} | مستلم: ${targetName || "الموظف نفسه"} | ${notes || ""}`,
      },
    });

    res.json({ success: true, message: "تم تسجيل التحويل بنجاح وخصم الرصيد" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 7. أسعار الصرف
const getExchangeRates = async (req, res) => {
  try {
    let rates = await prisma.exchangeRate.findMany();
    if (rates.length === 0) {
      await prisma.exchangeRate.createMany({
        data: [
          { currency: "USD", rate: 0.266, transferFee: 15 },
          { currency: "EGP", rate: 13.15, transferFee: 25 },
        ],
      });
      rates = await prisma.exchangeRate.findMany();
    }
    res.json({ success: true, data: rates });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateExchangeRate = async (req, res) => {
  try {
    const { id, rate, transferFee } = req.body;
    await prisma.exchangeRate.update({
      where: { id },
      data: { rate: parseFloat(rate), transferFee: parseFloat(transferFee) },
    });
    res.json({ success: true, message: "تم التحديث" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 8. حذف مهمة عمل عن بعد
const deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await prisma.transactionTask.findUnique({
      where: { id: taskId },
      include: { worker: true },
    });

    await prisma.transactionTask.delete({ where: { id: taskId } });

    // 💡 توثيق الحذف في سجل المعاملة
    if (task && task.transactionId) {
      await logTransactionEvent(
        prisma,
        task.transactionId,
        "العمل عن بعد",
        "حذف مهمة",
        `تم حذف مهمة (${task.taskName}) للموظف (${task.worker?.name})`,
        "مدير النظام",
      );
    }

    res.json({ success: true, message: "تم حذف المهمة بنجاح" });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "تعذر حذف المهمة، قد تكون مرتبطة بسجلات مالية.",
      });
  }
};

// 9. سداد أتعاب مهمة محددة من داخل المعاملة
const payTask = async (req, res) => {
  try {
    const {
      taskId,
      workerId,
      transactionId,
      amountSar,
      paymentDate,
      isFullPayment,
    } = req.body;

    if (!taskId || !workerId || !amountSar) {
      return res
        .status(400)
        .json({ success: false, message: "البيانات غير مكتملة" });
    }

    const paymentAmount = parseFloat(amountSar);
    const worker = await prisma.person.findUnique({ where: { id: workerId } });

    await prisma.$transaction(async (prismaDelegate) => {
      await prismaDelegate.privateSettlement.create({
        data: {
          targetType: "موظف عن بعد",
          targetId: workerId,
          transactionId: transactionId,
          amount: paymentAmount,
          status: "DELIVERED",
          source: "سداد مهمة مباشرة",
          notes: `تاريخ الدفع: ${paymentDate} | ${isFullPayment ? "سداد متبقي كامل" : "سداد جزئي"}`,
        },
      });

      const task = await prismaDelegate.transactionTask.findUnique({
        where: { id: taskId },
      });
      const newPaidAmount = (task.paidAmount || 0) + paymentAmount;
      const isNowFullyPaid = newPaidAmount >= task.cost;

      await prismaDelegate.transactionTask.update({
        where: { id: taskId },
        data: {
          paidAmount: newPaidAmount,
          isPaid: isNowFullyPaid,
          isFinal: isNowFullyPaid,
        },
      });

      // 💡 توثيق السداد في سجل المعاملة
      await logTransactionEvent(
        prismaDelegate,
        transactionId,
        "ماليات",
        "سداد مهمة",
        `تم سداد مبلغ ${paymentAmount} ر.س للموظف (${worker?.name || "غير محدد"}) عن مهمة (${task.taskName})`,
        "مدير النظام",
      );
    });

    res.json({ success: true, message: "تم تسجيل الدفعة للمهمة بنجاح" });
  } catch (error) {
    console.error("Pay Task Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getRemoteWorkers,
  addRemoteWorker,
  editRemoteWorker,
  deleteRemoteWorker,
  assignTasks,
  addTransfer,
  getExchangeRates,
  updateExchangeRate,
  deleteTask,
  payTask,
};

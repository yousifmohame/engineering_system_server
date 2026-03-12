const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 1. جلب جميع الموظفين عن بعد مع إحصائياتهم
const getRemoteWorkers = async (req, res) => {
  try {
    const workers = await prisma.person.findMany({
      where: { role: "موظف عن بعد" },
      include: {
        assignedTasks: { include: { transaction: true } },
        settlementsTarget: true, // 👈 سنعتمد بالكامل على هذا الجدول للتسويات والتحويلات
      },
    });

    const formatted = workers.map((worker) => {
      // 1. الدفعات السابقة (رصيد افتتاحي)
      const prev = worker.settlementsTarget
        .filter(
          (s) => s.source === "رصيد افتتاحي" || s.notes?.includes("دفعة سابقة"),
        )
        .reduce((sum, s) => sum + s.amount, 0);

      // 2. أتعاب المهام المعينة له
      const txFees = worker.assignedTasks.reduce((sum, t) => sum + t.cost, 0);

      // 3. التسويات المعتمدة (المبالغ التي تم اعتمادها لتدخل في رصيده)
      const settled = worker.settlementsTarget
        .filter(
          (s) =>
            s.status !== "DELIVERED" &&
            s.source !== "رصيد افتتاحي" &&
            !s.notes?.includes("دفعة سابقة"),
        )
        .reduce((sum, s) => sum + s.amount, 0);

      // 4. التحويلات الفعلية (المبالغ التي تم تحويلها وصرفها له)
      const transferred = worker.settlementsTarget
        .filter((s) => s.status === "DELIVERED")
        .reduce((sum, s) => sum + s.amount, 0);

      // 5. الحسابات النهائية
      const total = settled + prev; // الإجمالي المعتمد له
      const remaining = total - transferred; // المتبقي الذي لم يسدد

      // 6. فصل السجلات للواجهة
      const transfersRecords = worker.settlementsTarget
        .filter((s) => s.status === "DELIVERED")
        .map((t) => ({ ...t, date: t.createdAt, method: t.source || "تحويل" })); // تنسيق ليتوافق مع الواجهة

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

// 5. تعيين مهام
// 5. تعيين مهام (مع دعم تسجيل الدفعة الفورية إذا تم تحديدها)
const assignTasks = async (req, res) => {
  try {
    const { 
      workerId, 
      transactionId, 
      tasks, 
      isFinal,
      // الحقول الجديدة الخاصة بالدفع الفوري من الواجهة
      isPaid,
      paymentAmount,
      paymentCurrency,
      paymentDate 
    } = req.body;

    if (!workerId || !transactionId || !tasks || tasks.length === 0) {
      return res.status(400).json({ success: false, message: "بيانات المهمة غير مكتملة." });
    }

    // استخدام Transaction لضمان إنشاء المهام والدفعة معاً دون أخطاء
    await prisma.$transaction(async (prismaDelegate) => {
      
      // 1. إنشاء المهام
      await Promise.all(
        tasks.map((t) =>
          prismaDelegate.transactionTask.create({
            data: {
              workerId,
              transactionId,
              taskName: t.name,
              cost: parseFloat(t.cost) || 0,
              isFinal: isFinal || false,
            },
          })
        )
      );

      // 2. تسجيل دفعة فورية إذا حدد المستخدم ذلك
      if (isPaid && paymentAmount) {
        // نحتاج لتسجيلها كأنها "أتعاب معتمدة" ثم "تم تحويلها" حتى لا يختل رصيده
        // أو ببساطة تسجيل الدفعة مباشرة في PrivateSettlement كحالة DELIVERED
        
        await prismaDelegate.privateSettlement.create({
          data: {
            targetType: "موظف عن بعد",
            targetId: workerId,
            transactionId: transactionId,
            amount: parseFloat(paymentAmount),
            status: "DELIVERED", 
            source: "دفعة فورية مع التعيين",
            notes: `عملة الدفع: ${paymentCurrency} | تاريخ الدفع: ${paymentDate || new Date().toISOString().split('T')[0]}`,
          }
        });
      }
      
    });

    res.json({ success: true, message: "تم تعيين المهام بنجاح" + (isPaid ? " وتم تسجيل الدفعة" : "") });
  } catch (error) {
    console.error("Assign Tasks Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 6. تسجيل تحويل مالي (التعديل الجذري هنا لمنع الخطأ 500)
const addTransfer = async (req, res) => {
  try {
    const { workerId, amount, date, method, currency, targetName, notes } =
      req.body;

    // تسجيل التحويل في جدول التسويات كـ (مصروف / DELIVERED)
    const transfer = await prisma.privateSettlement.create({
      data: {
        targetType: "موظف عن بعد",
        targetId: workerId,
        amount: parseFloat(amount),
        status: "DELIVERED", // 👈 تعني أن المبلغ تم تحويله فعلياً للموظف ويجب خصمه
        source: method, // نضع طريقة التحويل هنا
        notes: `تاريخ: ${date} | عملة: ${currency} | مستلم: ${targetName || "الموظف نفسه"} | ${notes || ""}`,
        // ملاحظة: إذا كان الـ Schema يحتوي على attachment، يمكنك تمريره، لكن PrivateSettlement غالباً لا تتطلب مرفق إجباري.
      },
    });

    res.json({ success: true, message: "تم تسجيل التحويل بنجاح وخصم الرصيد" });
  } catch (error) {
    console.error("Transfer Error:", error.message);
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

// ==================================================
// 8. حذف مهمة عمل عن بعد
// DELETE /api/remote-workers/tasks/:taskId
// ==================================================
const deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    await prisma.transactionTask.delete({
      where: { id: taskId }
    });
    res.json({ success: true, message: "تم حذف المهمة بنجاح" });
  } catch (error) {
    console.error("Delete Task Error:", error.message);
    res.status(500).json({ success: false, message: "تعذر حذف المهمة، قد تكون مرتبطة بسجلات مالية." });
  }
};

// ==================================================
// 9. سداد أتعاب مهمة محددة من داخل المعاملة
// POST /api/remote-workers/tasks/pay
// ==================================================
const payTask = async (req, res) => {
  try {
    const { taskId, workerId, transactionId, amountSar, paymentDate, isFullPayment } = req.body;

    if (!taskId || !workerId || !amountSar) {
      return res.status(400).json({ success: false, message: "البيانات غير مكتملة" });
    }

    const paymentAmount = parseFloat(amountSar);

    await prisma.$transaction(async (prismaDelegate) => {
      // 1. تسجيل الدفعة في جدول التسويات 
      await prismaDelegate.privateSettlement.create({
        data: {
          targetType: "موظف عن بعد",
          targetId: workerId,
          transactionId: transactionId,
          amount: paymentAmount,
          status: "DELIVERED",
          source: "سداد مهمة مباشرة",
          notes: `تاريخ الدفع: ${paymentDate} | ${isFullPayment ? 'سداد متبقي كامل' : 'سداد جزئي'}`,
        }
      });

      // 2. 💡 تحديث المهمة بالرصيد الجديد
      const task = await prismaDelegate.transactionTask.findUnique({ where: { id: taskId } });
      const newPaidAmount = (task.paidAmount || 0) + paymentAmount;
      const isNowFullyPaid = newPaidAmount >= task.cost;

      await prismaDelegate.transactionTask.update({
        where: { id: taskId },
        data: { 
          paidAmount: newPaidAmount,
          isPaid: isNowFullyPaid, // تتحول لـ true تلقائياً إذا سدد كل المبلغ
          isFinal: isNowFullyPaid
        }
      });
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
  deleteTask, // 👈 تمت إضافته
  payTask,    // 👈 تمت إضافته
};

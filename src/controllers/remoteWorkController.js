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
const assignTasks = async (req, res) => {
  try {
    const { workerId, transactionId, tasks, isFinal } = req.body;
    await prisma.$transaction(
      tasks.map((t) =>
        prisma.transactionTask.create({
          data: {
            workerId,
            transactionId,
            taskName: t.name,
            cost: parseFloat(t.cost),
            isFinal,
          },
        }),
      ),
    );
    res.json({ success: true, message: "تم تعيين المهام بنجاح" });
  } catch (error) {
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

module.exports = {
  getRemoteWorkers,
  addRemoteWorker,
  editRemoteWorker,
  deleteRemoteWorker,
  assignTasks,
  addTransfer,
  getExchangeRates,
  updateExchangeRate,
};

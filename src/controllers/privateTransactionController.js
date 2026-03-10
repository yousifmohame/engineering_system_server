const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ==================================================
// دالة توليد رقم المعاملة (سنة-شهر-خمس أرقام)
// مثال: 2026-03-00001
// ==================================================
const generatePrivateTxCode = async () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // إضافة 0 إذا كان الشهر أقل من 10
  const prefix = `${year}-${month}-`;

  // جلب آخر معاملة في هذا الشهر تحديداً
  const lastTx = await prisma.privateTransaction.findFirst({
    where: { transactionCode: { startsWith: prefix } },
    orderBy: { transactionCode: "desc" },
  });

  let nextNumber = 1;
  if (lastTx) {
    try {
      // فصل النص بناءً على (-) وأخذ الجزء الثالث الذي يمثل الرقم
      const parts = lastTx.transactionCode.split("-");
      const lastNumberStr = parts[2]; // مثال: 00001
      nextNumber = parseInt(lastNumberStr, 10) + 1;
    } catch (e) {
      nextNumber = 1;
    }
  }

  // دمج البادئة مع الرقم المكون من 5 خانات
  return `${prefix}${String(nextNumber).padStart(5, "0")}`;
};

// ==================================================
// 1. إنشاء معاملة خاصة جديدة
// POST /api/private-transactions
// ==================================================
const createPrivateTransaction = async (req, res) => {
  try {
    const {
      transactionType,
      surveyType,
      clientId,
      plotNumber,
      planId,
      districtId,
      sectorName,
      entities,
      source,
      attachments,
      totalFees,
      firstPayment,
      // 💡 معرفات الأشخاص القادمة من الفرونت إند
      brokerId,
      followUpAgentId,
      stakeholderId,
      receiverId,
      engOfficeBrokerId,
    } = req.body;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "يرجى اختيار المالك (العميل) لربط المعاملة.",
      });
    }

    const transactionCode = await generatePrivateTxCode();
    const parsedTotalFees = totalFees ? parseFloat(totalFees) : 0;
    const parsedFirstPayment = firstPayment ? parseFloat(firstPayment) : 0;

    const newTransaction = await prisma.privateTransaction.create({
      data: {
        transactionCode,
        title: `${transactionType || "معاملة"} - ${transactionCode}`,
        category: transactionType || "غير محدد",
        complexity: surveyType,
        source: source || "مكتب ديتيلز",
        status: "in_progress",
        totalFees: parsedTotalFees,
        paidAmount: parsedFirstPayment,
        remainingAmount: parsedTotalFees - parsedFirstPayment,

        // الربط بالعميل والحي
        clientId: clientId,
        districtId: districtId || null,

        // 🚀 الربط الحقيقي والمباشر بسجل الأشخاص (Foreign Keys)
        brokerId: brokerId || null,
        agentId: followUpAgentId || null, // لاحظ أننا ربطناها بـ agentId في الداتابيز
        stakeholderId: stakeholderId || null,
        receiverId: receiverId || null,
        engOfficeBrokerId: engOfficeBrokerId || null,

        // باقي التفاصيل الوصفية تبقى في الـ JSON
        notes: {
          refs: {
            plot: plotNumber || null,
            plan: planId || null,
            sector: sectorName || null,
          },
          entities: Array.isArray(entities) ? entities : [],
          attachments: Array.isArray(attachments) ? attachments : [],
          statuses: {
            collection:
              parsedFirstPayment >= parsedTotalFees && parsedTotalFees > 0
                ? "fully_collected"
                : parsedFirstPayment > 0
                  ? "partially_collected"
                  : "not_collected",
            approval: "approved",
            settlement: "unsettled",
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: "تم إنشاء المعاملة بنجاح",
      data: newTransaction,
    });
  } catch (error) {
    console.error("Create Private Transaction Error:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في السيرفر أثناء حفظ المعاملة",
      error: error.message,
    });
  }
};

// ==================================================
// 2. جلب المعاملات (بشكل ذكي وسريع باستخدام Relations)
// GET /api/private-transactions
// ==================================================
const getPrivateTransactions = async (req, res) => {
  try {
    const transactions = await prisma.privateTransaction.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true } },
        districtNode: {
          select: { name: true, sector: { select: { name: true } } },
        },
        broker: { select: { name: true } },
        agent: { select: { name: true } },
      },
    });

    const formattedData = transactions.map((tx) => {
      const notes =
        typeof tx.notes === "object" && tx.notes !== null ? tx.notes : {};

      let ownerName = "غير محدد";
      if (tx.client?.name) {
        ownerName =
          typeof tx.client.name === "string"
            ? JSON.parse(tx.client.name).ar
            : tx.client.name.ar;
      }

      let collectionStatus = "not_collected";
      if (tx.paidAmount >= tx.totalFees && tx.totalFees > 0)
        collectionStatus = "محصل بالكامل";
      else if (tx.paidAmount > 0) collectionStatus = "محصل جزئي";
      else collectionStatus = "غير محصل";

      const dateObj = new Date(tx.createdAt);
      const formattedDate = `${dateObj.getFullYear()}/${String(dateObj.getMonth() + 1).padStart(2, "0")}/${String(dateObj.getDate()).padStart(2, "0")}`;

      return {
        // 💡 تم توحيد المسميات لتطابق الفرونت إند 100%
        id: tx.id, // الـ ID الحقيقي لقاعدة البيانات (مهم للحذف والتعديل)
        ref: tx.transactionCode, // رقم المعاملة للواجهة
        type: tx.category || "غير محدد",
        client: ownerName,
        district: notes?.refs?.sector || tx.districtNode?.name || "غير محدد",
        sector:
          notes?.refs?.sector || tx.districtNode?.sector?.name || "غير محدد",
        plot: notes?.refs?.plot || "—",
        plan: notes?.refs?.plan || "—",
        office: tx.source || "مكتب ديتيلز",
        sourceName: tx.source || "مباشر",

        mediator: tx.broker?.name || "—",
        agent: tx.agent?.name || "—",

        totalFees: tx.totalFees || 0,
        paidAmount: tx.paidAmount || 0,
        remainingAmount:
          tx.remainingAmount || (tx.totalFees || 0) - (tx.paidAmount || 0),

        collectionStatus: collectionStatus,
        status: tx.status || "جارية",
        date: formattedDate,
      };
    });

    res.json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Get Private Transactions Error:", error);
    res.status(500).json({ success: false, message: "فشل جلب المعاملات" });
  }
};

// ==================================================
// 3. تسجيل تحصيل مالي (مربوط بالأشخاص والبنك)
// POST /api/private-transactions/payments
// ==================================================
const addPrivatePayment = async (req, res) => {
  try {
    // 💡 استقبال جميع الحقول من الفرونت إند
    const {
      transactionId,
      amount,
      paymentMethod,
      periodRef,
      collectedFromType,
      collectedFromId,
      collectedFromOther,
      bankAccountId,
      receiverId,
      notes,
    } = req.body;

    const paymentAmount = parseFloat(amount);

    if (!transactionId || isNaN(paymentAmount) || paymentAmount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "بيانات التحصيل غير صحيحة" });
    }

    const transaction = await prisma.privateTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction)
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });

    // مسار المرفق إن وجد
    const receiptImage = req.file
      ? `/uploads/payments/${req.file.filename}`
      : null;

    // استخدام Transaction لحماية قواعد البيانات
    const result = await prisma.$transaction(async (prismaDelegate) => {
      // 1. إنشاء الدفعة وربطها بالموظف، والبنك، والعميل!
      const newPayment = await prismaDelegate.privatePayment.create({
        data: {
          transactionId: transactionId,
          amount: paymentAmount,
          method: paymentMethod || "نقدي",
          periodRef: periodRef || null,
          collectedFromType: collectedFromType || "من أشخاص النظام",
          collectedFromId: collectedFromId || null,
          collectedFromName: collectedFromOther || null,
          bankAccountId: bankAccountId || null,
          receiverId: receiverId || null,
          notes: notes || "",
          receiptImage: receiptImage,
        },
      });

      // 2. تحديث المتبقي في المعاملة
      const newPaidAmount = (transaction.paidAmount || 0) + paymentAmount;
      const newRemainingAmount = (transaction.totalFees || 0) - newPaidAmount;

      await prismaDelegate.privateTransaction.update({
        where: { id: transactionId },
        data: {
          paidAmount: newPaidAmount,
          remainingAmount: newRemainingAmount < 0 ? 0 : newRemainingAmount,
        },
      });

      // 3. (اختياري لكن قوي) إذا كان الدفع بنكي، نزيد رصيد البنك
      if (paymentMethod === "بنكي" && bankAccountId) {
        await prismaDelegate.bankAccount.update({
          where: { id: bankAccountId },
          data: { systemBalance: { increment: paymentAmount } },
        });
      }

      return newPayment;
    });

    res
      .status(201)
      .json({ success: true, message: "تم تسجيل الدفعة بنجاح", data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 4. جلب إحصائيات لوحة القيادة
// GET /api/private-transactions/dashboard-stats
// ==================================================
const getDashboardStats = async (req, res) => {
  try {
    // جلب الإجماليات
    const aggregations = await prisma.privateTransaction.aggregate({
      _count: { id: true },
      _sum: { totalFees: true, paidAmount: true },
    });

    // 💡 جلب آخر 5 معاملات لعرضها في الجدول الصغير في الداشبورد
    const recentTx = await prisma.privateTransaction.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true } } },
    });

    const recentFormatted = recentTx.map((tx) => {
      let clientName = "عميل";
      if (tx.client?.name) {
        clientName =
          typeof tx.client.name === "string"
            ? JSON.parse(tx.client.name).ar
            : tx.client.name.ar;
      }
      return {
        id: tx.id,
        ref: tx.transactionCode,
        type: tx.category,
        client: clientName,
        value: tx.totalFees,
        status: tx.status === "in_progress" ? "جارية" : "مكتملة", // تعريب الحالة
        date: tx.createdAt.toISOString().split("T")[0],
      };
    });

    // عدد الوسطاء لتعبئة كارد "الوسطاء النشطون"
    const activeBrokersCount = await prisma.person.count({
      where: { role: "وسيط" },
    });

    res.json({
      success: true,
      data: {
        totalCount: aggregations._count.id || 0,
        totalProfits: aggregations._sum.totalFees || 0,
        vaultBalance: aggregations._sum.paidAmount || 0,
        activeBrokers: activeBrokersCount,
        recentTransactions: recentFormatted, // 👈 هذا ما ينتظره الفرونت إند للجدول
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل جلب الإحصائيات" });
  }
};

// ==================================================
// 5. حذف المعاملة
// DELETE /api/private-transactions/:id
// ==================================================
const deletePrivateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.privateTransaction.delete({ where: { id } });
    res.json({ success: true, message: "تم حذف المعاملة بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: "لا يمكن حذف معاملة مرتبطة بمدفوعات مالية." });
  }
};

// ==================================================
// 6. تجميد / تنشيط المعاملة
// PATCH /api/private-transactions/:id/toggle-freeze
// ==================================================
const toggleFreezeTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    if (!tx) return res.status(404).json({ success: false, message: "غير موجودة" });

    const newStatus = tx.status === "مجمّدة" ? "جارية" : "مجمّدة";
    await prisma.privateTransaction.update({
      where: { id },
      data: { status: newStatus }
    });

    res.json({ success: true, message: `تم تغيير حالة المعاملة إلى: ${newStatus}` });
  } catch (error) {
    res.status(500).json({ success: false, message: "حدث خطأ" });
  }
};

module.exports = {
  createPrivateTransaction,
  getPrivateTransactions,
  addPrivatePayment,
  getDashboardStats,
  deletePrivateTransaction, // 👈
  toggleFreezeTransaction   // 👈
};

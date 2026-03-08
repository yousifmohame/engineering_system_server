// src/controllers/privateTransactionController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ==================================================
// دالة مساعدة: توليد رقم المعاملة الخاصة (مثال: PTX-2026-0001)
// ==================================================
const generatePrivateTxCode = async () => {
  const year = new Date().getFullYear();
  const prefix = `PTX-${year}-`;

  const lastTx = await prisma.privateTransaction.findFirst({
    where: { transactionCode: { startsWith: prefix } },
    orderBy: { transactionCode: "desc" },
  });

  let nextNumber = 1;
  if (lastTx) {
    try {
      const lastNumberStr = lastTx.transactionCode.split("-")[2];
      nextNumber = parseInt(lastNumberStr, 10) + 1;
    } catch (e) {
      nextNumber = 1;
    }
  }

  return `${prefix}${String(nextNumber).padStart(4, "0")}`;
};

// ==================================================
// 1. إنشاء معاملة خاصة جديدة
// POST /api/private-transactions
// ==================================================
const createPrivateTransaction = async (req, res) => {
  try {
    const {
      transactionType, // اصدار، تجديد، تعديل
      surveyType, // برافع، بدون رفع
      clientId, // المالك
      districtId, // الحي
      plotNumber, // القطعة
      planId, // المخطط
      entities, // الجهات (أمانة، هيئة...)
      source, // مصدر المعاملة
      attachments, // المرفقات المستلمة
      brokerId, // الوسيط
      followUpAgentId, // المعقب
      stakeholderId, // صاحب المصلحة
      receiverId, // المستلم
      engOfficeBrokerId, // وسيط المكتب الهندسي
      totalFees,
    } = req.body;

    if (!clientId) {
      return res
        .status(400)
        .json({ success: false, message: "المالك (العميل) مطلوب" });
    }

    const transactionCode = await generatePrivateTxCode();
    const title = `معاملة ${transactionType} (داخلي) - ${plotNumber ? `قطعة ${plotNumber}` : "جديدة"}`;

    const parsedTotalFees = totalFees ? parseFloat(totalFees) : 0;

    const newTransaction = await prisma.privateTransaction.create({
      data: {
        transactionCode,
        title,
        category: transactionType,
        complexity: surveyType,
        source: source || "مكتب ديتيلز",
        status: "جديدة",
        authorities: entities || [],
        attachments: attachments || [],

        totalFees: parsedTotalFees,
        remainingAmount: parsedTotalFees, // المتبقي في البداية يساوي الإجمالي لأنه لم يدفع شيء بعد
        paidAmount: 0,

        // ربط العميل
        client: { connect: { id: clientId } },

        // ربط الحي (إن وجد)
        ...(districtId && { districtNode: { connect: { id: districtId } } }),

        // حفظ باقي التفاصيل داخل حقل notes كـ JSON لتخفيف الجداول
        notes: {
          plotNumber: plotNumber || null,
          planId: planId || null,
          roles: {
            brokerId: brokerId || null,
            followUpAgentId: followUpAgentId || null,
            stakeholderId: stakeholderId || null,
            receiverId: receiverId || null,
            engOfficeBrokerId: engOfficeBrokerId || null,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: "تم تسجيل المعاملة الداخلية بنجاح",
      data: newTransaction,
    });
  } catch (error) {
    console.error("Create Private Transaction Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "خطأ في السيرفر",
        error: error.message,
      });
  }
};

// ==================================================
// 2. جلب جميع المعاملات الخاصة (لعرضها في الجدول السري وقائمة التحصيل)
// GET /api/private-transactions
// ==================================================
const getPrivateTransactions = async (req, res) => {
  try {
    const transactions = await prisma.privateTransaction.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true, mobile: true } },
        districtNode: {
          select: { name: true, sector: { select: { name: true } } },
        },
      },
    });

    // تنسيق البيانات لتناسب الجدول في الفرونت إند
    const formattedData = transactions.map((tx) => {
      // استخراج الاسم العربي للعميل
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
        type: tx.category,
        client: clientName || "غير محدد",
        district: tx.districtNode?.name || "غير محدد",
        sector: tx.districtNode?.sector?.name || "غير محدد",

        // 💡 التحديث هنا: إرسال المبالغ كاملة بدلاً من إرسال totalFees كـ value فقط
        totalFees: tx.totalFees || 0,
        paidAmount: tx.paidAmount || 0,
        remainingAmount:
          tx.remainingAmount || (tx.totalFees || 0) - (tx.paidAmount || 0),

        // للاستخدام في الجدول (يتم عرض الإجمالي)
        value: tx.totalFees || 0,

        status: tx.status,
        date: tx.createdAt.toISOString().split("T")[0],
      };
    });

    res.json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Get Private Transactions Error:", error);
    res.status(500).json({ success: false, message: "فشل جلب المعاملات" });
  }
};

// ==================================================
// 3. تسجيل تحصيل مالي لمعاملة داخلية
// POST /api/private-transactions/payments
// ==================================================
const addPrivatePayment = async (req, res) => {
  try {
    const {
      transactionId,
      collectedFromType,
      collectedFromId,
      collectedFromOther,
      amount,
      periodRef,
      paymentMethod,
      bankAccountId,
      date,
      receiverId,
      notes,
    } = req.body;

    const paymentAmount = parseFloat(amount);

    if (!transactionId || isNaN(paymentAmount) || paymentAmount <= 0) {
      return res
        .status(400)
        .json({
          success: false,
          message: "بيانات التحصيل غير مكتملة أو غير صحيحة",
        });
    }

    // 1. جلب المعاملة للتحقق من المبالغ
    const transaction = await prisma.privateTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });
    }

    // 2. معالجة المرفق (إذا تم رفع صورة/ملف)
    let receiptImagePath = null;
    if (req.file) {
      // بافتراض أنك تستخدم multer لرفع الملفات، سيعود المسار هنا
      receiptImagePath = `/uploads/receipts/${req.file.filename}`;
    }

    // 3. تحديد اسم الشخص (سواء من النظام أو خارجي)
    let collectedFromName = collectedFromOther;
    if (collectedFromType === "من أشخاص النظام" && collectedFromId) {
      // يمكنك جلب اسم العميل أو الموظف من قاعدة البيانات هنا إذا أردت تخزينه كنص صريح
      // للسرعة سنعتمد على أن الفرونت إند يرسل الـ ID وسنحفظه
    }

    // 4. استخدام Transaction (DB Transaction) لضمان حفظ الدفعة وتحديث المعاملة معاً
    const result = await prisma.$transaction(async (prismaDelegate) => {
      // أ) إنشاء الدفعة الجديدة
      const newPayment = await prismaDelegate.privatePayment.create({
        data: {
          transactionId,
          amount: paymentAmount,
          date: date ? new Date(date) : new Date(),
          method: paymentMethod,
          periodRef,
          collectedFromType,
          collectedFromId: collectedFromId || null,
          collectedFromName: collectedFromName || null,
          bankAccountId: bankAccountId || null,
          receiverId: receiverId || null,
          notes,
          receiptImage: receiptImagePath,
        },
      });

      // ب) تحديث مبالغ المعاملة (إضافة للمدفوع وخصم من المتبقي)
      const currentPaid = transaction.paidAmount || 0;
      const currentTotal = transaction.totalFees || 0;

      const newPaidAmount = currentPaid + paymentAmount;
      const newRemainingAmount = currentTotal - newPaidAmount;

      await prismaDelegate.privateTransaction.update({
        where: { id: transactionId },
        data: {
          paidAmount: newPaidAmount,
          remainingAmount: newRemainingAmount < 0 ? 0 : newRemainingAmount, // لا تجعل المتبقي بالسالب
        },
      });

      return newPayment;
    });

    res.status(201).json({
      success: true,
      message: "تم تسجيل التحصيل وتحديث الرصيد بنجاح",
      data: result,
    });
  } catch (error) {
    console.error("Add Private Payment Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "فشل في تسجيل التحصيل",
        error: error.message,
      });
  }
};

// ==================================================
// 4. جلب إحصائيات لوحة القيادة للنظام الداخلي
// GET /api/private-transactions/dashboard-stats
// ==================================================
const getDashboardStats = async (req, res) => {
  try {
    // 1. حساب الإجماليات (عدد المعاملات، إجمالي الأتعاب، إجمالي المحصل)
    const aggregations = await prisma.privateTransaction.aggregate({
      _count: { id: true },
      _sum: {
        totalFees: true,
        paidAmount: true,
      },
    });

    // 2. حساب عدد الوسطاء النشطين (نستخرجهم من حقل notes.roles.brokerId)
    // نجلب فقط المعاملات التي تحتوي على ملاحظات لتخفيف الحمل
    const transactionsWithNotes = await prisma.privateTransaction.findMany({
      where: { notes: { not: null } },
      select: { notes: true },
    });

    const uniqueBrokers = new Set();
    transactionsWithNotes.forEach((tx) => {
      const notes = tx.notes;
      if (notes && notes.roles && notes.roles.brokerId) {
        uniqueBrokers.add(notes.roles.brokerId);
      }
    });

    // 3. جلب آخر 10 معاملات حديثة للجدول
    const recentTx = await prisma.privateTransaction.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true } },
        districtNode: {
          select: { name: true, sector: { select: { name: true } } },
        },
      },
    });

    // تنسيق المعاملات لتناسب الجدول في الواجهة
    const formattedRecentTransactions = recentTx.map((tx) => {
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
        type: tx.category || "غير محدد",
        client: clientName,
        district: tx.districtNode?.name || "غير محدد",
        sector: tx.districtNode?.sector?.name || "غير محدد",
        value: tx.totalFees || 0,
        status: tx.status,
        date: tx.createdAt.toISOString().split("T")[0],
      };
    });

    // 4. تجميع النتيجة النهائية وإرسالها
    res.json({
      success: true,
      data: {
        totalCount: aggregations._count.id || 0,
        totalProfits: aggregations._sum.totalFees || 0,
        vaultBalance: aggregations._sum.paidAmount || 0,
        activeBrokers: uniqueBrokers.size || 0,
        recentTransactions: formattedRecentTransactions,
      },
    });
  } catch (error) {
    console.error("Get Private Dashboard Stats Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل جلب إحصائيات لوحة القيادة" });
  }
};

module.exports = {
  createPrivateTransaction,
  getPrivateTransactions,
  addPrivatePayment,
  getDashboardStats,
};

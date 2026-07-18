const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// توليد رقم التصفية الفريد
const generateSettlementNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `SET-${year}-`;
  const lastCycle = await prisma.transactionSettlementCycle.findFirst({
    where: { settlementNumber: { startsWith: prefix } },
    orderBy: { settlementNumber: "desc" },
  });
  let nextNumber = 1;
  if (lastCycle) {
    nextNumber = parseInt(lastCycle.settlementNumber.split("-")[2], 10) + 1;
  }
  return `${prefix}${String(nextNumber).padStart(3, "0")}`;
};

// 1. إنشاء دورة تصفية جديدة (مسودة)
exports.createSettlementCycle = async (req, res) => {
  try {
    const { name, periodFrom, periodTo, type, notes } = req.body;
    const settlementNumber = await generateSettlementNumber();

    const newCycle = await prisma.transactionSettlementCycle.create({
      data: {
        settlementNumber,
        name,
        periodFrom: periodFrom ? new Date(periodFrom) : null,
        periodTo: periodTo ? new Date(periodTo) : null,
        type: type || "دورية",
        notes,
        status: "مسودة",
        creatorId: req.user.id,
      },
    });

    res.status(201).json({ success: true, data: newCycle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. جلب سجلات التصفية
exports.getSettlementCycles = async (req, res) => {
  try {
    const cycles = await prisma.transactionSettlementCycle.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        creator: { select: { name: true } },
        reviewer: { select: { name: true } },
        approver: { select: { name: true } },
      },
    });
    res.status(200).json({ success: true, data: cycles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. تحديث حالة التصفية
exports.updateSettlementCycleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const cycle = await prisma.transactionSettlementCycle.update({
      where: { id },
      data: {
        status,
        ...(status === "معتمدة" ? { approverId: req.user.id } : {}),
      },
    });

    res.status(200).json({ success: true, data: cycle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. جلب تفاصيل تصفية واحدة (مُحدَّث لجلب كل العلاقات العميقة)
// 4. جلب تفاصيل تصفية واحدة
exports.getSettlementCycleById = async (req, res) => {
  try {
    const { id } = req.params;
    const cycle = await prisma.transactionSettlementCycle.findUnique({
      where: { id },
      include: {
        transactions: {
          include: {
            transaction: {
              include: {
                expenses: true,
                transactionExpenses: true,
                profitShares: { include: { person: true } },
                payments: true, // 👈 (السر هنا) إضافة جلب الدفعات من قاعدة البيانات
              },
            },
          },
        },
        persons: { include: { person: true } },
        adjustments: {
          include: {
            person: { select: { name: true } },
            addedBy: { select: { name: true } },
          },
        },
      },
    });
    if (!cycle)
      return res
        .status(404)
        .json({ success: false, message: "التصفية غير موجودة" });
    res.status(200).json({ success: true, data: cycle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. ربط المعاملات بالتصفية وإجراء الحسابات الأولية (مُحدَّث لتوزيع الأرباح على الأشخاص)
exports.linkTransactionsToCycle = async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionIds } = req.body;

    if (
      !transactionIds ||
      !Array.isArray(transactionIds) ||
      transactionIds.length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "يرجى تحديد معاملات للربط" });
    }

    const cycle = await prisma.transactionSettlementCycle.findUnique({
      where: { id },
    });
    if (!cycle || cycle.status === "معتمدة" || cycle.deletedAt) {
      return res
        .status(400)
        .json({ success: false, message: "لا يمكن التعديل على هذه التصفية" });
    }

    // جلب المعاملات مع المصروفات ونسب الأرباح (Profit Shares)
    const transactions = await prisma.privateTransaction.findMany({
      where: { id: { in: transactionIds } },
      include: { expenses: true, profitShares: true },
    });

    let totalAddedCollection = 0;
    let totalAddedExpenses = 0;
    let totalAddedProfit = 0;

    // خريطة لتجميع أرباح الأشخاص من جميع المعاملات
    const personsProfitMap = {};

    const linksData = transactions.map((tx) => {
      const paid =
        parseFloat(tx.paidAmount) || parseFloat(tx.collectionAmount) || 0;
      const expensesAmount = tx.expenses
        ? tx.expenses.reduce(
            (sum, exp) => sum + (parseFloat(exp.paidAmount) || 0), 
            0,
          )
        : 0;
      const netProfit = Math.max(0, paid - expensesAmount);

      totalAddedCollection += paid;
      totalAddedExpenses += expensesAmount;
      totalAddedProfit += netProfit;

      // 💡 توزيع الأرباح على الأشخاص بناءً على النسب المسجلة في المعاملة
      if (tx.profitShares && tx.profitShares.length > 0) {
        tx.profitShares.forEach((share) => {
          const shareAmount = netProfit * (parseFloat(share.percentage) / 100);
          if (!personsProfitMap[share.personId]) {
            personsProfitMap[share.personId] = 0;
          }
          personsProfitMap[share.personId] += shareAmount;
        });
      }

      return {
        settlementCycleId: id,
        transactionId: tx.id,
        allocatedCollection: paid,
        allocatedExpenses: expensesAmount,
        calculatedNetProfit: netProfit,
      };
    });

    await prisma.$transaction(async (txPrisma) => {
      // 1. إدراج العلاقات في الجدول الوسيط للمعاملات
      await txPrisma.settlementCycleTransaction.createMany({
        data: linksData,
        skipDuplicates: true,
      });

      // 2. تحديث مجاميع دورة التصفية
      await txPrisma.transactionSettlementCycle.update({
        where: { id },
        data: {
          transactionsCount: { increment: transactions.length },
          totalInboundCollection: { increment: totalAddedCollection },
          totalExpenses: { increment: totalAddedExpenses },
          totalNetProfit: { increment: totalAddedProfit },
          finalTotalAmount: { increment: totalAddedProfit }, // سيتأثر لاحقاً بالخصومات والتقريب
          status: "جارٍ اختيار المعاملات",
        },
      });

      // 3. إدراج أو تحديث أنصبة الأشخاص في (SettlementCyclePerson)
      for (const [personId, amount] of Object.entries(personsProfitMap)) {
        const existingPerson = await txPrisma.settlementCyclePerson.findUnique({
          where: {
            settlementCycleId_personId: { settlementCycleId: id, personId },
          },
        });

        if (existingPerson) {
          await txPrisma.settlementCyclePerson.update({
            where: { id: existingPerson.id },
            data: {
              profitShareAmount: { increment: amount },
              totalBeforeRounding: { increment: amount },
              finalTotal: { increment: amount },
              remainingAmount: { increment: amount }, // المتبقي للتسليم يزداد
            },
          });
        } else {
          await txPrisma.settlementCyclePerson.create({
            data: {
              settlementCycleId: id,
              personId: personId,
              profitShareAmount: amount,
              totalBeforeRounding: amount,
              finalTotal: amount,
              remainingAmount: amount,
            },
          });
        }
      }

      // 4. إقفال المعاملة إجرائياً لتجنب إدراجها في تصفية أخرى
      await txPrisma.privateTransaction.updateMany({
        where: { id: { in: transactionIds } },
        data: { settlementStatus: "في مسودة تصفية" },
      });
    });

    res
      .status(200)
      .json({
        success: true,
        message: "تم إدراج المعاملات وتوزيع الأنصبة بنجاح",
      });
  } catch (error) {
    console.error("Link Transactions Error:", error);
    res
      .status(500)
      .json({ success: false, message: "خطأ في السيرفر أثناء ربط المعاملات" });
  }
};

// 7. إضافة تسوية مستقلة (إضافة، خصم، مكافأة)
exports.addSettlementAdjustment = async (req, res) => {
  try {
    const { id } = req.params;
    const { personId, type, amount, reason, description } = req.body;

    if (!personId || !amount) {
      return res
        .status(400)
        .json({ success: false, message: "بيانات التسوية غير مكتملة" });
    }

    const parsedAmount = parseFloat(amount);

    // إشارة المبلغ بناءً على النوع (الخصم دائماً سالب)
    const finalAmount =
      type === "خصم" ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);

    await prisma.$transaction(async (txPrisma) => {
      // 1. إنشاء سجل التسوية
      await txPrisma.settlementAdjustment.create({
        data: {
          settlementCycleId: id,
          personId,
          type,
          amount: finalAmount,
          description: description || type,
          reason: reason || "",
          addedById: req.user.id,
        },
      });

      // 2. تحديث المجموع النهائي للتصفية إذا كان يؤثر على الإجمالي (اختياري حسب الـ Business Logic)
      // إذا كانت مكافأة تزيد الإجمالي الموزع، وإذا كان خصم يقلله.
      await txPrisma.transactionSettlementCycle.update({
        where: { id },
        data: {
          finalTotalAmount: { increment: finalAmount },
        },
      });
    });

    res.status(201).json({ success: true, message: "تم تسجيل التسوية بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 8. حذف تسوية مستقلة
exports.deleteSettlementAdjustment = async (req, res) => {
  try {
    const { id, adjustmentId } = req.params;

    const adjustment = await prisma.settlementAdjustment.findUnique({
      where: { id: adjustmentId },
    });
    if (!adjustment)
      return res
        .status(404)
        .json({ success: false, message: "التسوية غير موجودة" });

    await prisma.$transaction(async (txPrisma) => {
      await txPrisma.settlementAdjustment.delete({
        where: { id: adjustmentId },
      });

      // عكس تأثير المبلغ المحذوف من دورة التصفية
      await txPrisma.transactionSettlementCycle.update({
        where: { id },
        data: {
          finalTotalAmount: { decrement: adjustment.amount },
        },
      });
    });

    res.status(200).json({ success: true, message: "تم حذف التسوية بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. الحذف المنطقي لدورة التصفية
exports.deleteSettlementCycle = async (req, res) => {
  try {
    const { id } = req.params;

    // التحقق من وجود التصفية أولاً
    const cycle = await prisma.transactionSettlementCycle.findUnique({
      where: { id },
    });
    if (!cycle) {
      return res
        .status(404)
        .json({ success: false, message: "التصفية غير موجودة" });
    }

    // لا يمكن حذف تصفية معتمدة
    if (cycle.status === "معتمدة") {
      return res
        .status(400)
        .json({ success: false, message: "لا يمكن حذف تصفية معتمدة ومقفلة" });
    }

    await prisma.$transaction(async (txPrisma) => {
      // 1. إعادة حالة المعاملات المرتبطة إلى "غير مصفاة"
      const linkedTransactions =
        await txPrisma.settlementCycleTransaction.findMany({
          where: { settlementCycleId: id },
        });

      const transactionIds = linkedTransactions.map((t) => t.transactionId);

      if (transactionIds.length > 0) {
        await txPrisma.privateTransaction.updateMany({
          where: { id: { in: transactionIds } },
          data: { settlementStatus: "غير مصفاة" },
        });
      }

      // 2. تحديث التصفية إلى محذوفة/ملغاة
      await txPrisma.transactionSettlementCycle.update({
        where: { id },
        data: { deletedAt: new Date(), status: "ملغاة" },
      });
    });

    res
      .status(200)
      .json({
        success: true,
        message: "تم إلغاء التصفية وفك ارتباط المعاملات بنجاح",
      });
  } catch (error) {
    console.error("Delete Settlement Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

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
        ...(status === "معتمدة" ? { approverId: req.user.id } : {})
      },
    });

    res.status(200).json({ success: true, data: cycle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. جلب تفاصيل تصفية واحدة
exports.getSettlementCycleById = async (req, res) => {
  try {
    const { id } = req.params;
    const cycle = await prisma.transactionSettlementCycle.findUnique({
      where: { id },
      include: {
        transactions: { include: { transaction: true } },
        persons: { include: { person: true } },
        adjustments: { include: { person: { select: { name: true } }, addedBy: { select: { name: true } } } },
      }
    });
    if (!cycle) return res.status(404).json({ success: false, message: "التصفية غير موجودة" });
    res.status(200).json({ success: true, data: cycle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. الحذف المنطقي
exports.deleteSettlementCycle = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.transactionSettlementCycle.update({
      where: { id },
      data: { deletedAt: new Date(), status: "ملغاة" },
    });
    res.status(200).json({ success: true, message: "تم إلغاء التصفية بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// =======================================================
// 🚀 الإجراءات الجديدة المطلوبة لعمل الواجهة
// =======================================================

// 6. ربط المعاملات بالتصفية وإجراء الحسابات الأولية
exports.linkTransactionsToCycle = async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionIds } = req.body;

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({ success: false, message: "يرجى تحديد معاملات للربط" });
    }

    // التحقق من حالة التصفية
    const cycle = await prisma.transactionSettlementCycle.findUnique({ where: { id } });
    if (!cycle || cycle.status === "معتمدة" || cycle.deletedAt) {
      return res.status(400).json({ success: false, message: "لا يمكن التعديل على هذه التصفية" });
    }

    // جلب المعاملات المطلوبة مع مصروفاتها لمعرفة التكاليف الدقيقة
    const transactions = await prisma.privateTransaction.findMany({
      where: { id: { in: transactionIds } },
      include: { expenses: true } // جلب المصروفات لحساب الصافي
    });

    let totalAddedCollection = 0;
    let totalAddedExpenses = 0;
    let totalAddedProfit = 0;

    const linksData = transactions.map((tx) => {
      // 1. المحصل المتاح (paidAmount)
      const paid = parseFloat(tx.paidAmount) || parseFloat(tx.collectionAmount) || 0;
      
      // 2. المصروفات المخصومة من هذه المعاملة
      const expensesAmount = tx.expenses ? tx.expenses.reduce((sum, exp) => sum + (parseFloat(exp.amount) || 0), 0) : 0;
      
      // 3. الصافي المتاح للتوزيع (الربح)
      const netProfit = Math.max(0, paid - expensesAmount);

      totalAddedCollection += paid;
      totalAddedExpenses += expensesAmount;
      totalAddedProfit += netProfit;

      return {
        settlementCycleId: id,
        transactionId: tx.id,
        allocatedCollection: paid,
        allocatedExpenses: expensesAmount,
        calculatedNetProfit: netProfit
      };
    });

    // استخدام Transaction لضمان تنفيذ كل شيء أو فشله معاً (Atomic)
    await prisma.$transaction(async (txPrisma) => {
      // إدراج العلاقات في الجدول الوسيط (تجاهل المكرر)
      await txPrisma.settlementCycleTransaction.createMany({
        data: linksData,
        skipDuplicates: true
      });

      // تحديث مجاميع دورة التصفية
      await txPrisma.transactionSettlementCycle.update({
        where: { id },
        data: {
          transactionsCount: { increment: transactions.length },
          totalInboundCollection: { increment: totalAddedCollection },
          totalExpenses: { increment: totalAddedExpenses },
          totalNetProfit: { increment: totalAddedProfit },
          finalTotalAmount: { increment: totalAddedProfit }, // الرقم النهائي قبل الخصومات والتسويات
          status: "جارٍ اختيار المعاملات"
        }
      });

      // تغيير حالة المعاملات المربوطة لكي لا يتم اختيارها في تصفية أخرى
      await txPrisma.privateTransaction.updateMany({
        where: { id: { in: transactionIds } },
        data: { settlementStatus: "في مسودة تصفية" }
      });
    });

    res.status(200).json({ success: true, message: "تم إدراج المعاملات وتحديث المجاميع بنجاح" });
  } catch (error) {
    console.error("Link Transactions Error:", error);
    res.status(500).json({ success: false, message: "خطأ في السيرفر أثناء ربط المعاملات" });
  }
};

// 7. إضافة تسوية مستقلة (إضافة، خصم، مكافأة)
exports.addSettlementAdjustment = async (req, res) => {
  try {
    const { id } = req.params;
    const { personId, type, amount, reason, description } = req.body;

    if (!personId || !amount) {
      return res.status(400).json({ success: false, message: "بيانات التسوية غير مكتملة" });
    }

    const parsedAmount = parseFloat(amount);
    
    // إشارة المبلغ بناءً على النوع (الخصم دائماً سالب)
    const finalAmount = type === "خصم" ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);

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
          addedById: req.user.id
        }
      });

      // 2. تحديث المجموع النهائي للتصفية إذا كان يؤثر على الإجمالي (اختياري حسب الـ Business Logic)
      // إذا كانت مكافأة تزيد الإجمالي الموزع، وإذا كان خصم يقلله.
      await txPrisma.transactionSettlementCycle.update({
        where: { id },
        data: {
          finalTotalAmount: { increment: finalAmount }
        }
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

    const adjustment = await prisma.settlementAdjustment.findUnique({ where: { id: adjustmentId } });
    if (!adjustment) return res.status(404).json({ success: false, message: "التسوية غير موجودة" });

    await prisma.$transaction(async (txPrisma) => {
      await txPrisma.settlementAdjustment.delete({ where: { id: adjustmentId } });
      
      // عكس تأثير المبلغ المحذوف من دورة التصفية
      await txPrisma.transactionSettlementCycle.update({
        where: { id },
        data: {
          finalTotalAmount: { decrement: adjustment.amount }
        }
      });
    });

    res.status(200).json({ success: true, message: "تم حذف التسوية بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
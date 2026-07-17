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
        creatorId: req.user.id, // يفترض وجود user.id من الـ Auth Middleware
      },
    });

    res.status(201).json({ success: true, data: newCycle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. جلب سجلات التصفية (مع الفلاتر)
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
        adjustments: true,
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
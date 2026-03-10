const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ==========================================
// 1. حركات الخزنة
// ==========================================

// جلب الحركات مع حساب الرصيد التراكمي
const getTreasuryTransactions = async (req, res) => {
  try {
    const transactions = await prisma.treasuryTransaction.findMany({
      orderBy: { date: "asc" },
      include: {
        person: { select: { name: true } },
        transaction: { select: { transactionCode: true } }, // جلب رقم المعاملة المرتبطة
      },
    });

    let runningBalance = 0;
    const formattedData = transactions.map((tx) => {
      const balanceBefore = runningBalance;
      if (tx.isActive) {
        if (["إيداع", "تحصيل"].includes(tx.type)) runningBalance += tx.amount;
        else if (["سحب", "مصروف", "سلفة"].includes(tx.type))
          runningBalance -= tx.amount;
      }

      return {
        ...tx,
        date: tx.date.toISOString().split("T")[0],
        balanceBefore,
        balanceAfter: runningBalance,
        reference: tx.transaction?.transactionCode || tx.referenceText || "—",
        statement: tx.notes,
        metadata: {
          ...(tx.metadata && typeof tx.metadata === "object"
            ? tx.metadata
            : {}),
          beneficiary:
            tx.person?.name || (tx.metadata ? tx.metadata.beneficiary : ""),
        },
      };
    });

    res.json({
      success: true,
      data: formattedData.reverse(),
      currentBalance: runningBalance,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// تسجيل حركة جديدة
const createTreasuryTransaction = async (req, res) => {
  try {
    const data = req.body;
    let attachmentPath = req.file
      ? `/uploads/treasury/${req.file.filename}`
      : null;

    const parsedMetadata = data.metadata ? JSON.parse(data.metadata) : {};

    const newTx = await prisma.treasuryTransaction.create({
      data: {
        type: data.type,
        amount: parseFloat(data.amount) || 0,
        date: data.date ? new Date(data.date) : new Date(),
        referenceText: data.reference || data.statement || "",
        notes: data.notes || data.statement || "",
        attachmentUrl: attachmentPath,
        metadata: parsedMetadata,
        // 💡 الربط الصحيح للـ IDs القادمة من الفرونت إند
        transactionId:
          data.transactionId && data.transactionId !== ""
            ? data.transactionId
            : null,
        personId: data.personId && data.personId !== "" ? data.personId : null,
      },
    });
    res.status(201).json({ success: true, data: newTx });
  } catch (error) {
    console.error("Treasury Create Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// تعديل حركة موجودة
const updateTreasuryTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existingTx = await prisma.treasuryTransaction.findUnique({
      where: { id },
    });
    if (!existingTx)
      return res
        .status(404)
        .json({ success: false, message: "الحركة غير موجودة" });

    let attachmentPath = existingTx.attachmentUrl;
    if (req.file) attachmentPath = `/uploads/treasury/${req.file.filename}`;

    const parsedMetadata = data.metadata
      ? JSON.parse(data.metadata)
      : existingTx.metadata;

    const updatedTx = await prisma.treasuryTransaction.update({
      where: { id },
      data: {
        type: data.type,
        amount: parseFloat(data.amount) || 0,
        date: data.date ? new Date(data.date) : existingTx.date,
        referenceText: data.reference || data.statement || "",
        notes: data.notes || data.statement || "",
        attachmentUrl: attachmentPath,
        metadata: parsedMetadata,
        // 💡 الربط الصحيح للـ IDs
        transactionId:
          data.transactionId && data.transactionId !== ""
            ? data.transactionId
            : null,
        personId: data.personId && data.personId !== "" ? data.personId : null,
      },
    });

    res.json({ success: true, data: updatedTx, message: "تم التعديل بنجاح" });
  } catch (error) {
    console.error("Treasury Update Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// إلغاء / تفعيل حركة
const toggleTransactionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const tx = await prisma.treasuryTransaction.findUnique({ where: { id } });
    if (!tx)
      return res.status(404).json({ success: false, message: "غير موجود" });

    const updatedTx = await prisma.treasuryTransaction.update({
      where: { id },
      data: { isActive: !tx.isActive },
    });
    res.json({
      success: true,
      data: updatedTx,
      message: updatedTx.isActive ? "تم التفعيل" : "تم الإلغاء",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. إعدادات الخزنة والاحتياطي
// ==========================================
const getReserveSettings = async (req, res) => {
  try {
    let settings = await prisma.treasurySettings.findUnique({
      where: { id: 1 },
    });
    if (!settings) {
      settings = await prisma.treasurySettings.create({
        data: {
          id: 1,
          enabled: true,
          type: "نسبة مئوية",
          value: 27.3,
          method: "على كل معاملة",
        },
      });
    }
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateReserveSettings = async (req, res) => {
  try {
    const { enabled, type, value, method } = req.body;
    const settings = await prisma.treasurySettings.upsert({
      where: { id: 1 },
      update: { enabled, type, value: parseFloat(value) || 0, method },
      create: { id: 1, enabled, type, value: parseFloat(value) || 0, method },
    });
    res.json({
      success: true,
      data: settings,
      message: "تم حفظ إعدادات الاحتياطي",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getTreasuryTransactions,
  createTreasuryTransaction,
  updateTreasuryTransaction,
  toggleTransactionStatus,
  getReserveSettings,
  updateReserveSettings,
};

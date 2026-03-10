const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 1. تسجيل تسوية (مستحقات)
const createSettlement = async (req, res) => {
  try {
    const data = req.body;
    const settlement = await prisma.privateSettlement.create({
      data: {
        targetType: data.targetType,
        targetId: data.targetId || null,
        amount: parseFloat(data.amount),
        source: data.source,
        notes: data.notes,
        status: "PENDING",
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

module.exports = {
  createSettlement,
  deliverSettlement,
  recordInventory,
  createExpense,
};

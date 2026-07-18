const prisma = require("../utils/prisma");

// 1. إضافة مصروف جديد
exports.addExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { description, category, amount, date } = req.body;

    const parsedAmount = parseFloat(amount);

    const newExpense = await prisma.transactionExpense.create({
      data: {
        transactionId: id,
        description,
        category: category || "رسوم منصات",
        amount: parsedAmount, // 👈 التأكد من استخدام amount هنا بدلاً من paidAmount
        date: date ? new Date(date) : new Date(),
      }
    });

    res.status(201).json({ success: true, message: "تم تسجيل المصروف بنجاح", data: newExpense });
  } catch (error) {
    res.status(500).json({ message: "فشل في تسجيل المصروف", error: error.message });
  }
};

// 2. حذف مصروف
exports.deleteExpense = async (req, res) => {
  try {
    const { id, expenseId } = req.params;
    await prisma.transactionExpense.delete({ where: { id: expenseId } });
    res.status(200).json({ success: true, message: "تم حذف المصروف بنجاح" });
  } catch (error) {
    res.status(500).json({ message: "فشل في حذف المصروف", error: error.message });
  }
};
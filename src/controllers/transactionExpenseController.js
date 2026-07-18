const prisma = require("../utils/prisma");

// 1. إضافة مصروف جديد
exports.addExpense = async (req, res) => {
  try {
    const { id } = req.params; // PrivateTransaction ID
    const { description, category, amount, date } = req.body;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: "مبلغ المصروف غير صالح" });
    }

    const newExpense = await prisma.transactionExpense.create({
      data: {
        transactionId: id,
        description,
        category: category || "رسوم",
        // نضع القيمة في paidAmount كما هو معرف في Schema
        paidAmount: parsedAmount, 
        expectedAmount: parsedAmount,
        paymentStatus: "مدفوع",
        dueDate: date ? new Date(date) : new Date(),
        // payeeId: يمكن إضافته مستقبلاً إذا أردت ربط المصروف بشخص معين (معقب مثلاً)
      }
    });

    res.status(201).json({ success: true, message: "تم تسجيل المصروف بنجاح", data: newExpense });
  } catch (error) {
    console.error("Error adding expense:", error);
    res.status(500).json({ message: "فشل في تسجيل المصروف", error: error.message });
  }
};

// 2. حذف مصروف
exports.deleteExpense = async (req, res) => {
  try {
    const { id, expenseId } = req.params;

    const expense = await prisma.transactionExpense.findUnique({ where: { id: expenseId } });
    if (!expense) {
      return res.status(404).json({ message: "المصروف غير موجود" });
    }

    await prisma.transactionExpense.delete({
      where: { id: expenseId }
    });

    res.status(200).json({ success: true, message: "تم حذف المصروف بنجاح" });
  } catch (error) {
    console.error("Error deleting expense:", error);
    res.status(500).json({ message: "فشل في حذف المصروف", error: error.message });
  }
};
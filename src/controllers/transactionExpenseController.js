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
        category: category || "رسوم منصات",
        
        // 🚀 السر هنا: يجب حفظ المبلغ في كل هذه الحقول ليتطابق مع الـ Schema الخاص بك
        paidAmount: parsedAmount,       
        expectedAmount: parsedAmount,   
        approvedAmount: parsedAmount,   
        
        paymentStatus: "مدفوع",
        approvalStatus: "معتمد",
        dueDate: date ? new Date(date) : new Date(),
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
    await prisma.transactionExpense.delete({ where: { id: expenseId } });
    res.status(200).json({ success: true, message: "تم حذف المصروف بنجاح" });
  } catch (error) {
    res.status(500).json({ message: "فشل في حذف المصروف", error: error.message });
  }
};
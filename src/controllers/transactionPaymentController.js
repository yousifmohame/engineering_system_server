const prisma = require("../utils/prisma");

// 1. إضافة دفعة جديدة وتحديث المعاملة
exports.addPayment = async (req, res) => {
  try {
    const { id } = req.params; // Transaction ID
    const { amount, method, date, ref, notes } = req.body;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: "مبلغ الدفعة غير صالح" });
    }

    // التنفيذ داخل Transaction لضمان السلامة المحاسبية
    await prisma.$transaction(async (tx) => {
      // أ) إنشاء سجل الدفعة
      await tx.payment.create({
        data: {
          transactionId: id,
          amount: parsedAmount,
          method: method || "نقدي",
          date: date ? new Date(date) : new Date(),
          ref: ref || "",
          notes: notes || "",
          // التعديل هنا: استخدام receivedBy بدلاً من addedById ليتوافق مع الـ Schema
          receivedBy: {
             connect: { id: req.user.id }
          }
        }
      });

      // ب) تحديث إجمالي المحصل (paidAmount) داخل المعاملة
      await tx.privateTransaction.update({
        where: { id: id },
        data: {
          paidAmount: { increment: parsedAmount }
        }
      });
    });

    res.status(201).json({ success: true, message: "تم تسجيل الدفعة بنجاح" });
  } catch (error) {
    console.error("Error adding payment:", error);
    res.status(500).json({ message: "فشل في تسجيل الدفعة", error: error.message });
  }
};

// 2. حذف دفعة وخصمها من المعاملة
exports.deletePayment = async (req, res) => {
  try {
    const { id, paymentId } = req.params;

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      return res.status(404).json({ message: "الدفعة غير موجودة" });
    }

    // التنفيذ داخل Transaction للخصم العكسي
    await prisma.$transaction(async (tx) => {
      // أ) حذف الدفعة
      await tx.payment.delete({
        where: { id: paymentId }
      });

      // ب) خصم المبلغ المحذوف من إجمالي المحصل
      await tx.privateTransaction.update({
        where: { id: id },
        data: {
          paidAmount: { decrement: payment.amount }
        }
      });
    });

    res.status(200).json({ success: true, message: "تم حذف الدفعة بنجاح" });
  } catch (error) {
    console.error("Error deleting payment:", error);
    res.status(500).json({ message: "فشل في حذف الدفعة", error: error.message });
  }
};
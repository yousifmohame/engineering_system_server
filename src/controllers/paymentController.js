const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. Get All Cash Payments (For Reports & Lists)
exports.getCashPayments = async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { method: 'Cash' },
      include: {
        transaction: {
          select: {
            id: true,
            transactionCode: true,
            title: true,
            client: { select: { id: true, name: true, clientCode: true } }
          }
        },
        receivedBy: { select: { id: true, name: true } }
      },
      orderBy: { date: 'desc' }
    });

    // Format for frontend
    const formatted = payments.map(p => ({
      id: p.id,
      amount: p.amount,
      paymentDate: p.date.toISOString().split('T')[0],
      paymentFor: p.category || 'أتعاب مكتب',
      isFollowUpFee: p.isFollowUpFee,
      notes: p.notes,
      hasReceipt: !!p.receiptImage,
      receiptImage: p.receiptImage,
      status: 'مؤكد',
      transactionId: p.transaction.transactionCode,
      transactionTitle: p.transaction.title,
      clientName: p.transaction.client?.name || 'غير معروف',
      clientId: p.transaction.client?.clientCode,
      receivedBy: p.receivedBy?.name
    }));

    res.json(formatted);
  } catch (error) {
    console.error("Get Payments Error:", error);
    res.status(500).json({ message: "Failed to fetch payments" });
  }
};

// 2. Get Payments for a Specific Transaction
exports.getPaymentsByTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params; // This expects the UUID or Code
    
    // Find transaction first to get UUID
    const transaction = await prisma.transaction.findFirst({
        where: { 
            OR: [
                { id: transactionId },
                { transactionCode: transactionId }
            ]
        }
    });

    if (!transaction) return res.status(404).json({ message: "Transaction not found" });

    const payments = await prisma.payment.findMany({
      where: { transactionId: transaction.id },
      orderBy: { date: 'desc' },
      include: { receivedBy: true }
    });

    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: "Error fetching transaction payments" });
  }
};

// 3. Create Payment & Update Transaction Balance
exports.createCashPayment = async (req, res) => {
  // نستقبل مصفوفة allocations بدلاً من مجرد مبلغ إجمالي
  const { transactionId, paymentDate, isFollowUpFee, notes, receivedById, allocations } = req.body;
  const receiptPath = req.file ? req.file.path.replace(/\\/g, "/") : null;

  // تحويل allocations من نص (إذا جاء من FormData) إلى كائن
  let parsedAllocations = [];
  try {
    parsedAllocations = typeof allocations === 'string' ? JSON.parse(allocations) : allocations;
  } catch (e) {
    return res.status(400).json({ message: "صيغة بيانات التوزيع غير صحيحة" });
  }

  // حساب إجمالي المبلغ من التوزيعات
  const totalAmount = parsedAllocations.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

  if (totalAmount <= 0) {
    return res.status(400).json({ message: "يجب تحديد مبلغ للدفع على بند واحد على الأقل" });
  }

  try {
    // 1. جلب المعاملة الحالية مع هيكل الرسوم
    const transaction = await prisma.transaction.findUnique({
      where: { transactionCode: transactionId }, // أو id حسب استخدامك
      select: { id: true, totalFees: true, paidAmount: true, fees: true }
    });

    if (!transaction) return res.status(404).json({ message: "المعاملة غير موجودة" });

    // 2. تحديث هيكل الرسوم (fees JSON) بناءً على التوزيعات
    // نقوم بنسخ الرسوم الحالية للتعديل عليها
    let updatedFees = JSON.parse(JSON.stringify(transaction.fees || []));

    parsedAllocations.forEach(alloc => {
      // البحث عن البند داخل الهيكل المعقد (Categories -> Items)
      updatedFees.forEach(category => {
        if (category.items && Array.isArray(category.items)) {
          const itemIndex = category.items.findIndex(i => i.id === alloc.itemId || i.name === alloc.itemName);
          if (itemIndex !== -1) {
            const item = category.items[itemIndex];
            // تحديث المدفوع للبند
            const currentPaid = parseFloat(item.paid || 0);
            const amountToPay = parseFloat(alloc.amount);
            
            item.paid = currentPaid + amountToPay;
            item.remaining = (parseFloat(item.amount) - item.paid);
            item.status = item.remaining <= 0 ? 'paid' : 'partial';
          }
        }
      });
    });

    // 3. تنفيذ العمليات داخل Transaction لضمان السلامة
    const result = await prisma.$transaction(async (tx) => {
      // أ) إنشاء سجل الدفعة مع حفظ التوزيع
      const newPayment = await tx.payment.create({
        data: {
          amount: totalAmount,
          date: new Date(paymentDate),
          method: 'Cash',
          category: isFollowUpFee === 'true' ? 'أتعاب تعقيب' : 'أتعاب مكتب', // تصنيف عام
          isFollowUpFee: isFollowUpFee === 'true' || isFollowUpFee === true,
          notes: notes,
          receiptImage: receiptPath,
          transactionId: transaction.id,
          receivedById: receivedById,
          allocations: parsedAllocations // ✅ حفظ التوزيع للرجوع إليه
        }
      });

      // ب) تحديث المعاملة (الإجماليات + تفاصيل الرسوم المحدثة)
      const newPaidAmount = (transaction.paidAmount || 0) + totalAmount;
      const newRemaining = (transaction.totalFees || 0) - newPaidAmount;

      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          paidAmount: newPaidAmount,
          remainingAmount: newRemaining,
          fees: updatedFees // ✅ حفظ هيكل الرسوم المحدث
        }
      });

      return newPayment;
    });

    res.status(201).json(result);

  } catch (error) {
    console.error("Create Professional Payment Error:", error);
    res.status(500).json({ message: "فشل تسجيل الدفعة", error: error.message });
  }
};
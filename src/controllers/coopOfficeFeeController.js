const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// دالة توليد الرقم بالتنسيق: 2026-03-00001 (سنة - شهر - 5 أرقام)
const generateFeeCode = async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `${year}-${month}-`;

  const lastFee = await prisma.coopOfficeFee.findFirst({
    where: { transactionCode: { startsWith: prefix } },
    orderBy: { transactionCode: 'desc' }
  });

  let nextNumber = 1;
  if (lastFee) {
    const parts = lastFee.transactionCode.split('-');
    if (parts.length === 3) {
      nextNumber = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${String(nextNumber).padStart(5, '0')}`;
};

// 1. جلب الأتعاب
const getFees = async (req, res) => {
  try {
    const fees = await prisma.coopOfficeFee.findMany({
      orderBy: { createdAt: 'desc' },
      include: { office: { select: { name: true } } }
    });

    const formattedData = fees.map(fee => ({
      id: fee.transactionCode,
      dbId: fee.id,
      internalName: fee.internalName,
      officeName: fee.office?.name || "مكتب محذوف",
      isSurveyOnly: fee.isSurveyOnly ? "نعم" : "لا",
      isPrepToo: fee.isPrepToo ? "نعم" : "لا",
      officeFees: fee.officeFees,
      paidAmount: fee.paidAmount,
      dueDate: fee.dueDate ? fee.dueDate.toISOString().split('T')[0] : "—",
      status: fee.status,
      notes: fee.notes
    }));

    res.json({ success: true, data: formattedData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. إنشاء مطالبة أتعاب جديدة
const createFee = async (req, res) => {
  try {
    const { internalName, officeId, isSurveyOnly, isPrepToo, officeFees, paidAmount, dueDate, notes } = req.body;
    
    const fees = parseFloat(officeFees) || 0;
    const paid = parseFloat(paidAmount) || 0;

    let status = "غير مدفوع";
    if (paid >= fees && fees > 0) status = "مدفوع بالكامل";
    else if (paid > 0) status = "مدفوع جزئيا";

    const transactionCode = await generateFeeCode();

    const newFee = await prisma.coopOfficeFee.create({
      data: {
        transactionCode,
        internalName,
        officeId,
        isSurveyOnly,
        isPrepToo,
        officeFees: fees,
        paidAmount: paid,
        dueDate: dueDate ? new Date(dueDate) : null,
        status,
        notes
      }
    });

    res.status(201).json({ success: true, data: newFee });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getFees, createFee };
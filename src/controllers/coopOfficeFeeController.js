const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const generateFeeCode = async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `${year}-${month}-`;

  const lastFee = await prisma.coopOfficeFee.findFirst({
    where: { transactionCode: { startsWith: prefix } },
    orderBy: { transactionCode: "desc" },
  });

  let nextNumber = 1;
  if (lastFee) {
    const parts = lastFee.transactionCode.split("-");
    if (parts.length === 3) nextNumber = parseInt(parts[2], 10) + 1;
  }
  return `${prefix}${String(nextNumber).padStart(5, "0")}`;
};

// 1. جلب الأتعاب (مُحدث ليجلب الحقول الجديدة)
const getFees = async (req, res) => {
  try {
    const fees = await prisma.coopOfficeFee.findMany({
      orderBy: { createdAt: "desc" },
      include: { office: { select: { name: true } } },
    });

    const formattedData = fees.map((fee) => ({
      id: fee.id, // نستخدم الـ ID الحقيقي للفرونت إند
      refCode: fee.transactionCode,
      internalName: fee.internalName,
      officeId: fee.officeId,
      officeName: fee.office?.name || "مكتب محذوف",
      isSurveyOnly: fee.isSurveyOnly ? "نعم" : "لا",
      isPrepToo: fee.isPrepToo ? "نعم" : "لا",
      officeFees: fee.officeFees,
      paidAmount: fee.paidAmount,
      dueDate: fee.dueDate ? fee.dueDate.toISOString().split("T")[0] : "—",
      status: fee.status,
      notes: fee.notes,

      // الحقول الجديدة
      transactionId: fee.transactionId,
      requestType: fee.requestType,
      providedServices: fee.providedServices,
      uploadStatus: fee.uploadStatus,
      licenseNumber: fee.licenseNumber,
      licenseYear: fee.licenseYear,
      serviceNumber: fee.serviceNumber,
      serviceYear: fee.serviceYear,
      entityName: fee.entityName,
    }));

    res.json({ success: true, data: formattedData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. إنشاء مطالبة (مُحدث ليستقبل الحقول الجديدة)
const createFee = async (req, res) => {
  try {
    const {
      internalName,
      officeId,
      isSurveyOnly,
      isPrepToo,
      officeFees,
      paidAmount,
      dueDate,
      notes,
      transactionId,
      requestType,
      providedServices,
      uploadStatus,
      licenseNumber,
      licenseYear,
      serviceNumber,
      serviceYear,
      entityName,
    } = req.body;

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
        isSurveyOnly: Boolean(isSurveyOnly),
        isPrepToo: Boolean(isPrepToo),
        officeFees: fees,
        paidAmount: paid,
        dueDate: dueDate ? new Date(dueDate) : null,
        status,
        notes,
        transactionId: transactionId || null,
        requestType,
        providedServices,
        uploadStatus,
        licenseNumber,
        licenseYear,
        serviceNumber,
        serviceYear,
        entityName,
      },
    });

    res.status(201).json({ success: true, data: newFee });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. تعديل مطالبة موجودة
const updateFee = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    if (data.officeFees !== undefined)
      data.officeFees = parseFloat(data.officeFees) || 0;
    if (data.paidAmount !== undefined)
      data.paidAmount = parseFloat(data.paidAmount) || 0;
    if (data.dueDate) data.dueDate = new Date(data.dueDate);

    // تحديث حالة الدفع تلقائياً إذا تم تعديل المبالغ
    if (data.officeFees !== undefined && data.paidAmount !== undefined) {
      if (data.paidAmount >= data.officeFees && data.officeFees > 0)
        data.status = "مدفوع بالكامل";
      else if (data.paidAmount > 0) data.status = "مدفوع جزئيا";
      else data.status = "غير مدفوع";
    }

    const updated = await prisma.coopOfficeFee.update({
      where: { id },
      data: data,
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. حذف مطالبة
const deleteFee = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.coopOfficeFee.delete({ where: { id } });
    res.json({ success: true, message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getFees, createFee, updateFee, deleteFee };

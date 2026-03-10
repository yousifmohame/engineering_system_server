const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// توليد رقم الطلب التلقائي
const generateRequestNumber = async () => {
  const lastRecord = await prisma.disbursement.findFirst({
    orderBy: { createdAt: "desc" },
  });
  if (!lastRecord) return "PAY-0001";

  try {
    const lastNumber = parseInt(lastRecord.requestNumber.split("-")[1]);
    return `PAY-${String(lastNumber + 1).padStart(4, "0")}`;
  } catch (e) {
    return `PAY-${Date.now().toString().slice(-4)}`;
  }
};

// 1. جلب جميع الطلبات
const getDisbursements = async (req, res) => {
  try {
    const disbursements = await prisma.disbursement.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        beneficiary: { select: { id: true, name: true } }, // 👈 التصحيح هنا: اسم العلاقة beneficiary
      },
    });

    const formattedData = disbursements.map((item) => ({
      ...item,
      // 💡 نعرض اسم الشخص من العلاقة، وإلا من الحقل النصي beneficiaryName
      beneficiary: item.beneficiary?.name || item.beneficiaryName || "—",
      personId: item.beneficiaryId || "", // 👈 نرسل الـ ID للفرونت إند
      date: item.date.toISOString().split("T")[0],
      expectedReturnDate: item.expectedReturnDate
        ? item.expectedReturnDate.toISOString().split("T")[0]
        : null,
    }));

    res.json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Get Disbursements Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. إنشاء طلب صرف جديد
const createDisbursement = async (req, res) => {
  try {
    const data = req.body;
    let attachmentPath = req.file
      ? `/uploads/disbursements/${req.file.filename}`
      : null;
    const requestNumber = await generateRequestNumber();

    const amount = parseFloat(data.amount) || 0;

    let repaymentStatus = "غير مطلوب";
    let remainingAmount = 0;
    if (data.type === "سلفة" || data.type === "سحب") {
      repaymentStatus = "لم يسدد";
      remainingAmount = amount;
    }

    // 💡 تجهيز كائن البيانات
    const requestData = {
      requestNumber,
      type: data.type,
      amount,
      date: data.date ? new Date(data.date) : new Date(),
      reason: data.reason,
      notes: data.notes,
      requestAttachment: attachmentPath,
      isRelatedToTx:
        data.isRelatedToTx === "true" || data.isRelatedToTx === true,
      department: data.department,
      importance: data.importance,
      repaymentType: data.repaymentType,
      repaymentMethod: data.repaymentMethod,
      expectedReturnDate: data.expectedReturnDate
        ? new Date(data.expectedReturnDate)
        : null,
      repaymentStatus,
      remainingAmount,
    };

    // 💡 الربط الذكي (استخدام beneficiary بدلاً من person)
    if (data.personId && data.personId !== "") {
      requestData.beneficiary = { connect: { id: data.personId } };
      requestData.beneficiaryName = null; // تفريغ الحقل النصي
    } else {
      requestData.beneficiaryName = data.beneficiaryName || data.beneficiary || "غير محدد";
    }

    const newRequest = await prisma.disbursement.create({
      data: requestData,
    });

    res.status(201).json({ success: true, data: newRequest });
  } catch (error) {
    console.error("Create Disbursement Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. اعتماد وتنفيذ (أو رفض) الطلب
const executeDisbursement = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    let attachmentPath = req.file
      ? `/uploads/disbursements/${req.file.filename}`
      : null;

    const updatedRequest = await prisma.disbursement.update({
      where: { id },
      data: {
        status: data.status,
        executionMethod: data.executionMethod,
        executionReference: data.executionReference,
        executionNotes: data.executionNotes,
        executionAttachment: attachmentPath || undefined,
        executedAt: data.status === "تم الدفع" ? new Date() : null,
      },
    });

    res.json({
      success: true,
      data: updatedRequest,
      message: `تم تحديث حالة الطلب إلى: ${data.status}`,
    });
  } catch (error) {
    console.error("Execute Disbursement Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. تعديل الطلب
const updateDisbursement = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existing = await prisma.disbursement.findUnique({ where: { id } });
    if (!existing)
      return res.status(404).json({ success: false, message: "غير موجود" });

    let attachmentPath = existing.requestAttachment;
    if (req.file)
      attachmentPath = `/uploads/disbursements/${req.file.filename}`;

    const amount = parseFloat(data.amount) || 0;

    let repaymentStatus = existing.repaymentStatus;
    let remainingAmount = existing.remainingAmount;
    if (
      (data.type === "سلفة" || data.type === "سحب") &&
      existing.type === "مصروف"
    ) {
      repaymentStatus = "لم يسدد";
      remainingAmount = amount;
    } else if (data.type === "مصروف") {
      repaymentStatus = "غير مطلوب";
      remainingAmount = 0;
    }

    let updateData = {
      type: data.type,
      amount,
      date: data.date ? new Date(data.date) : existing.date,
      reason: data.reason,
      notes: data.notes,
      requestAttachment: attachmentPath,
      isRelatedToTx:
        data.isRelatedToTx === "true" || data.isRelatedToTx === true,
      department: data.department,
      repaymentType: data.repaymentType,
      repaymentMethod: data.repaymentMethod,
      expectedReturnDate: data.expectedReturnDate
        ? new Date(data.expectedReturnDate)
        : null,
      repaymentStatus,
      remainingAmount,
    };

    // 💡 تحديث الربط (استخدام beneficiary بدلاً من person)
    if (data.personId && data.personId !== "") {
      updateData.beneficiary = { connect: { id: data.personId } };
      updateData.beneficiaryName = null;
    } else if (data.personId === "") {
      updateData.beneficiary = { disconnect: true };
      updateData.beneficiaryName = data.beneficiaryName || data.beneficiary || "غير محدد";
    }

    const updatedRequest = await prisma.disbursement.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, data: updatedRequest });
  } catch (error) {
    console.error("Update Disbursement Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. حذف الطلب
const deleteDisbursement = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.disbursement.delete({ where: { id } });
    res.json({ success: true, message: "تم الحذف بنجاح" });
  } catch (error) {
    console.error("Delete Disbursement Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDisbursements,
  createDisbursement,
  executeDisbursement,
  updateDisbursement,
  deleteDisbursement,
};
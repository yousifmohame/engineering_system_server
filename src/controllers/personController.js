const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 💡 حل مشكلة الـ Unique Constraint (البحث بالكود الأكبر وليس الأحدث)
const generatePersonCode = async () => {
  const lastRecord = await prisma.person.findFirst({
    orderBy: { personCode: "desc" },
  });
  if (!lastRecord || !lastRecord.personCode) return "P-001";

  const lastNumber = parseInt(lastRecord.personCode.replace("P-", ""));
  if (isNaN(lastNumber)) return `P-${Date.now().toString().slice(-4)}`; // أمان إضافي

  return `P-${String(lastNumber + 1).padStart(3, "0")}`;
};

// 1. جلب جميع الأشخاص مع إحصائيات حقيقية من العلاقات
// 1. جلب جميع الأشخاص مع إحصائيات حقيقية من العلاقات
const getPersons = async (req, res) => {
  try {
    const persons = await prisma.person.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        disbursements: {
          select: { requestNumber: true, type: true, amount: true },
        },

        // 💡 جلب المعاملة المرتبطة لكي نعرض رقم المرجع (ref) في الواجهة
        settlementsTarget: {
          include: { transaction: { select: { transactionCode: true } } },
        },
        paymentsCollected: {
          include: { transaction: { select: { transactionCode: true } } },
        },

        // جلب المعاملات التي شارك فيها
        brokeredTransactions: {
          include: { districtNode: { select: { name: true } } },
        },
        agentTransactions: {
          include: { districtNode: { select: { name: true } } },
        },
        stakeholderTransactions: {
          include: { districtNode: { select: { name: true } } },
        },
      },
    });

    const formatted = persons.map((p) => {
      const disbursementsCount = p.disbursements?.length || 0;
      const settlementsCount = p.settlementsTarget?.length || 0;
      const collectionsCount = p.paymentsCollected?.length || 0;

      // 💡 دمج جميع المعاملات التي شارك فيها هذا الشخص في مصفوفة واحدة
      const allTransactions = [
        ...(p.brokeredTransactions || []),
        ...(p.agentTransactions || []),
        ...(p.stakeholderTransactions || []),
      ].map((tx) => ({
        id: tx.id,
        code: tx.transactionCode,
        amount: tx.totalFees || 0,
        district: tx.districtNode?.name || "حي غير محدد",
        date: tx.createdAt.toISOString().split("T")[0],
      }));

      // إزالة التكرار
      const uniqueTransactions = Array.from(
        new Map(allTransactions.map((item) => [item.id, item])).values(),
      );
      const transactionsCount = uniqueTransactions.length;

      const totalDisbursementsAmount = (p.disbursements || []).reduce(
        (sum, item) => sum + item.amount,
        0,
      );

      // 💡 تنسيق البيانات للتابات في الواجهة الأمامية
      const formattedSettlements = (p.settlementsTarget || []).map((s) => ({
        ref: s.transaction?.transactionCode || "تسوية عامة",
        status: s.status,
        amount: s.amount,
      }));

      const formattedCollections = (p.paymentsCollected || []).map((c) => ({
        ref: c.transaction?.transactionCode || "تحصيل عام",
        method: c.method,
        amount: c.amount,
      }));

      // فصل البيانات غير المطلوبة لتخفيف الـ Response
      const {
        brokeredTransactions,
        agentTransactions,
        stakeholderTransactions,
        settlementsTarget,
        paymentsCollected,
        ...personData
      } = p;

      return {
        ...personData,
        transactionsList: uniqueTransactions,
        settlementsTarget: formattedSettlements, // 👈 إعادة إرسالها للواجهة بشكل منسق
        paymentsCollected: formattedCollections, // 👈 إعادة إرسالها للواجهة بشكل منسق
        stats: {
          transactions: transactionsCount,
          settlements: settlementsCount,
          collections: collectionsCount,
          disbursements: disbursementsCount,
          totalDisbursementsAmount,
        },
      };
    });

    res.json({ success: true, data: formatted });
  } catch (error) {
    console.error("Get Persons Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
// 1. إضافة شخص جديد
const createPerson = async (req, res) => {
  try {
    const data = req.body;
    const personCode = await generatePersonCode();

    let attachmentsList = [];
    if (req.files && req.files.length > 0) {
      attachmentsList = req.files.map((f) => ({
        name: f.originalname,
        url: `/uploads/persons/${f.filename}`,
        size: f.size,
      }));
    }

    let transferDetails = null;
    if (data.transferDetails) {
      try {
        transferDetails = JSON.parse(data.transferDetails);
      } catch (e) {}
    }

    const newPerson = await prisma.person.create({
      data: {
        personCode,
        name: data.name,
        role: data.role,
        phone: data.phone || "",
        whatsapp: data.whatsapp || "",
        telegram: data.telegram || "",
        email: data.email || null,
        country: data.country || "",
        isActive: data.isActive === "true" || data.isActive === true,
        preferredCurrency: data.preferredCurrency || "SAR",
        transferMethod: data.transferMethod || "",
        transferDetails: transferDetails,
        firstNameAr: data.firstNameAr,
        agreementType: data.agreementType,
        notes: data.notes || null, // 👈 عاد كنص عادي
        isLocalOnly: true,
        attachments: attachmentsList.length > 0 ? attachmentsList : undefined,

        // ✅ حفظ الحقول الجديدة مباشرة في أعمدتها
        idNumber: data.idNumber || null,
        monthlySalary: data.monthlySalary
          ? parseFloat(data.monthlySalary)
          : null,
        jobTitle: data.jobTitle || null,
      },
    });

    res.status(201).json({ success: true, data: newPerson });
  } catch (error) {
    console.error("Create Person Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. تعديل شخص
const updatePerson = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existingPerson = await prisma.person.findUnique({ where: { id } });
    if (!existingPerson)
      return res
        .status(404)
        .json({ success: false, message: "الشخص غير موجود" });

    let updatedAttachments = existingPerson.attachments
      ? [...existingPerson.attachments]
      : [];
    if (req.files && req.files.length > 0) {
      const newFiles = req.files.map((f) => ({
        name: f.originalname,
        url: `/uploads/persons/${f.filename}`,
        size: f.size,
      }));
      updatedAttachments = [...updatedAttachments, ...newFiles];
    }

    let transferDetails = existingPerson.transferDetails;
    if (data.transferDetails) {
      try {
        transferDetails = JSON.parse(data.transferDetails);
      } catch (e) {}
    }

    const updatedPerson = await prisma.person.update({
      where: { id },
      data: {
        name: data.name || existingPerson.name,
        role: data.role || existingPerson.role,
        phone: data.phone || existingPerson.phone,
        whatsapp: data.whatsapp || existingPerson.whatsapp,
        telegram: data.telegram || existingPerson.telegram,
        email: data.email !== undefined ? data.email : existingPerson.email,
        country: data.country || existingPerson.country,
        preferredCurrency:
          data.preferredCurrency || existingPerson.preferredCurrency,
        transferMethod: data.transferMethod || existingPerson.transferMethod,
        transferDetails: transferDetails,
        firstNameAr: data.firstNameAr || existingPerson.firstNameAr,
        agreementType: data.agreementType || existingPerson.agreementType,
        notes: data.notes !== undefined ? data.notes : existingPerson.notes, // 👈 نص عادي
        isActive:
          data.isActive !== undefined
            ? data.isActive === "true" || data.isActive === true
            : existingPerson.isActive,
        attachments: updatedAttachments,

        // ✅ التحديث المباشر للحقول الجديدة
        idNumber:
          data.idNumber !== undefined ? data.idNumber : existingPerson.idNumber,
        monthlySalary:
          data.monthlySalary !== undefined
            ? parseFloat(data.monthlySalary)
            : existingPerson.monthlySalary,
        jobTitle:
          data.jobTitle !== undefined ? data.jobTitle : existingPerson.jobTitle,
      },
    });

    res.json({ success: true, data: updatedPerson, message: "تم الحفظ بنجاح" });
  } catch (error) {
    console.error("Update Person Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 دالة حذف شخص
const deletePerson = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.person.delete({ where: { id } });
    res.json({ success: true, message: "تم حذف الشخص نهائياً" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "لا يمكن حذف شخص مرتبط بمعاملات أو تسويات",
    });
  }
};

// 💡 دالة جديدة لحذف مرفق محدد لشخص
const removePersonAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    const { fileUrl } = req.body;

    const person = await prisma.person.findUnique({ where: { id } });
    if (!person)
      return res
        .status(404)
        .json({ success: false, message: "الشخص غير موجود" });

    // إذا لم يكن هناك مرفقات أصلاً
    if (!person.attachments) return res.json({ success: true, data: person });

    // تصفية المرفقات وإزالة المرفق المطلوب
    const updatedAttachments = person.attachments.filter(
      (att) => att.url !== fileUrl,
    );

    const updatedPerson = await prisma.person.update({
      where: { id },
      data: { attachments: updatedAttachments },
    });

    res.json({
      success: true,
      data: updatedPerson,
      message: "تم حذف المرفق بنجاح",
    });
  } catch (error) {
    console.error("Remove Attachment Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 لا تنسَ تصدير الدالة الجديدة هنا
module.exports = {
  getPersons,
  createPerson,
  updatePerson,
  deletePerson,
  removePersonAttachment,
};

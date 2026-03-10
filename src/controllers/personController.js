const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// توليد رقم P-001
const generatePersonCode = async () => {
  const lastRecord = await prisma.person.findFirst({
    orderBy: { createdAt: "desc" },
  });
  if (!lastRecord || !lastRecord.personCode) return "P-001";
  const lastNumber = parseInt(lastRecord.personCode.replace("P-", ""));
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
// 2. إضافة شخص جديد
const createPerson = async (req, res) => {
  try {
    const { name, role, phone, agreementType, notes } = req.body;
    const personCode = await generatePersonCode();

    let attachmentsList = [];
    if (req.files && req.files.length > 0) {
      attachmentsList = req.files.map((f) => ({
        name: f.originalname,
        url: `/uploads/persons/${f.filename}`,
        size: f.size,
      }));
    }

    const newPerson = await prisma.person.create({
      data: {
        personCode,
        name,
        role,
        phone,
        agreementType,
        notes,
        attachments: attachmentsList.length > 0 ? attachmentsList : undefined,
      },
    });

    res.status(201).json({ success: true, data: newPerson });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 دالة تعديل شخص
const updatePerson = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, phone, agreementType, notes } = req.body;

    const existingPerson = await prisma.person.findUnique({ where: { id } });
    if (!existingPerson)
      return res
        .status(404)
        .json({ success: false, message: "الشخص غير موجود" });

    // إضافة المرفقات الجديدة للمرفقات القديمة إن وجدت
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

    const updatedPerson = await prisma.person.update({
      where: { id },
      data: {
        // إذا كان الطلب فقط لرفع ملفات (بدون إرسال بيانات نصية)، نحافظ على البيانات القديمة
        name: name || existingPerson.name,
        role: role || existingPerson.role,
        phone: phone || existingPerson.phone,
        agreementType: agreementType || existingPerson.agreementType,
        notes: notes || existingPerson.notes,
        attachments: updatedAttachments,
      },
    });

    res.json({
      success: true,
      // 💡 نرسل المرفقات الجديدة بوضوح لتحديثها في الواجهة
      data: { attachments: updatedPerson.attachments },
      message: "تم حفظ التعديلات/المرفقات بنجاح",
    });
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

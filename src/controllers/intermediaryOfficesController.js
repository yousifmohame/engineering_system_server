const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const getOffices = async (req, res) => {
  try {
    const offices = await prisma.intermediaryOffice.findMany({
      include: {
        contacts: true,
        officialAssets: true,
        intermediaryLinks: true,
        // transactions: true, // قم بإزالة التهميش عند تفعيل ربط المعاملات
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: offices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createOffice = async (req, res) => {
  try {
    // 💡 الحل الصحيح لتوليد الكود لمنع التكرار عند الحذف
    const lastOffice = await prisma.intermediaryOffice.findFirst({
      orderBy: { code: "desc" },
    });

    let nextNumber = 1;
    if (lastOffice && lastOffice.code.startsWith("IO-")) {
      const lastNumber = parseInt(lastOffice.code.replace("IO-", ""), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }

    const code = `IO-${String(nextNumber).padStart(3, "0")}`;

    const newOffice = await prisma.intermediaryOffice.create({
      data: { ...req.body, code },
    });
    res.status(201).json({ success: true, data: newOffice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateOffice = async (req, res) => {
  try {
    // 💡 عزل المصفوفات المرتبطة لكي لا تتحطم Prisma
    const {
      id,
      code,
      createdAt,
      updatedAt,
      contacts,
      officialAssets,
      intermediaryLinks,
      transactions,
      ...updateData
    } = req.body;

    const updated = await prisma.intermediaryOffice.update({
      where: { id: req.params.id },
      data: updateData,
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "فشل التحديث، تأكد من صحة البيانات." });
  }
};

const deleteOffice = async (req, res) => {
  try {
    await prisma.intermediaryOffice.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "لا يمكن حذف مكتب مرتبط ببيانات أو معاملات أخرى.",
    });
  }
};

const toggleFreeze = async (req, res) => {
  try {
    const office = await prisma.intermediaryOffice.findUnique({
      where: { id: req.params.id },
    });
    const newStatus = office.status === "مجمد" ? "نشط" : "مجمد";
    const updated = await prisma.intermediaryOffice.update({
      where: { id: req.params.id },
      data: { status: newStatus },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 💡 دوال جهات الاتصال (Contacts)
// ==================================================

const addContact = async (req, res) => {
  try {
    const { id } = req.params; // officeId
    const newContact = await prisma.officeContact.create({
      data: { ...req.body, officeId: id },
    });
    res.status(201).json({ success: true, data: newContact });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteContact = async (req, res) => {
  try {
    await prisma.officeContact.delete({ where: { id: req.params.contactId } });
    res.json({ success: true, message: "تم حذف جهة الاتصال" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 💡 دوال المكونات الرسمية (Official Assets)
// ==================================================

const addAsset = async (req, res) => {
  try {
    const { id } = req.params; // officeId
    const { type, label, content, uploadedBy } = req.body;

    // استخراج مسار الملف إذا تم رفعه
    const fileName = req.file ? req.file.originalname : null;
    const fileType = req.file
      ? req.file.mimetype.includes("image")
        ? "image"
        : "pdf"
      : content
        ? "text"
        : null;
    const filePath = req.file ? `/uploads/assets/${req.file.filename}` : null;

    const newAsset = await prisma.officeAsset.create({
      data: {
        officeId: id,
        type,
        label,
        content,
        fileName,
        fileType,
        uploadedBy: uploadedBy || "النظام",
        uploadedAt: new Date().toLocaleDateString("en-CA"),
        uploadedTime: new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        // حفظ المسار الفعلي في settings كمثال أو إضافة حقل URL مخصص في الداتابيز
        settings: filePath ? { url: filePath } : null,
      },
    });
    res.status(201).json({ success: true, data: newAsset });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteAsset = async (req, res) => {
  try {
    await prisma.officeAsset.delete({ where: { id: req.params.assetId } });
    res.json({ success: true, message: "تم حذف المكون" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 💡 دوال الوسطاء المرتبطين (Intermediary Links)
// ==================================================

const addIntermediaryLink = async (req, res) => {
  try {
    const { id } = req.params; // officeId
    const {
      intermediaryName,
      role,
      commissionType,
      commissionValue,
      isDefault,
    } = req.body;

    const newLink = await prisma.intermediaryLink.create({
      data: {
        officeId: id,
        intermediaryName,
        role,
        commissionType,
        commissionValue: parseFloat(commissionValue) || 0,
        isDefault: isDefault || false,
      },
    });
    res.status(201).json({ success: true, data: newLink });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteIntermediaryLink = async (req, res) => {
  try {
    await prisma.intermediaryLink.delete({ where: { id: req.params.linkId } });
    res.json({ success: true, message: "تم حذف الوسيط" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 لا تنسَ تحديث التصدير (Exports)
module.exports = {
  getOffices,
  createOffice,
  updateOffice,
  deleteOffice,
  toggleFreeze,
  addContact,
  deleteContact,
  addAsset,
  deleteAsset,
  addIntermediaryLink,
  deleteIntermediaryLink, // 👈 الدوال الجديدة
};

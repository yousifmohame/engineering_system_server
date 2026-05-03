// server/src/controllers/quotationTemplateController.js
const prisma = require("../utils/prisma");

const generateTemplateCode = async () => {
  const lastTemplate = await prisma.quotationTemplate.findFirst({
    where: { code: { startsWith: "TPL-" } },
    orderBy: { code: "desc" },
  });

  let nextSeq = 1;
  if (lastTemplate) {
    const lastSeq = parseInt(lastTemplate.code.split("-")[1], 10);
    nextSeq = lastSeq + 1;
  }
  return `TPL-${nextSeq.toString().padStart(3, "0")}`;
};

// 1. إنشاء نموذج جديد
const createTemplate = async (req, res) => {
  try {
    const { title, type, desc, sections, options, defaultTerms, employeeId } =
      req.body;
    const currentUserId = req.user?.id || req.employee?.id || employeeId;

    const newCode = await generateTemplateCode();
    const newTemplate = await prisma.quotationTemplate.create({
      data: {
        code: newCode,
        title,
        type,
        description: desc,
        sectionsConfig: sections,
        displayOptions: options,
        defaultTerms,
        employeeId: currentUserId, // تسجيل المنشئ
      },
    });
    return res.status(201).json({ success: true, data: newTemplate });
  } catch (error) {
    console.error("Create Template Error:", error);
    res.status(500).json({ success: false, message: "فشل إنشاء النموذج" });
  }
};

// 2. تحديث نموذج موجود
const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, type, desc, sections, options, defaultTerms, employeeId } =
      req.body;
    const currentUserId = req.user?.id || req.employee?.id || employeeId;

    const updatedTemplate = await prisma.quotationTemplate.update({
      where: { code: id },
      data: {
        title,
        type,
        description: desc,
        sectionsConfig: sections,
        displayOptions: options,
        defaultTerms,
        employeeId: currentUserId, // تسجيل من قام بآخر تعديل
      },
    });

    res.status(200).json({ success: true, data: updatedTemplate });
  } catch (error) {
    console.error("Update Template Error:", error);
    res.status(500).json({ success: false, message: "فشل تحديث النموذج" });
  }
};

// 3. حذف نموذج
const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.quotationTemplate.delete({ where: { code: id } });
    res.status(200).json({ success: true, message: "تم حذف النموذج بنجاح" });
  } catch (error) {
    console.error("Delete Template Error:", error);
    res.status(500).json({ success: false, message: "فشل حذف النموذج" });
  }
};

// 4. جلب جميع النماذج
const getTemplates = async (req, res) => {
  try {
    const templates = await prisma.quotationTemplate.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        creator: {
          select: { id: true, name: true }, // جلب اسم الموظف من جدول Employee
        },
      },
    });

    const mappedTemplates = templates.map((t) => ({
      id: t.code,
      code: t.code,
      title: t.title,
      type: t.type,
      desc: t.description || "",
      isDefault: t.isDefault,
      status: t.status,
      isFrozen: t.isFrozen,
      uses: t.usesCount,
      sections: t.sectionsConfig || {},
      options: t.displayOptions || {},
      defaultTerms: t.defaultTerms || "",
      userId: t.employeeId,
      creator: t.creator, // معلومات المنشئ/المعدل لتظهر بالجدول
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

    res.status(200).json({ success: true, data: mappedTemplates });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل جلب النماذج" });
  }
};

// 5. جلب نموذج واحد
const getTemplateById = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await prisma.quotationTemplate.findUnique({
      where: { code: id },
    });

    if (!template)
      return res.status(404).json({ success: false, message: "غير موجود" });

    const mappedTemplate = {
      id: template.code,
      title: template.title,
      type: template.type,
      description: template.description || "",
      sections: template.sectionsConfig || {},
      options: template.displayOptions || {},
      defaultTerms: template.defaultTerms || "",
      isFrozen: template.isFrozen,
    };

    res.status(200).json({ success: true, data: mappedTemplate });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل جلب التفاصيل" });
  }
};

// 6. التجميد / فك التجميد
const toggleFreezeTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { isFrozen, employeeId } = req.body;
    const currentUserId = req.user?.id || req.employee?.id || employeeId;

    const updatedTemplate = await prisma.quotationTemplate.update({
      where: { code: id },
      data: {
        isFrozen,
        employeeId: currentUserId, // تسجيل من قام بالتجميد
      },
    });
    res.status(200).json({ success: true, data: updatedTemplate });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل تحديث التجميد" });
  }
};

// 7. النسخ (Duplicate)
const duplicateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId } = req.body;
    const currentUserId = req.user?.id || req.employee?.id || employeeId;

    const originalTemplate = await prisma.quotationTemplate.findUnique({
      where: { code: id },
    });

    if (!originalTemplate)
      return res.status(404).json({ success: false, message: "غير موجود" });

    const newCode = await generateTemplateCode();

    const duplicatedTemplate = await prisma.quotationTemplate.create({
      data: {
        code: newCode,
        title: `${originalTemplate.title} (نسخة)`,
        type: originalTemplate.type,
        description: originalTemplate.description,
        sectionsConfig: originalTemplate.sectionsConfig,
        displayOptions: originalTemplate.displayOptions,
        defaultTerms: originalTemplate.defaultTerms,
        isFrozen: false,
        usesCount: 0,
        employeeId: currentUserId, // تسجيل من قام بالنسخ
      },
    });

    res.status(201).json({ success: true, data: duplicatedTemplate });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل النسخ" });
  }
};

const toggleTemplateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await prisma.quotationTemplate.findUnique({
      where: { code: id },
    });

    if (!template) return res.status(404).json({ message: "غير موجود" });

    const newStatus = template.status === "active" ? "disabled" : "active";
    await prisma.quotationTemplate.update({
      where: { code: id },
      data: { status: newStatus },
    });

    res.status(200).json({ success: true, message: "تم تغيير الحالة" });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل تغيير الحالة" });
  }
};

// 7. تعيين كافتراضي
const setAsDefault = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.quotationTemplate.updateMany({
      data: { isDefault: false },
    });

    await prisma.quotationTemplate.update({
      where: { code: id },
      data: { isDefault: true },
    });

    res.status(200).json({ success: true, message: "تم تعيينه كافتراضي" });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل التعيين" });
  }
};

module.exports = {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplates,
  getTemplateById,
  toggleTemplateStatus,
  setAsDefault,
  toggleFreezeTemplate,
  duplicateTemplate,
};

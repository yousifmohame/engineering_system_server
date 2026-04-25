// server/src/controllers/quotationTemplateController.js
const prisma = require("../utils/prisma");

// توليد كود النموذج (مثال: TPL-001)
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

// 1. إنشاء نموذج جديد (POST)
const createTemplate = async (req, res) => {
  try {
    const { title, type, desc, sections, options, defaultTerms } = req.body;

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
      },
    });
    return res.status(201).json({ success: true, data: newTemplate });
  } catch (error) {
    console.error("Create Template Error:", error);
    res.status(500).json({ success: false, message: "فشل إنشاء النموذج" });
  }
};

// 2. تحديث نموذج موجود (PUT)
const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params; // ID هنا هو الـ code مثل TPL-001
    const { title, type, desc, sections, options, defaultTerms } = req.body;

    const updatedTemplate = await prisma.quotationTemplate.update({
      where: { code: id },
      data: {
        title,
        type,
        description: desc,
        sectionsConfig: sections,
        displayOptions: options,
        defaultTerms,
      },
    });

    res.status(200).json({ success: true, data: updatedTemplate });
  } catch (error) {
    console.error("Update Template Error:", error);
    res.status(500).json({ success: false, message: "فشل تحديث النموذج" });
  }
};

// 3. حذف نموذج (DELETE)
const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.quotationTemplate.delete({
      where: { code: id },
    });

    res.status(200).json({ success: true, message: "تم حذف النموذج بنجاح" });
  } catch (error) {
    console.error("Delete Template Error:", error);
    // قد يحدث خطأ إذا كان النموذج مرتبطاً بعروض أسعار سابقة (Foreign Key Constraint)
    res
      .status(500)
      .json({
        success: false,
        message: "فشل حذف النموذج، قد يكون مرتبطاً بعروض أسعار سابقة",
      });
  }
};

// 4. جلب جميع النماذج (GET)
const getTemplates = async (req, res) => {
  try {
    const templates = await prisma.quotationTemplate.findMany({
      orderBy: { createdAt: "desc" },
    });

    const mappedTemplates = templates.map((t) => ({
      id: t.code,
      title: t.title,
      type: t.type,
      desc: t.description || "",
      isDefault: t.isDefault,
      uses: t.usesCount,
      sections: t.sectionsConfig || {},
      options: t.displayOptions || {},
      defaultTerms: t.defaultTerms || "",
      date: t.createdAt.toISOString().split("T")[0],
      status: t.status,
    }));

    res.status(200).json({ success: true, data: mappedTemplates });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل جلب النماذج" });
  }
};

// 5. جلب نموذج واحد بالتحديد (GET /:id) - ضروري لعملية التعديل
const getTemplateById = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await prisma.quotationTemplate.findUnique({
      where: { code: id },
    });

    if (!template) {
      return res
        .status(404)
        .json({ success: false, message: "النموذج غير موجود" });
    }

    // تجهيز البيانات لتتطابق مع ما تتوقعه الواجهة الأمامية
    const mappedTemplate = {
      id: template.code,
      title: template.title,
      type: template.type,
      description: template.description || "",
      sections: template.sectionsConfig || {},
      options: template.displayOptions || {},
      defaultTerms: template.defaultTerms || "",
    };

    res.status(200).json({ success: true, data: mappedTemplate });
  } catch (error) {
    console.error("Get Template By ID Error:", error);
    res.status(500).json({ success: false, message: "فشل جلب تفاصيل النموذج" });
  }
};

// 6. تغيير حالة النموذج (تفعيل/تعطيل)
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
};

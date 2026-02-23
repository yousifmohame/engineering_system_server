// server/src/controllers/quotationTemplateController.js
const prisma = require("../utils/prisma");

// توليد كود النموذج (مثال: TPL-001)
const generateTemplateCode = async () => {
  const lastTemplate = await prisma.quotationTemplate.findFirst({
    where: { code: { startsWith: 'TPL-' } },
    orderBy: { code: 'desc' },
  });

  let nextSeq = 1;
  if (lastTemplate) {
    const lastSeq = parseInt(lastTemplate.code.split('-')[1], 10);
    nextSeq = lastSeq + 1;
  }
  return `TPL-${nextSeq.toString().padStart(3, '0')}`;
};

// 1. إنشاء أو تحديث نموذج
const saveTemplate = async (req, res) => {
  try {
    const { id, title, type, desc, sections, options, defaultTerms } = req.body;

    // إذا تم تمرير id بكلمة NEW، فهذا يعني إنشاء نموذج جديد
    if (id === "NEW" || !id) {
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
        }
      });
      return res.status(201).json({ success: true, data: newTemplate });
    }

    // وإلا، فهو تعديل لنموذج موجود
    const updatedTemplate = await prisma.quotationTemplate.update({
      where: { code: id }, // نحن نستخدم الـ code في الواجهة كـ ID
      data: {
        title,
        type,
        description: desc,
        sectionsConfig: sections,
        displayOptions: options,
        defaultTerms,
      }
    });

    res.status(200).json({ success: true, data: updatedTemplate });
  } catch (error) {
    console.error("Save Template Error:", error);
    res.status(500).json({ success: false, message: 'فشل حفظ النموذج' });
  }
};

// 2. جلب جميع النماذج
const getTemplates = async (req, res) => {
  try {
    const templates = await prisma.quotationTemplate.findMany({
      orderBy: { createdAt: 'desc' }
    });

    // تحويل البيانات لتناسب شكل الواجهة الأمامية تماماً
    const mappedTemplates = templates.map(t => ({
      id: t.code,
      title: t.title,
      type: t.type,
      desc: t.description || "",
      isDefault: t.isDefault,
      uses: t.usesCount,
      sections: t.sectionsConfig || {},
      options: t.displayOptions || {},
      defaultTerms: t.defaultTerms || "",
      date: t.createdAt.toISOString().split('T')[0],
      status: t.status
    }));

    res.status(200).json({ success: true, data: mappedTemplates });
  } catch (error) {
    res.status(500).json({ success: false, message: 'فشل جلب النماذج' });
  }
};

// 3. تغيير حالة النموذج (تفعيل/تعطيل)
const toggleTemplateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await prisma.quotationTemplate.findUnique({ where: { code: id } });
    
    if (!template) return res.status(404).json({ message: 'غير موجود' });

    const newStatus = template.status === 'active' ? 'disabled' : 'active';
    await prisma.quotationTemplate.update({
      where: { code: id },
      data: { status: newStatus }
    });

    res.status(200).json({ success: true, message: 'تم تغيير الحالة' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'فشل تغيير الحالة' });
  }
};

// 4. تعيين كافتراضي
const setAsDefault = async (req, res) => {
  try {
    const { id } = req.params;

    // إلغاء الافتراضي من جميع النماذج الأخرى
    await prisma.quotationTemplate.updateMany({
      data: { isDefault: false }
    });

    // تعيين النموذج الحالي كافتراضي
    await prisma.quotationTemplate.update({
      where: { code: id },
      data: { isDefault: true }
    });

    res.status(200).json({ success: true, message: 'تم تعيينه كافتراضي' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'فشل التعيين' });
  }
};

module.exports = {
  saveTemplate,
  getTemplates,
  toggleTemplateStatus,
  setAsDefault
};
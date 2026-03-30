// controllers/formTemplateController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const generateDocumentSerial = async (docType) => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const prefix = `${docType}-${year}-${month}`;

  const lastUsage = await prisma.formUsage.findFirst({
    where: { trackingSerial: { startsWith: prefix } },
    orderBy: { createdAt: "desc" },
  });

  let nextSequence = 1;
  if (lastUsage) {
    const lastSerial = lastUsage.trackingSerial;
    const lastNum = parseInt(lastSerial.split("-").pop(), 10);
    nextSequence = lastNum + 1;
  }

  const sequenceStr = String(nextSequence).padStart(4, "0");
  return `${prefix}-${sequenceStr}`;
};

// ── 1. إنشاء نموذج جديد ──
exports.createTemplate = async (req, res) => {
  try {
    const {
      code,
      name,
      description,
      version,
      category,
      colorMode,
      numberFormat,
      timezone,
      fontFamily,
      fontSize,
      isPublic,
      pageSettings,
      headerImage,
      footerImage,
      bgImage,
      blocks,
      userId,
    } = req.body;

    const existingTemplate = await prisma.formTemplate.findUnique({
      where: { code },
    });
    if (existingTemplate) {
      return res
        .status(400)
        .json({ success: false, message: "كود النموذج مستخدم مسبقاً." });
    }

    const defaultPageSettings = pageSettings || {
      size: "A4",
      orientation: "portrait",
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      header_height: 30,
      footer_height: 20,
    };

    const newTemplate = await prisma.formTemplate.create({
      data: {
        code,
        name,
        description: description || "",
        version: version || "1.0",
        category: category || "hr",
        colorMode: colorMode || "color",
        numberFormat: numberFormat || "english",
        timezone: timezone || "Asia/Riyadh",
        fontFamily: fontFamily || "Tajawal",
        fontSize: fontSize || 12,
        isPublic: isPublic || false,
        pageSettings: defaultPageSettings,
        headerImage: headerImage || null,
        footerImage: footerImage || null,
        bgImage: bgImage || null,
        createdBy: userId || "system",
        blocks: {
          create:
            blocks && blocks.length > 0
              ? blocks.map((block, index) => ({
                  type: block.type || block.block_type || "text",
                  label: block.label || block.title || "حقل بدون اسم",
                  position: block.position || {
                    x: 0,
                    y: 0,
                    width: 80,
                    height: 10,
                  },
                  style: block.style || { alignment: "right" },
                  isEditable: block.isEditable ?? block.is_editable ?? true,
                  isRequired: block.isRequired ?? block.is_required ?? false,
                  dataSource: block.dataSource || block.data_source || "manual",
                  defaultValue:
                    block.defaultValue || block.default_value || null,
                  config: block.config || block.table_config || null,
                  order: index,
                }))
              : [],
        },
      },
      include: { blocks: true },
    });

    res
      .status(201)
      .json({
        success: true,
        message: "تم حفظ النموذج بنجاح",
        data: newTemplate,
      });
  } catch (error) {
    console.error("Error creating template:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "حدث خطأ أثناء حفظ النموذج",
        error: error.message,
      });
  }
};

// ── 2. جلب جميع النماذج ──
exports.getAllTemplates = async (req, res) => {
  try {
    const templates = await prisma.formTemplate.findMany({
      where: { isActive: true },
      include: { _count: { select: { usages: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ success: true, data: templates });
  } catch (error) {
    console.error("Error fetching templates:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء جلب النماذج" });
  }
};

// ── 3. جلب نموذج واحد بالتفاصيل (💡 الدالة المفقودة للـ 404) ──
exports.getTemplateById = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await prisma.formTemplate.findUnique({
      where: { id },
      include: {
        blocks: {
          orderBy: { order: "asc" }, // ترتيب البلوكات كما تم حفظها
        },
      },
    });

    if (!template) {
      return res
        .status(404)
        .json({ success: false, message: "النموذج غير موجود" });
    }

    res.status(200).json({ success: true, data: template });
  } catch (error) {
    console.error("Error fetching template by ID:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء جلب تفاصيل النموذج" });
  }
};

// ── 4. تحديث النموذج (💡 الدالة المفقودة لزر التعديل) ──
exports.updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      code,
      name,
      description,
      version,
      category,
      colorMode,
      numberFormat,
      timezone,
      fontFamily,
      fontSize,
      isPublic,
      pageSettings,
      headerImage,
      footerImage,
      bgImage,
      blocks,
    } = req.body;

    // في حالة التعديل الديناميكي للبلوكات، أفضل طريقة هي مسح البلوكات القديمة واستبدالها بالجديدة
    const updatedTemplate = await prisma.formTemplate.update({
      where: { id },
      data: {
        code,
        name,
        description: description || "",
        version: version || "1.0",
        category: category || "hr",
        colorMode: colorMode || "color",
        numberFormat: numberFormat || "english",
        timezone: timezone || "Asia/Riyadh",
        fontFamily: fontFamily || "Tajawal",
        fontSize: fontSize || 12,
        isPublic: isPublic || false,
        pageSettings: pageSettings || undefined,
        headerImage,
        footerImage,
        bgImage,
        blocks: {
          deleteMany: {}, // 💡 حذف كل البلوكات السابقة لهذا النموذج
          create:
            blocks && blocks.length > 0
              ? blocks.map((block, index) => ({
                  type: block.type || block.block_type || "text",
                  label: block.label || block.title || "حقل بدون اسم",
                  position: block.position || {
                    x: 0,
                    y: 0,
                    width: 80,
                    height: 10,
                  },
                  style: block.style || { alignment: "right" },
                  isEditable: block.isEditable ?? block.is_editable ?? true,
                  isRequired: block.isRequired ?? block.is_required ?? false,
                  dataSource: block.dataSource || block.data_source || "manual",
                  defaultValue:
                    block.defaultValue || block.default_value || null,
                  config: block.config || block.table_config || null,
                  order: index,
                }))
              : [],
        },
      },
      include: { blocks: true },
    });

    res
      .status(200)
      .json({
        success: true,
        message: "تم تحديث النموذج بنجاح",
        data: updatedTemplate,
      });
  } catch (error) {
    console.error("Error updating template:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "حدث خطأ أثناء تحديث النموذج",
        error: error.message,
      });
  }
};

// ── 5. استخدام نموذج (إنشاء سجل استخدام) ──
exports.useTemplate = async (req, res) => {
  try {
    const { templateId, targetEmployeeId, userId } = req.body;
    const template = await prisma.formTemplate.findUnique({
      where: { id: templateId },
      include: { blocks: { orderBy: { order: "asc" } } },
    });

    if (!template)
      return res
        .status(404)
        .json({ success: false, message: "النموذج غير موجود" });

    const serial = await generateDocumentSerial("FRM");

    const newUsage = await prisma.formUsage.create({
      data: {
        templateId,
        userId: userId || "system",
        targetUserId: targetEmployeeId || null,
        trackingSerial: serial,
        status: "draft",
      },
    });

    res
      .status(200)
      .json({
        success: true,
        message: "تم تهيئة النموذج للاستخدام",
        data: { usage: newUsage, template },
      });
  } catch (error) {
    console.error("Error using template:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء تهيئة النموذج" });
  }
};

// ── 6. حفظ بيانات الاستخدام ──
exports.saveUsageData = async (req, res) => {
  try {
    const { usageId } = req.params;
    const { fieldValues, status } = req.body;

    await prisma.$transaction(async (tx) => {
      await tx.formFieldValue.deleteMany({ where: { usageId } });

      if (fieldValues && fieldValues.length > 0) {
        const valuesToInsert = fieldValues.map((val) => ({
          usageId,
          blockId: val.blockId,
          textValue: val.textValue || null,
          jsonValue: val.jsonValue || null,
        }));
        await tx.formFieldValue.createMany({ data: valuesToInsert });
      }

      await tx.formUsage.update({
        where: { id: usageId },
        data: { status: status || "draft" },
      });
    });

    res.status(200).json({ success: true, message: "تم حفظ البيانات بنجاح" });
  } catch (error) {
    console.error("Error saving usage data:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء حفظ البيانات" });
  }
};

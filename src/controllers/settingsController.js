const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
/**
 * دالة مساعدة للتأكد من وجود إعدادات افتراضية
 * هذا يمنع حدوث خطأ عند أول تشغيل للنظام
 */
const getOrCreateDefaultSettings = async () => {
  let settings = await prisma.systemSettings.findFirst({
    where: { id: "singleton" },
  });

  if (!settings) {
    console.log("No system settings found, creating default settings...");
    try {
      settings = await prisma.systemSettings.create({
        data: {
          id: "singleton",
          gradingCriteria: {
            totalFeesWeight: 30,
            projectTypesWeight: 20,
            transactionTypesWeight: 15,
            completionRateWeight: 20,
            secretRatingWeight: 15,
          },
          gradeThresholds: {
            gradeA: { min: 80, max: 100 },
            gradeB: { min: 60, max: 79 },
            gradeC: { min: 0, max: 59 },
          },
        },
      });
    } catch (error) {
      console.error("Failed to create default settings:", error);
      // قد يحدث هذا إذا حاول مستخدمان إنشاءها في نفس اللحظة
      settings = await prisma.systemSettings.findFirst({
        where: { id: "singleton" },
      });
    }
  }
  return settings;
};

/**
 * جلب إعدادات النظام
 * GET /api/settings/system
 */
const getSystemSettings = async (req, res) => {
  try {
    const settings = await getOrCreateDefaultSettings();
    res.json(settings);
  } catch (error) {
    console.error("Error fetching system settings:", error);
    res.status(500).json({ error: "Error fetching system settings" });
  }
};

/**
 * جلب جميع أغراض الطلبات (مع إمكانية الفلترة بالنوع)
 * GET /api/settings/request-purposes
 * Query Params: ?type=brief أو ?type=detailed
 */
const getRequestPurposes = async (req, res) => {
  const { type } = req.query;

  try {
    const whereClause = {};
    if (type) {
      whereClause.type = type;
    }

    const purposes = await prisma.requestPurpose.findMany({
      where: whereClause,
      orderBy: { name: 'asc' }
    });
    
    res.json(purposes);
  } catch (error) {
    console.error("Error fetching request purposes:", error);
    res.status(500).json({ error: "Failed to fetch request purposes" });
  }
};

/**
 * إنشاء غرض طلب جديد
 * POST /api/settings/request-purposes
 * Body: { type, name, nameEn, description, icon, color }
 */
const createRequestPurpose = async (req, res) => {
  try {
    const newPurpose = await prisma.requestPurpose.create({
      data: req.body,
    });
    res.status(201).json(newPurpose);
  } catch (error) {
    console.error("Error creating request purpose:", error);
    // معالجة خطأ التكرار (لأننا أضفنا @@unique([type, name]))
    if (error.code === 'P2002') {
      return res.status(409).json({ error: "A purpose with this name and type already exists." });
    }
    res.status(500).json({ error: "Failed to create request purpose" });
  }
};

/**
 * تعديل غرض طلب موجود
 * PUT /api/settings/request-purposes/:id
 * Body: { name, nameEn, description, icon, color, isActive }
 */
const updateRequestPurpose = async (req, res) => {
  const { id } = req.params;
  
  try {
    const updatedPurpose = await prisma.requestPurpose.update({
      where: { id: id },
      data: req.body,
    });
    res.json(updatedPurpose);
  } catch (error) {
    console.error("Error updating request purpose:", error);
    if (error.code === 'P2002') {
      return res.status(409).json({ error: "A purpose with this name and type already exists." });
    }
    res.status(500).json({ error: "Failed to update request purpose" });
  }
};

/**
 * حذف غرض طلب
 * DELETE /api/settings/request-purposes/:id
 */
const deleteRequestPurpose = async (req, res) => {
  const { id } = req.params;
  
  try {
    await prisma.requestPurpose.delete({
      where: { id: id },
    });
    res.status(204).send(); // 204 No Content (نجاح)
  } catch (error) {
    console.error("Error deleting request purpose:", error);
    res.status(500).json({ error: "Failed to delete request purpose" });
  }
};

/**
 * جلب تعريف النموذج وحقوله لغرض معين (لشاشة 701)
 * GET /api/settings/purposes/:purposeId/form
 */
const getFormDefinition = async (req, res) => {
  const { purposeId } = req.params;
  try {
    let form = await prisma.dynamicFormDefinition.findUnique({
      where: { purposeId: purposeId },
      include: {
        fields: {
          orderBy: { order: 'asc' },
        },
      },
    });

    // إذا لم يكن هناك نموذج، قم بإنشاء واحد تلقائياً لهذا الغرض
    if (!form) {
      const purpose = await prisma.requestPurpose.findUnique({ where: { id: purposeId } });
      if (!purpose) {
        return res.status(404).json({ error: "Purpose not found." });
      }
      
      form = await prisma.dynamicFormDefinition.create({
        data: {
          name: `form_for_${purpose.nameEn.toLowerCase().replace(' ', '_')}`,
          purposeId: purposeId,
        },
        include: { fields: true },
      });
    }
    
    res.json(form);
  } catch (error) {
    console.error("Error fetching form definition:", error);
    res.status(500).json({ error: "Failed to fetch form definition" });
  }
};

/**
 * إنشاء حقل جديد داخل نموذج
 * POST /api/settings/forms/:formId/fields
 * Body: { label, fieldKey, fieldType, order, ... }
 */
const createFormField = async (req, res) => {
  const { formId } = req.params;
  try {
    const newField = await prisma.dynamicFormField.create({
      data: {
        ...req.body,
        formId: formId,
      },
    });
    res.status(201).json(newField);
  } catch (error) {
    console.error("Error creating form field:", error);
    if (error.code === 'P2002') {
      return res.status(409).json({ error: "A field with this 'fieldKey' already exists in this form." });
    }
    res.status(500).json({ error: "Failed to create form field" });
  }
};

/**
 * تعديل حقل موجود
 * PUT /api/settings/fields/:fieldId
 * Body: { label, fieldKey, fieldType, order, ... }
 */
const updateFormField = async (req, res) => {
  const { fieldId } = req.params;
  try {
    const updatedField = await prisma.dynamicFormField.update({
      where: { id: fieldId },
      data: req.body,
    });
    res.json(updatedField);
  } catch (error) {
    console.error("Error updating form field:", error);
    res.status(500).json({ error: "Failed to update form field" });
  }
};

/**
 * حذف حقل
 * DELETE /api/settings/fields/:fieldId
 */
const deleteFormField = async (req, res) => {
  const { fieldId } = req.params;
  try {
    await prisma.dynamicFormField.delete({
      where: { id: fieldId },
    });
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting form field:", error);
    res.status(500).json({ error: "Failed to delete form field" });
  }
};

/**
 * جلب تعريف النموذج للعرض (لشاشات 284/286)
 * GET /api/forms/:purposeId/render
 */
const getFormForRender = async (req, res) => {
  const { purposeId } = req.params;
  try {
    const form = await prisma.dynamicFormDefinition.findFirst({
      where: { 
        purposeId: purposeId,
        purpose: {
          isActive: true // تأكد أن الغرض نفسه نشط
        }
      },
      include: {
        fields: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!form) {
      return res.status(404).json({ error: "Active form not found for this purpose." });
    }
    
    res.json(form.fields); // نرسل الحقول فقط للعرض
  } catch (error) {
    console.error("Error fetching form for render:", error);
    res.status(500).json({ error: "Failed to fetch form" });
  }
};


module.exports = {
  getSystemSettings,
  getRequestPurposes,
  createRequestPurpose,
  updateRequestPurpose,
  deleteRequestPurpose,
  getFormDefinition,
  createFormField,
  updateFormField,
  deleteFormField,
  getFormForRender,
};
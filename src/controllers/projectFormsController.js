const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

// تهيئة الذكاء الاصطناعي
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ==========================================
// 1. تحليل النموذج بالذكاء الاصطناعي (AI Extraction)
// ==========================================
const analyzeFormWithAI = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({
        success: false,
        message: "الرجاء إرفاق نموذج (صورة أو PDF) للتحليل",
      });

    const fileBuffer = fs.readFileSync(req.file.path);
    const documentPart = {
      inlineData: {
        data: fileBuffer.toString("base64"),
        mimeType: req.file.mimetype,
      },
    };

    // Prompt مخصص لاستخراج بيانات النماذج بناءً على الملف الوصفي
    const prompt = `
      أنت مهندس وإداري خبير في المكتب الهندسي. قم بتحليل هذا النموذج (استمارة، طلب، تعهد، إلخ).
      استخرج البيانات التالية بصيغة JSON فقط بدون أي نص إضافي:
      {
        "name": "اسم النموذج بوضوح",
        "formType": "طلب/إقرار/تعهد/تفويض/نموذج فحص/أخرى",
        "officialStatus": "OFFICIAL (إذا كان من جهة حكومية أو شركة خدمات) أو UNOFFICIAL (غير رسمي) أو INTERNAL (داخلي للمكتب)",
        "issuerName": "اسم الجهة المصدرة للنموذج (مثل أمانة الرياض، بلدي، الدفاع المدني) أو null",
        "targetMainCategories": ["إصدار", "تعديل", "تصحيح وضع"] (توقع نوع المعاملة المناسبة له),
        "targetUsages": ["سكني", "تجاري"] (الاستخدامات المناسبة),
        "hasExpiry": true/false (هل يبدو أن له تاريخ صلاحية؟)
      }
    `;

    // 💡 مصفوفة النماذج الاحتياطية (Fallback Models)
    const fallbackModels = [
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ];

    let response = null;

    // محاولة الاتصال بالنماذج تباعاً
    for (const modelName of fallbackModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: [prompt, documentPart],
          config: { temperature: 0.0, responseMimeType: "application/json" },
        });
        break; // الخروج من الحلقة عند نجاح الاتصال
      } catch (error) {
        console.warn(
          `فشل الاتصال بالموديل ${modelName}، جاري تجربة الموديل التالي...`,
        );
        // الانتظار ثانية واحدة قبل تجربة النموذج التالي لتجنب حظر الـ API
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!response)
      throw new Error("فشل الاتصال بجميع نماذج الذكاء الاصطناعي المتاحة.");

    // تنظيف الأرقام إن كانت عربية/هندية لضمان سلامة الـ JSON
    let cleanedContent = response.text.replace(/[٠-٩]/g, (d) =>
      "٠١٢٣٤٥٦٧٨٩".indexOf(d),
    );
    const parsedData = JSON.parse(cleanedContent);

    // تنظيف الملف المؤقت
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("AI Form Analysis Error:", error);
    // تأكد من تنظيف الملف المؤقت حتى في حالة الفشل
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({
      success: false,
      message: "فشل تحليل النموذج",
      details: error.message,
    });
  }
};

// ==========================================
// 2. إنشاء نموذج جديد (مع النسخة الأولى)
// ==========================================
const createFormTemplate = async (req, res) => {
  try {
    const data = req.body;
    const userId = req.user?.id || "النظام";

    // 1. توليد كود النموذج (مثال: FRM-2026-0001)
    const year = new Date().getFullYear();
    const count = await prisma.projectFormTemplate.count();
    const formCode = `FRM-${year}-${String(count + 1).padStart(4, "0")}`;

    // 2. معالجة المصفوفات المرسلة من الـ Frontend
    const parseArray = (str) => {
      try {
        return JSON.parse(str || "[]");
      } catch {
        return [];
      }
    };

    // 3. إنشاء النموذج مع نسخته الأولى (Nested Create)
    const newForm = await prisma.projectFormTemplate.create({
      data: {
        formCode,
        name: data.name,
        description: data.description,
        formType: data.formType,
        officialStatus: data.officialStatus || "UNSPECIFIED",
        issuerName: data.issuerName,
        sourceDescription: data.sourceDescription,
        sourceUrl: data.sourceUrl,
        hasExpiry: data.hasExpiry === "true" || data.hasExpiry === true,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        status: data.status || "NEW",

        targetMainCategories: parseArray(data.targetMainCategories),
        targetSubCategories: parseArray(data.targetSubCategories),
        targetUsages: parseArray(data.targetUsages),
        targetDistricts: parseArray(data.targetDistricts),

        aiAnalysisData: data.aiAnalysisData
          ? JSON.parse(data.aiAnalysisData)
          : null,
        addedBy: userId,

        // إنشاء النسخة الأولى من الملف المرتبط بهذا النموذج
        versions: {
          create: req.files.map((file) => ({
            versionNumber: data.versionNumber || "V1.0",
            issueDate: data.issueDate ? new Date(data.issueDate) : null,
            isCurrent: true,
            originalName: file.originalname,
            fileUrl: `/uploads/project-forms/${file.filename}`,
            extension: path
              .extname(file.originalname)
              .substring(1)
              .toUpperCase(),
            fileSize: file.size,
            uploadedBy: userId,
          })),
        },
      },
      include: { versions: true },
    });

    res
      .status(201)
      .json({ success: true, message: "تم حفظ النموذج بنجاح", data: newForm });
  } catch (error) {
    console.error("Create Form Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. جلب قائمة النماذج (لشاشة الجدول)
// ==========================================
const getForms = async (req, res) => {
  try {
    const { search, officialStatus, status } = req.query;

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { formCode: { contains: search } },
        { issuerName: { contains: search } },
      ];
    }
    if (officialStatus) where.officialStatus = officialStatus;
    if (status) where.status = status;

    const forms = await prisma.projectFormTemplate.findMany({
      where,
      include: {
        versions: { where: { isCurrent: true } }, // جلب بيانات الملف الحالي فقط للجدول
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: forms });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 4. رفع إصدار جديد (تحديث نموذج بملف جديد)
// ==========================================
const addNewFormVersion = async (req, res) => {
  try {
    const { id } = req.params; // ID الـ FormTemplate
    const data = req.body;
    const userId = req.user?.id || "النظام";

    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "الرجاء إرفاق ملف النسخة الجديدة" });

    // 1. جعل جميع النسخ السابقة غير حالية
    await prisma.projectFormVersion.updateMany({
      where: { formId: id },
      data: { isCurrent: false },
    });

    // 2. إنشاء النسخة الجديدة
    const newVersion = await prisma.projectFormVersion.create({
      data: {
        formId: id,
        versionNumber: data.versionNumber || "New Version",
        issueDate: data.issueDate ? new Date(data.issueDate) : null,
        isCurrent: true,
        changeReason: data.changeReason,
        originalName: req.file.originalname,
        fileUrl: `/uploads/project-forms/${req.file.filename}`,
        extension: path
          .extname(req.file.originalname)
          .substring(1)
          .toUpperCase(),
        fileSize: req.file.size,
        uploadedBy: userId,
      },
    });

    res.json({
      success: true,
      message: "تم إصدار نسخة جديدة بنجاح",
      data: newVersion,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 5. تسجيل حركة استخدام (Log Usage & Download)
// ==========================================
const logFormUsage = async (req, res) => {
  try {
    const { id } = req.params;
    const { actionType, transactionId, versionId } = req.body;
    const userId = req.user?.id || "النظام";

    // 1. تسجيل الحركة في اللوج
    await prisma.projectFormUsageLog.create({
      data: {
        formId: id,
        versionId: versionId,
        actionType, // DOWNLOAD, ATTACH_TO_TRANSACTION, etc.
        userId,
        transactionId,
      },
    });

    // 2. زيادة العداد في الجدول الرئيسي
    const updateField =
      actionType === "DOWNLOAD"
        ? { downloadCount: { increment: 1 } }
        : { usageCount: { increment: 1 } };

    await prisma.projectFormTemplate.update({
      where: { id },
      data: updateField,
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 6. جلب تفاصيل نموذج واحد بالـ ID
// ==========================================
const getFormById = async (req, res) => {
  try {
    const { id } = req.params;

    const form = await prisma.projectFormTemplate.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { createdAt: "desc" } }, // جلب جميع النسخ، الأحدث أولاً
        usageLogs: { orderBy: { createdAt: "desc" }, take: 10 }, // جلب آخر 10 حركات استخدام
        attachments: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!form)
      return res
        .status(404)
        .json({ success: false, message: "النموذج غير موجود" });

    res.json({ success: true, data: form });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 7. تحديث بيانات النموذج (Edit)
// ==========================================
const updateFormTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    // بما أن الفرونت إند يرسل البيانات كـ JSON، نتأكد من معالجة المصفوفات
    const targetMainCategories = Array.isArray(data.targetMainCategories)
      ? data.targetMainCategories
      : [];
    const targetUsages = Array.isArray(data.targetUsages)
      ? data.targetUsages
      : [];

    const updatedForm = await prisma.projectFormTemplate.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        formType: data.formType,
        officialStatus: data.officialStatus,
        issuerName: data.issuerName,
        hasExpiry: data.hasExpiry === "true" || data.hasExpiry === true,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        targetMainCategories,
        targetUsages,
      },
    });

    res.json({
      success: true,
      message: "تم تحديث البيانات بنجاح",
      data: updatedForm,
    });
  } catch (error) {
    console.error("Update Form Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 8. حذف النموذج نهائياً (مع ملفاته الفعلية)
// ==========================================
const deleteFormTemplate = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. جلب النموذج أولاً لمعرفة مسارات الملفات المخزنة في السيرفر لحذفها
    const form = await prisma.projectFormTemplate.findUnique({
      where: { id },
      include: { versions: true },
    });

    if (!form)
      return res
        .status(404)
        .json({ success: false, message: "النموذج غير موجود" });

    // 2. حذف الملفات الفعلية من مجلد uploads
    if (form.versions && form.versions.length > 0) {
      form.versions.forEach((version) => {
        // fileUrl يكون بالشكل: /uploads/project-forms/filename.pdf
        const filePath = path.join(__dirname, "..", version.fileUrl);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }

    // 3. حذف السجل من قاعدة البيانات (الحذف المتتالي Cascade سيحذف الإصدارات وسجل الاستخدام تلقائياً)
    await prisma.projectFormTemplate.delete({ where: { id } });

    res.json({ success: true, message: "تم حذف النموذج وملفاته بنجاح" });
  } catch (error) {
    console.error("Delete Form Error:", error);
    res.status(500).json({
      success: false,
      message: "لا يمكن حذف هذا النموذج، قد يكون مرتبطاً ببيانات أخرى",
    });
  }
};

// ==========================================
// 9. إضافة مرفق داعم للنموذج
// ==========================================
const uploadAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || "النظام";

    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "الرجاء رفع ملف" });

    const newAttachment = await prisma.projectFormAttachment.create({
      data: {
        formId: id,
        attachmentType: req.body.attachmentType || "SUPPORTING_DOC",
        originalName: req.file.originalname,
        fileUrl: `/uploads/project-forms/${req.file.filename}`,
        addedBy: userId,
      },
    });

    res.json({ success: true, data: newAttachment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 10. حذف مرفق داعم
// ==========================================
const deleteAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;

    const attachment = await prisma.projectFormAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment)
      return res
        .status(404)
        .json({ success: false, message: "المرفق غير موجود" });

    // حذف الملف الفعلي
    const filePath = path.join(__dirname, "..", attachment.fileUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // حذف من الداتا بيز
    await prisma.projectFormAttachment.delete({ where: { id: attachmentId } });

    res.json({ success: true, message: "تم حذف المرفق" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 تأكد من تحديث التصدير في نهاية الملف:
module.exports = {
  analyzeFormWithAI,
  createFormTemplate,
  getForms,
  addNewFormVersion,
  logFormUsage,
  getFormById, // 👈 جديد
  updateFormTemplate, // 👈 جديد
  deleteFormTemplate, // 👈 جديد
  uploadAttachment,
  deleteAttachment,
};

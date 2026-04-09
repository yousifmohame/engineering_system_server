const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");
const { z } = require("zod");

const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 💡 Zod Schema (شملنا جميع الحقول الجديدة)
const ReferenceAISchema = z.object({
  summary: z.string().catch("لم يتم توليد ملخص."),
  keyRules: z.array(z.string()).catch([]),
  targetAudience: z.string().catch("غير محدد"),

  txType: z.string().nullable().catch(null),
  txMainCategory: z.string().nullable().catch(null),
  txSubCategory: z.string().nullable().catch(null),

  buildingTypes: z.array(z.string()).catch([]),
  landAreaFrom: z.number().nullable().catch(null),
  landAreaTo: z.number().nullable().catch(null),

  city: z.string().nullable().catch(null),
  sector: z.string().nullable().catch(null),
  districts: z.array(z.string()).catch([]),

  floorsFrom: z.number().nullable().catch(null),
  floorsTo: z.number().nullable().catch(null),
  streetWidthFrom: z.number().nullable().catch(null),
  streetWidthTo: z.number().nullable().catch(null),
});

const addLog = async (referenceId, action, req) => {
  const userName = req.body?.userName || req.user?.name || "مستخدم غير معروف";
  const userEmail = req.body?.userEmail || req.user?.email || "";
  await prisma.referenceLog.create({
    data: { referenceId, action, userName, userEmail },
  });
};

const analyzeReferenceBackground = async (
  documentId,
  filePath,
  mimeType,
  analysisType = "full",
) => {
  try {
    console.log(`🚀 بدء تحليل المرجع [${documentId}] بواسطة Gemini...`);

    if (!fs.existsSync(filePath)) throw new Error("الملف الفيزيائي غير موجود");
    const fileBuffer = fs.readFileSync(filePath);
    const documentPart = {
      inlineData: {
        data: fileBuffer.toString("base64"),
        mimeType: mimeType || "application/pdf",
      },
    };

    let promptInstruction =
      analysisType === "quick"
        ? `قم بعمل تلخيص "سريع ومختصر جداً" للمستند واستخراج محددات الانطباق الممكنة.`
        : `قم بـ "تحليل شامل ودقيق" للمستند واستخراج كافة محددات الانطباق بدقة.`;

    const prompt = `
    أنت خبير في الأنظمة البلدية وكود البناء السعودي.
    استخرج البيانات بصيغة JSON حصرياً المطابقة للتركيبة التالية:
    ${promptInstruction}
    {
      "summary": "ملخص واضح ومبسط يشرح الغرض من هذا المستند",
      "keyRules": ["أهم الاشتراطات"],
      "targetAudience": "المستهدفون بهذا المستند",
      "txType": "إصدار رخصة بناء، تعديل رخصة بناء، أو null",
      "txMainCategory": "مستندات معاملات، مخططات، أو null",
      "txSubCategory": "مخططات معمارية، تقارير هندسية، أو null",
      "buildingTypes": ["سكني", "تجاري", ...],
      "landAreaFrom": الحد الأدنى لمساحة الأرض أو null,
      "landAreaTo": الحد الأقصى لمساحة الأرض أو null,
      "city": "المدينة المذكورة أو null",
      "sector": "شمال، جنوب، وسط... أو null",
      "districts": ["الصحافة", "الملقا"...],
      "floorsFrom": الحد الأدنى لعدد الأدوار أو null,
      "floorsTo": الحد الأقصى لعدد الأدوار أو null,
      "streetWidthFrom": الحد الأدنى لعرض الشارع أو null,
      "streetWidthTo": الحد الأقصى لعرض الشارع أو null
    }`;

    const fallbackModels = [
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
    ];
    let response = null;

    for (const modelName of fallbackModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: [prompt, documentPart],
          config: { temperature: 0.0, responseMimeType: "application/json" },
        });
        break;
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!response) throw new Error("جميع نماذج الذكاء الاصطناعي مشغولة.");

    const parsedData = JSON.parse(response.text);
    const validatedData = ReferenceAISchema.parse(parsedData);
    const finalSummaryText = `📌 الملخص:\n${validatedData.summary}\n\n⚠️ أهم الاشتراطات:\n- ${validatedData.keyRules.join("\n- ")}\n\n🎯 المستهدفون: ${validatedData.targetAudience}`;

    // تحديث البيانات التي تم استخراجها فقط لعدم حذف بيانات أدخلها المستخدم يدوياً
    const updateData = { analysisStatus: "محلل", aiSummary: finalSummaryText };
    if (validatedData.txType) updateData.txType = validatedData.txType;
    if (validatedData.txMainCategory)
      updateData.txMainCategory = validatedData.txMainCategory;
    if (validatedData.txSubCategory)
      updateData.txSubCategory = validatedData.txSubCategory;
    if (validatedData.buildingTypes.length)
      updateData.buildingTypes = validatedData.buildingTypes;
    if (validatedData.landAreaFrom !== null)
      updateData.landAreaFrom = validatedData.landAreaFrom;
    if (validatedData.landAreaTo !== null)
      updateData.landAreaTo = validatedData.landAreaTo;
    if (validatedData.city) updateData.city = validatedData.city;
    if (validatedData.sector) updateData.sector = validatedData.sector;
    if (validatedData.districts.length)
      updateData.districts = validatedData.districts;
    if (validatedData.floorsFrom !== null)
      updateData.floorsFrom = validatedData.floorsFrom;
    if (validatedData.floorsTo !== null)
      updateData.floorsTo = validatedData.floorsTo;
    if (validatedData.streetWidthFrom !== null)
      updateData.streetWidthFrom = validatedData.streetWidthFrom;
    if (validatedData.streetWidthTo !== null)
      updateData.streetWidthTo = validatedData.streetWidthTo;

    await prisma.referenceDocument.update({
      where: { id: documentId },
      data: updateData,
    });
    console.log(`✅ تمت أرشفة تحليل المرجع [${documentId}] بنجاح.`);
  } catch (error) {
    console.error(`🔥 خطأ في التحليل:`, error.message);
    await prisma.referenceDocument.update({
      where: { id: documentId },
      data: { analysisStatus: "يحتاج مراجعة" },
    });
  }
};

exports.getReferences = async (req, res) => {
  try {
    const references = await prisma.referenceDocument.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: references });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createReference = async (req, res) => {
  try {
    const {
      title,
      source,
      category,
      type,
      city,
      sector,
      txType,
      txMainCategory,
      txSubCategory,
      issueDate,
      expiryDate,
      autoAnalyze,
    } = req.body;

    const buildingTypes = req.body.buildingTypes
      ? JSON.parse(req.body.buildingTypes)
      : [];
    const districts = req.body.districts ? JSON.parse(req.body.districts) : [];

    const landAreaFrom = req.body.landAreaFrom
      ? parseFloat(req.body.landAreaFrom)
      : null;
    const landAreaTo = req.body.landAreaTo
      ? parseFloat(req.body.landAreaTo)
      : null;
    const floorsFrom = req.body.floorsFrom
      ? parseInt(req.body.floorsFrom)
      : null;
    const floorsTo = req.body.floorsTo ? parseInt(req.body.floorsTo) : null;
    const streetWidthFrom = req.body.streetWidthFrom
      ? parseInt(req.body.streetWidthFrom)
      : null;
    const streetWidthTo = req.body.streetWidthTo
      ? parseInt(req.body.streetWidthTo)
      : null;

    let fileUrl = null;
    let absoluteFilePath = null;
    let mimeType = null;
    if (req.file) {
      fileUrl = `/uploads/references/${req.file.filename}`;
      absoluteFilePath = path.join(
        __dirname,
        "..",
        "uploads",
        "references",
        req.file.filename,
      );
      mimeType = req.file.mimetype;
    }

    const newRef = await prisma.referenceDocument.create({
      data: {
        title,
        source,
        category,
        type,
        city,
        sector,
        txType,
        txMainCategory,
        txSubCategory,
        buildingTypes,
        districts,
        landAreaFrom,
        landAreaTo,
        floorsFrom,
        floorsTo,
        streetWidthFrom,
        streetWidthTo,
        issueDate: issueDate ? new Date(issueDate) : null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        fileUrl,
        analysisStatus:
          autoAnalyze === "true" && absoluteFilePath
            ? "قيد التحليل"
            : "غير محلل",
      },
    });

    if (autoAnalyze === "true" && absoluteFilePath) {
      analyzeReferenceBackground(newRef.id, absoluteFilePath, mimeType, "full");
    }

    req.body.userName = req.user?.name;
    await addLog(newRef.id, "إضافة مرجع جديد للمكتبة", req);

    res.status(201).json({ success: true, data: newRef });
  } catch (error) {
    console.error("Create Reference Error:", error);
    res.status(500).json({ success: false, message: "فشل حفظ المرجع" });
  }
};

exports.updateManualNotes = async (req, res) => {
  try {
    const { id } = req.params;
    const { manualNotes } = req.body;
    await prisma.referenceDocument.update({
      where: { id },
      data: { manualNotes },
    });
    await addLog(id, "تم تحديث توجيهات وملاحظات الإدارة", req);
    res.json({ success: true, message: "تم الحفظ بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteReference = async (req, res) => {
  try {
    const { id } = req.params;
    const ref = await prisma.referenceDocument.findUnique({ where: { id } });
    if (ref && ref.fileUrl) {
      const filename = ref.fileUrl.split("/").pop();
      const filePath = path.join(
        __dirname,
        "..",
        "uploads",
        "references",
        filename,
      );
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await prisma.referenceDocument.delete({ where: { id } });
    res.json({ success: true, message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getReferenceLogs = async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await prisma.referenceLog.findMany({
      where: { referenceId: id },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.reanalyzeReference = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body;
    const doc = await prisma.referenceDocument.findUnique({ where: { id } });
    if (!doc || !doc.fileUrl)
      return res
        .status(400)
        .json({ success: false, message: "الملف غير موجود للتحليل" });

    await addLog(
      id,
      type === "quick"
        ? "طلب تلخيص سريع للمستند"
        : "طلب إعادة التحليل الذكي الشامل",
      req,
    );
    await prisma.referenceDocument.update({
      where: { id },
      data: { analysisStatus: "قيد التحليل" },
    });

    const filename = doc.fileUrl.split("/").pop();
    const absoluteFilePath = path.join(
      __dirname,
      "..",
      "uploads",
      "references",
      filename,
    );

    analyzeReferenceBackground(id, absoluteFilePath, "application/pdf", type);
    res.json({ success: true, message: "بدأت عملية التحليل في الخلفية" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

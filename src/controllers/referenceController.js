const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");
const { z } = require("zod");

// استخدام مكتبة @google/genai
const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 💡 Zod Schema للتحقق من البيانات المستخرجة (بما فيها البروتوكولات الجديدة)
const ReferenceAISchema = z.object({
  summary: z.string().catch("لم يتم توليد ملخص."),
  keyRules: z.array(z.string()).catch([]),
  targetAudience: z.string().catch("غير محدد"),
  windProtocol: z.string().nullable().catch(null),
  monitoringProtocol: z.string().nullable().catch(null),
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

/**
 * 🚀 دالة التحليل في الخلفية (تدعم الملفات المتعددة للمرجع الواحد)
 */
const analyzeReferenceBackground = async (
  documentId,
  filePathsArray,
  mimeTypesArray,
  analysisType = "full",
) => {
  let uploadedCloudFiles = [];
  try {
    console.log(
      `🚀 بدء الرفع السحابي المتعدد للمرجع [${documentId}]... عدد الملفات: ${filePathsArray.length}`,
    );

    // 1. رفع جميع الملفات إلى سحابة Google AI
    for (let i = 0; i < filePathsArray.length; i++) {
      const filePath = filePathsArray[i];
      if (fs.existsSync(filePath)) {
        const uploadedFile = await ai.files.upload({
          file: filePath,
          config: {
            mimeType: mimeTypesArray[i] || "application/pdf",
            displayName: `Ref_${documentId}_part${i + 1}`,
          },
        });
        uploadedCloudFiles.push(uploadedFile);
        console.log(`📤 تم الرفع: ${uploadedFile.name}`);
      }
    }

    if (uploadedCloudFiles.length === 0)
      throw new Error("لم يتم العثور على ملفات صالحة للتحليل.");

    // 2. انتظار المعالجة لجميع الملفات (Polling)
    console.log(`⏳ جاري معالجة الملفات في خوادم Google...`);
    const activeFiles = [];
    for (const file of uploadedCloudFiles) {
      let currentFile = await ai.files.get({ name: file.name });
      while (currentFile.state === "PROCESSING") {
        process.stdout.write(".");
        await new Promise((resolve) => setTimeout(resolve, 4000));
        currentFile = await ai.files.get({ name: file.name });
      }
      if (currentFile.state !== "ACTIVE") {
        throw new Error(
          `فشلت معالجة الملف ${file.name}. الحالة: ${currentFile.state}`,
        );
      }
      activeFiles.push(currentFile);
    }

    console.log(`\n✅ الملفات نشطة الآن. جاري التحليل...`);

    // 3. تجهيز أجزاء الطلب (مجموعة الملفات + النص)
    const promptInstruction =
      analysisType === "quick"
        ? `قم بعمل تلخيص "سريع ومختصر جداً" للمستندات المرفقة واستخراج محددات الانطباق الممكنة.`
        : `قم بـ "تحليل شامل ودقيق" للمستندات المرفقة (والتي تعتبر أجزاء لمرجع واحد) واستخراج كافة البيانات بدقة.`;

    // 💡 طبقة الحماية الأولى: توجيه صارم للذكاء الاصطناعي
    const promptText = `
    أنت خبير في الأنظمة البلدية وكود البناء السعودي.
    استخرج البيانات بصيغة JSON حصرياً للمستندات المرفقة.
    ⚠️ هام جداً: جميع النصوص المستخرجة يجب أن تكون باللغة العربية الفصحى حصراً.
    ⚠️ هام جداً: يجب إرجاع كائن JSON واحد فقط (Single Object). لا تقم أبداً بإرجاع مصفوفة (Array).

    ${promptInstruction}
    {
      "summary": "ملخص شامل وواضح للغرض من المستندات",
      "keyRules": ["أهم الاشتراطات والقواعد الإلزامية"],
      "targetAudience": "المستهدفون",
      "windProtocol": "استخرج بروتوكول التشغيل وسرعة الرياح إن وجد، أو null",
      "monitoringProtocol": "استخرج بروتوكول الرصد والامتثال البيئي إن وجد، أو null",
      "txType": "إصدار رخصة بناء، تعديل رخصة بناء، أو null",
      "txMainCategory": "التصنيف الرئيسي أو null",
      "txSubCategory": "التصنيف الفرعي أو null",
      "buildingTypes": ["سكني", "تجاري"],
      "landAreaFrom": رقم أو null, "landAreaTo": رقم أو null,
      "city": "المدينة أو null", "sector": "المنطقة أو null", "districts": [],
      "floorsFrom": رقم أو null, "floorsTo": رقم أو null,
      "streetWidthFrom": رقم أو null, "streetWidthTo": رقم أو null
    }`;

    const parts = activeFiles.map((f) => ({
      fileData: { fileUri: f.uri, mimeType: f.mimeType },
    }));
    parts.push({ text: promptText });

    // 4. استدعاء الموديل (Fallback)
    const fallbackModels = [
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
    ];
    let responseText = null;
    let successfulModel = null;

    for (const modelName of fallbackModels) {
      try {
        console.log(`🔄 محاولة التحليل باستخدام الموديل: ${modelName}...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts: parts }],
          config: { temperature: 0.0, responseMimeType: "application/json" },
        });

        responseText = response.text;
        successfulModel = modelName;
        break;
      } catch (modelError) {
        console.warn(`⚠️ فشل الموديل ${modelName}:`, modelError.message);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (!responseText) throw new Error("جميع النماذج فشلت في معالجة المستند.");

    console.log(`✅ تم استخراج البيانات بنجاح بواسطة: ${successfulModel}`);

    let parsedData;
    try {
      // 💡 طبقة الحماية الثانية: تنظيف النص من علامات Markdown (```json ... ```)
      const cleanJson = responseText
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      parsedData = JSON.parse(cleanJson);

      // 💡 طبقة الحماية الثالثة: فك المصفوفات (Array Unwrapping)
      if (Array.isArray(parsedData)) {
        console.log(
          "⚠️ تم استلام مصفوفة من AI بالخطأ، جاري استخراج الكائن الأول...",
        );
        parsedData = parsedData[0]; // أخذ الكائن الأول من المصفوفة
      }
    } catch (parseError) {
      console.error(
        "🔥 فشل في تحويل استجابة AI إلى JSON صالحة:",
        parseError.message,
      );
      console.error("الاستجابة كانت:", responseText);
      throw new Error(
        "البيانات المسترجعة من الذكاء الاصطناعي ليست بتنسيق JSON صحيح.",
      );
    }

    // التحقق النهائي من صحة المتغيرات
    const validatedData = ReferenceAISchema.parse(parsedData);

    const finalSummaryText = `📌 الملخص:\n${validatedData.summary}\n\n🎯 المستهدفون: ${validatedData.targetAudience}`;

    // 5. تحديث قاعدة البيانات بجميع الحقول
    const updateData = {
      analysisStatus: "محلل",
      aiSummary: finalSummaryText,
      keyRules: validatedData.keyRules || [],
      windProtocol: validatedData.windProtocol || undefined,
      monitoringProtocol: validatedData.monitoringProtocol || undefined,
      txType: validatedData.txType || undefined,
      txMainCategory: validatedData.txMainCategory || undefined,
      txSubCategory: validatedData.txSubCategory || undefined,
      buildingTypes: validatedData.buildingTypes.length
        ? validatedData.buildingTypes
        : undefined,
      landAreaFrom: validatedData.landAreaFrom ?? undefined,
      landAreaTo: validatedData.landAreaTo ?? undefined,
      city: validatedData.city || undefined,
      sector: validatedData.sector || undefined,
      districts: validatedData.districts.length
        ? validatedData.districts
        : undefined,
      floorsFrom: validatedData.floorsFrom ?? undefined,
      floorsTo: validatedData.floorsTo ?? undefined,
      streetWidthFrom: validatedData.streetWidthFrom ?? undefined,
      streetWidthTo: validatedData.streetWidthTo ?? undefined,
    };

    await prisma.referenceDocument.update({
      where: { id: documentId },
      data: updateData,
    });

    console.log(`✅ تمت أرشفة تحليل المرجع [${documentId}] بنجاح.`);
  } catch (error) {
    console.error(`🔥 خطأ في التحليل الخلفي:`, error.message);
    await prisma.referenceDocument.update({
      where: { id: documentId },
      data: { analysisStatus: "يحتاج مراجعة" },
    });
  } finally {
    // 6. حذف جميع الملفات المرفوعة من السحابة لضمان الخصوصية وعدم استهلاك المساحة
    for (const file of uploadedCloudFiles) {
      try {
        await ai.files.delete({ name: file.name });
      } catch (err) {
        console.warn(`⚠️ لم يتم حذف الملف السحابي ${file.name}`);
      }
    }
    console.log(`🗑️ تم تنظيف الملفات السحابية.`);
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

    // 🚀 دعم الملفات المتعددة
    let fileUrls = [];
    let absoluteFilePaths = [];
    let mimeTypes = [];

    // التعامل مع رفع عدة ملفات عبر req.files أو ملف واحد عبر req.file
    const uploadedFiles =
      req.files && req.files.length > 0
        ? req.files
        : req.file
          ? [req.file]
          : [];

    uploadedFiles.forEach((file) => {
      fileUrls.push(`/uploads/references/${file.filename}`);
      absoluteFilePaths.push(
        path.join(
          __dirname,
          "..",
          "..",
          "uploads",
          "references",
          file.filename,
        ),
      );
      mimeTypes.push(file.mimetype);
    });

    const fileUrlString = fileUrls.length > 0 ? fileUrls.join(",") : null;

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
        fileUrl: fileUrlString,
        analysisStatus:
          autoAnalyze === "true" && absoluteFilePaths.length > 0
            ? "قيد التحليل"
            : "غير محلل",
      },
    });

    // إطلاق التحليل المباشر للملفات المتعددة
    if (autoAnalyze === "true" && absoluteFilePaths.length > 0) {
      analyzeReferenceBackground(
        newRef.id,
        absoluteFilePaths,
        mimeTypes,
        "full",
      );
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
      // التعامل مع حذف الملفات المتعددة المرتبطة بالمرجع
      const urls = ref.fileUrl.split(",");
      urls.forEach((url) => {
        const filename = url.split("/").pop();
        const filePath = path.join(
          __dirname,
          "..",
          "..",
          "uploads",
          "references",
          filename,
        );
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });
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

// دالة مساعدة للحصول على المسار الصحيح للملف
const getAbsoluteFilePath = (fileUrl) => {
  const filename = fileUrl.split("/").pop();
  const path1 = path.join(__dirname, "..", "..", "uploads", filename);
  const path2 = path.join(
    __dirname,
    "..",
    "..",
    "uploads",
    "references",
    filename,
  );

  if (fs.existsSync(path2)) return path2;
  if (fs.existsSync(path1)) return path1;
  return null;
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

    // 🚀 تجهيز مصفوفة الملفات للتحليل
    const fileUrls = doc.fileUrl.split(",");
    const absoluteFilePaths = [];
    const mimeTypes = [];

    for (const url of fileUrls) {
      const filepath = getAbsoluteFilePath(url);
      if (filepath) {
        absoluteFilePaths.push(filepath);
        const ext = path.extname(filepath).toLowerCase();
        let mType = "application/pdf";
        if (ext === ".png") mType = "image/png";
        else if (ext === ".jpg" || ext === ".jpeg") mType = "image/jpeg";
        else if (ext === ".webp") mType = "image/webp";
        mimeTypes.push(mType);
      }
    }

    if (absoluteFilePaths.length === 0) {
      return res.status(404).json({
        success: false,
        message: "الملفات الفيزيائية غير موجودة على السيرفر",
      });
    }

    // استدعاء دالة التحليل مع تمرير المصفوفات
    analyzeReferenceBackground(id, absoluteFilePaths, mimeTypes, type);

    res.json({ success: true, message: "بدأت عملية التحليل في الخلفية" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");
const { z } = require("zod");

// 💡 استيراد الـ SDK الجديد لـ Gemini
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ==========================================
// 💡 Zod Schema لتنظيف مخرجات AI للمراجع
// ==========================================
const ReferenceAISchema = z.object({
  summary: z.string().catch("لم يتم توليد ملخص."),
  keyRules: z.array(z.string()).catch([]),
  targetAudience: z.string().catch("غير محدد"),
});

// ==================================================
// 💡 (1) دالة مساعدة لتسجيل الأحداث (Logs) بذكاء
// ==================================================
const addLog = async (referenceId, action, req) => {
  // سحب البيانات إما من التوكن (إن وجد) أو من البودي المرسل من الـ Frontend
  const userName = req.body?.userName || req.user?.name || "مستخدم غير معروف";
  const userEmail = req.body?.userEmail || req.user?.email || "";

  await prisma.referenceLog.create({
    data: { referenceId, action, userName, userEmail },
  });
};

// ==================================================
// 💡 (2) دالة تعمل في الخلفية لتحليل المستند (Background Job)
// ==================================================
const analyzeReferenceBackground = async (
  documentId,
  filePath,
  mimeType,
  analysisType = "full",
) => {
  try {
    console.log(
      `🚀 بدء تحليل المرجع [${documentId}] بواسطة Gemini... (النوع: ${analysisType})`,
    );

    if (!fs.existsSync(filePath)) {
      throw new Error("الملف الفيزيائي غير موجود على السيرفر");
    }

    const fileBuffer = fs.readFileSync(filePath);

    const documentPart = {
      inlineData: {
        data: fileBuffer.toString("base64"),
        mimeType: mimeType || "application/pdf",
      },
    };

    // برومبت مخصص للتعاميم والأدلة الهندسية بناءً على نوع الطلب
    let promptInstruction = "";
    if (analysisType === "quick") {
      promptInstruction = `
      المطلوب منك عمل تلخيص "سريع ومختصر جداً" للمستند.
      {
        "summary": "ملخص من سطرين فقط",
        "keyRules": ["أهم قاعدة أو اثنتين فقط"],
        "targetAudience": "المستهدفون باختصار"
      }`;
    } else {
      promptInstruction = `
      المطلوب منك "تحليل شامل ودقيق" لهذا المستند المرجعي.
      {
        "summary": "ملخص واضح ومبسط من 3-4 أسطر يشرح الغرض من هذا المستند والتحديثات التي طرأت عليه",
        "keyRules": ["استخرج أهم 3 إلى 6 قواعد أو اشتراطات إلزامية، واذكر المعايير الرقمية كالارتدادات أو المساحات إن وجدت"],
        "targetAudience": "من المستهدف بهذا المستند؟ (مثال: المكاتب الهندسية، المقاولون، الملاك، الجهات الحكومية)"
      }`;
    }

    const prompt = `
    أنت مستشار ومهندس خبير في الأنظمة البلدية وكود البناء السعودي.
    أمامك مستند مرجعي. استخرج البيانات حصرياً بصيغة JSON المطابقة للتركيبة التالية:
    ${promptInstruction}
    لا تقم بإضافة أي نصوص خارج الـ JSON.
    `;

    const fallbackModels = [
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ];

    let response = null;

    for (const modelName of fallbackModels) {
      try {
        console.log(`🔄 جاري محاولة التحليل باستخدام: ${modelName}...`);
        response = await ai.models.generateContent({
          model: modelName,
          contents: [prompt, documentPart],
          config: {
            temperature: 0.0,
            responseMimeType: "application/json",
          },
        });
        console.log(`✅ نجح التحليل باستخدام: ${modelName}`);
        break;
      } catch (error) {
        console.warn(`⚠️ الموديل ${modelName} غير متاح. جاري التحويل...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!response) {
      throw new Error("جميع نماذج الذكاء الاصطناعي مشغولة حالياً.");
    }

    const responseText = response.text;
    const parsedData = JSON.parse(responseText);
    const validatedData = ReferenceAISchema.parse(parsedData);

    // دمج القواعد في نص واحد لتخزينه كملخص ذكي
    const finalSummaryText = `📌 الملخص:\n${validatedData.summary}\n\n⚠️ أهم الاشتراطات:\n- ${validatedData.keyRules.join("\n- ")}\n\n🎯 المستهدفون: ${validatedData.targetAudience}`;

    // تحديث السجل في الداتابيز ليصبح "محلل" ونحفظ الملخص
    await prisma.referenceDocument.update({
      where: { id: documentId },
      data: {
        analysisStatus: "محلل",
        aiSummary: finalSummaryText,
      },
    });

    console.log(`✅ تمت أرشفة تحليل المرجع [${documentId}] بنجاح.`);
  } catch (error) {
    console.error(
      `🔥 خطأ في تحليل المرجع بالخلفية [${documentId}]:`,
      error.message,
    );

    await prisma.referenceDocument.update({
      where: { id: documentId },
      data: { analysisStatus: "يحتاج مراجعة" },
    });
  }
};

// ==================================================
// 💡 (3) الكنترولرات الرئيسية (Controllers)
// ==================================================

// جلب جميع المراجع
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

// إنشاء مرجع جديد وإطلاق الـ AI
exports.createReference = async (req, res) => {
  try {
    const {
      title,
      source,
      category,
      type,
      city,
      issueDate,
      expiryDate,
      autoAnalyze,
    } = req.body;

    const transactionTypes = req.body.transactionTypes
      ? JSON.parse(req.body.transactionTypes)
      : [];
    const buildingTypes = req.body.buildingTypes
      ? JSON.parse(req.body.buildingTypes)
      : [];
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
      // حفظ المسار النسبي لقاعدة البيانات (ليعمل في الواجهة الأمامية)
      fileUrl = `/uploads/references/${req.file.filename}`;
      // حفظ المسار الحقيقي على السيرفر لتقرأه مكتبة fs للذكاء الاصطناعي
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
        issueDate: issueDate ? new Date(issueDate) : null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        transactionTypes,
        buildingTypes,
        floorsFrom,
        floorsTo,
        streetWidthFrom,
        streetWidthTo,
        fileUrl,
        analysisStatus:
          autoAnalyze === "true" && absoluteFilePath
            ? "قيد التحليل"
            : "غير محلل",
      },
    });

    // تشغيل تحليل الذكاء الاصطناعي في الخلفية
    if (autoAnalyze === "true" && absoluteFilePath) {
      analyzeReferenceBackground(newRef.id, absoluteFilePath, mimeType, "full");
    }

    res.status(201).json({ success: true, data: newRef });
  } catch (error) {
    console.error("Create Reference Error:", error);
    res.status(500).json({ success: false, message: "فشل حفظ المرجع" });
  }
};

// حفظ التوجيهات الإدارية (يدوي) وتسجيل الإجراء
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

// حذف المستند
exports.deleteReference = async (req, res) => {
  try {
    const { id } = req.params;
    const ref = await prisma.referenceDocument.findUnique({ where: { id } });

    if (ref && ref.fileUrl) {
      // 💡 إصلاح مسار الحذف: تحويل الرابط النسبي إلى مسار فيزيائي صحيح
      const filename = ref.fileUrl.split("/").pop(); // استخراج اسم الملف فقط
      const filePath = path.join(
        __dirname,
        "..",
        "uploads",
        "references",
        filename,
      );

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await prisma.referenceDocument.delete({ where: { id } });
    res.json({ success: true, message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// جلب سجل الأحداث (Logs) للمستند
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

// إعادة التحليل الذكي (يتم تشغيله في الخلفية)
exports.reanalyzeReference = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body; // type: "full" أو "quick"

    const doc = await prisma.referenceDocument.findUnique({ where: { id } });
    if (!doc || !doc.fileUrl) {
      return res
        .status(400)
        .json({ success: false, message: "الملف غير موجود للتحليل" });
    }

    const actionText =
      type === "quick"
        ? "طلب تلخيص سريع للمستند"
        : "طلب إعادة التحليل الذكي الشامل";
    await addLog(id, actionText, req);

    await prisma.referenceDocument.update({
      where: { id },
      data: { analysisStatus: "قيد التحليل" },
    });

    // 💡 إصلاح مسار القراءة للذكاء الاصطناعي
    const filename = doc.fileUrl.split("/").pop();
    const absoluteFilePath = path.join(
      __dirname,
      "..",
      "uploads",
      "references",
      filename,
    );

    // تشغيل التحليل في الخلفية وإرسال المعامل type
    analyzeReferenceBackground(id, absoluteFilePath, "application/pdf", type);

    res.json({ success: true, message: "بدأت عملية التحليل في الخلفية" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

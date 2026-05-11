// src/services/referenceAiService.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 💡 Zod Schema للتحقق من البيانات المستخرجة
const ReferenceAISchema = z.object({
  title: z.string().catch("مرجع بدون عنوان"),
  source: z.string().nullable().catch("غير محدد"),
  category: z.string().catch("أخرى"),
  type: z.string().catch("عام"),
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

/**
 * 🚀 دالة المعالجة التي سيستدعيها الـ Worker
 */
const processReferenceJob = async (jobData, updateProgress) => {
  const { filePathsArray, mimeTypesArray, dbJobId, existingDocumentId, analysisType = "full", savedAttachmentUrl } = jobData;
  let uploadedCloudFiles = [];

  try {
    await updateProgress(10);
    console.log(`🚀 بدء الرفع السحابي للمرجع... عدد الملفات: ${filePathsArray.length}`);

    // 1. رفع الملفات إلى سحابة Google AI
    for (let i = 0; i < filePathsArray.length; i++) {
      const filePath = filePathsArray[i];
      if (fs.existsSync(filePath)) {
        const uploadedFile = await ai.files.upload({
          file: filePath,
          config: {
            mimeType: mimeTypesArray[i] || "application/pdf",
            displayName: `Ref_Job_${dbJobId}_part${i + 1}`,
          },
        });
        uploadedCloudFiles.push(uploadedFile);
      }
    }

    if (uploadedCloudFiles.length === 0) throw new Error("لم يتم العثور على ملفات صالحة للتحليل.");

    await updateProgress(30);

    // 2. انتظار المعالجة في خوادم Google
    const activeFiles = [];
    for (const file of uploadedCloudFiles) {
      let currentFile = await ai.files.get({ name: file.name });
      while (currentFile.state === "PROCESSING") {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        currentFile = await ai.files.get({ name: file.name });
      }
      if (currentFile.state !== "ACTIVE") throw new Error(`فشلت معالجة الملف ${file.name}.`);
      activeFiles.push(currentFile);
    }

    await updateProgress(50);

    // 3. تجهيز أجزاء الطلب
    const promptInstruction = analysisType === "quick"
      ? `قم بعمل تلخيص "سريع ومختصر جداً" واستخراج محددات الانطباق.`
      : `قم بـ "تحليل شامل ودقيق" للمستندات المرفقة واستخراج كافة البيانات بدقة.`;

    const promptText = `
    أنت خبير في الأنظمة البلدية وكود البناء السعودي.
    استخرج البيانات بصيغة JSON حصرياً للمستندات المرفقة.
    ⚠️ هام جداً: جميع النصوص المستخرجة يجب أن تكون باللغة العربية الفصحى حصراً.
    ⚠️ هام جداً: يجب إرجاع كائن JSON واحد فقط (Single Object).
    
    استخرج بالإضافة للتفاصيل: 
    - "title": عنوان مناسب للمستند.
    - "source": الجهة المصدرة (مثل: أمانة منطقة الرياض، وزارة الشؤون البلدية).
    - "category": التصنيف (يجب أن يكون واحد من: "اشتراطات"، "أدلة"، "تعاميم"، "حالات خاصة واستثناءات").
    - "type": نوع المستند المكتوب.

    ${promptInstruction}
    {
      "title": "عنوان المرجع",
      "source": "الجهة المصدرة",
      "category": "تصنيف رئيسي",
      "type": "النوع",
      "summary": "ملخص شامل",
      "keyRules": ["القواعد الإلزامية"],
      "targetAudience": "المستهدفون",
      "windProtocol": null, "monitoringProtocol": null, "txType": null, "txMainCategory": null, "txSubCategory": null,
      "buildingTypes": [], "landAreaFrom": null, "landAreaTo": null, "city": null, "sector": null, "districts": [],
      "floorsFrom": null, "floorsTo": null, "streetWidthFrom": null, "streetWidthTo": null
    }`;

    const parts = activeFiles.map((f) => ({ fileData: { fileUri: f.uri, mimeType: f.mimeType } }));
    parts.push({ text: promptText });

    await updateProgress(65);

    // 4. استدعاء الموديل
    const fallbackModels = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-1.5-flash"];
    let responseText = null;

    for (const modelName of fallbackModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts: parts }],
          config: { temperature: 0.0, responseMimeType: "application/json" },
        });
        responseText = response.text;
        break;
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (!responseText) throw new Error("جميع النماذج فشلت في معالجة المستند.");

    await updateProgress(85);

    // 5. التنظيف والتحقق
    const cleanJson = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
    let parsedData = JSON.parse(cleanJson);
    if (Array.isArray(parsedData)) parsedData = parsedData[0];
    
    const validatedData = ReferenceAISchema.parse(parsedData);
    const finalSummaryText = `📌 الملخص:\n${validatedData.summary}\n\n🎯 المستهدفون: ${validatedData.targetAudience}`;

    const updateData = {
      title: validatedData.title,
      source: validatedData.source,
      category: validatedData.category,
      type: validatedData.type,
      analysisStatus: "محلل",
      aiSummary: finalSummaryText,
      keyRules: validatedData.keyRules || [],
      windProtocol: validatedData.windProtocol || undefined,
      monitoringProtocol: validatedData.monitoringProtocol || undefined,
      txType: validatedData.txType || undefined,
      txMainCategory: validatedData.txMainCategory || undefined,
      txSubCategory: validatedData.txSubCategory || undefined,
      buildingTypes: validatedData.buildingTypes.length ? validatedData.buildingTypes : undefined,
      landAreaFrom: validatedData.landAreaFrom ?? undefined,
      landAreaTo: validatedData.landAreaTo ?? undefined,
      city: validatedData.city || undefined,
      sector: validatedData.sector || undefined,
      districts: validatedData.districts.length ? validatedData.districts : undefined,
      floorsFrom: validatedData.floorsFrom ?? undefined,
      floorsTo: validatedData.floorsTo ?? undefined,
      streetWidthFrom: validatedData.streetWidthFrom ?? undefined,
      streetWidthTo: validatedData.streetWidthTo ?? undefined,
    };

    // 6. التحديث أو الإنشاء في الداتا بيز
    if (existingDocumentId) {
      // حالة التحديث أو إعادة التحليل
      await prisma.referenceDocument.update({
        where: { id: existingDocumentId },
        data: updateData,
      });
    } else {
      // 💡 حالة إنشاء مرجع جديد كلياً (من شاشة الرفع السريع)
      await prisma.referenceDocument.create({
        data: {
          ...updateData,
          fileUrl: savedAttachmentUrl, // ربط الملف
          status: "نشط",
        },
      });
    }

    await updateProgress(100);
    return { success: true };

  } catch (error) {
    if (existingDocumentId) {
      await prisma.referenceDocument.update({
        where: { id: existingDocumentId },
        data: { analysisStatus: "يحتاج مراجعة" },
      });
    }
    throw error;
  } finally {
    // تنظيف السحابة
    for (const file of uploadedCloudFiles) {
      try { await ai.files.delete({ name: file.name }); } catch (err) {}
    }
    // تنظيف الملفات المؤقتة إذا كانت مرفوعة حديثاً
    if (!existingDocumentId) {
      filePathsArray.forEach(fp => { if (fs.existsSync(fp)) fs.unlinkSync(fp); });
    }
  }
};

module.exports = { processReferenceJob };
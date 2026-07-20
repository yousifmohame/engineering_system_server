const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { decrypt } = require("../utils/cryptoUtils");
const {
  evaluateReadiness,
  logTimelineEvent,
} = require("../utils/studyHelpers");

const prisma = new PrismaClient();

// ============================================================================
// 🤖 دالة تحليل دفعة ملفات (معاملات تحت الدراسة) الاحترافية عبر طابور AI Worker
// ============================================================================
exports.processStudyService = async (jobData, updateProgress) => {
  const { studyRequestId, batchId, userId } = jobData;
  const uploadedGeminiFiles = [];
  let ai;

  try {
    // 1. تهيئة الذكاء الاصطناعي (Gemini)
    const systemSettings = await prisma.systemSettings.findUnique({
      where: { id: 1 },
    });
    const apiKey = systemSettings?.geminiApiKey
      ? decrypt(systemSettings.geminiApiKey)
      : process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey.trim() === "" || apiKey.includes("***")) {
      throw new Error("⚠️ مفتاح الذكاء الاصطناعي غير متوفر.");
    }

    ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 600000 } });

    // 2. جلب الطلب والملفات المراد تحليلها
    const studyRequest = await prisma.studyRequest.findUnique({
      where: { id: studyRequestId },
      include: { attachments: { where: { batchId: batchId } } },
    });

    if (
      !studyRequest ||
      !studyRequest.attachments ||
      studyRequest.attachments.length === 0
    ) {
      throw new Error("لا توجد ملفات في هذه الدفعة لتحليلها.");
    }

    const analyzableFiles = studyRequest.attachments.filter((file) => {
      const ext = file.extension.toLowerCase();
      return ["pdf", "png", "jpg", "jpeg", "webp"].includes(ext);
    });

    if (analyzableFiles.length === 0) {
      await prisma.studyAttachment.updateMany({
        where: { batchId: batchId },
        data: { aiAnalysisStatus: "FAILED", reviewStatus: "لا يدعم التحليل" },
      });
      throw new Error("الملفات المرفوعة غير مدعومة للتحليل البصري.");
    }

    await updateProgress(10);

    // 3. رفع الملفات إلى Gemini
    for (const file of analyzableFiles) {
      const filePath = path.join(__dirname, "../../", file.fileUrl);
      if (fs.existsSync(filePath)) {
        const uploadResult = await ai.files.upload({
          file: filePath,
          mimeType: file.mimeType || "application/pdf",
          displayName: file.id,
        });
        uploadedGeminiFiles.push({
          geminiFile: uploadResult,
          dbFileId: file.id,
        });
      }
    }

    await updateProgress(40);

    // 4. هندسة الأوامر الاحترافية (Enterprise Prompt Engineering)
    const SYSTEM_PROMPT = `
أنت مهندس استشاري وخبير أنظمة بلدية وعقارية في المملكة العربية السعودية، تعمل كنظام ذكاء اصطناعي رائد داخل مكتب هندسي.
الهدف: تحليل مستندات تم استلامها للتو من عميل واستخراج الحقول بدقة، مع تقديم نصائح ذكية للمهندسين ودعم اتخاذ القرار.

قم بتحليل المستندات المرفقة (أسماء الملفات تمثل المعرفات IDs)، وأرجع النتيجة بصيغة JSON حصرياً متوافق تماماً مع هذا الهيكل:
{
  "documents": [
    {
      "id": "معرف الملف",
      "suggestedCategory": "تصنيف المستند (صك ملكية، رخصة بناء، هوية، مخطط، محادثة واتساب، غير مصنف)",
      "confidence": 0.95,
      "extractedFields": {
        "ownerName": "اسم المالك أو الملاك",
        "deedNumber": "رقم الصك أو وثيقة التملك إن وجد",
        "deedDate": "تاريخ الصك",
        "permitNumber": "رقم رخصة البناء إن وجدت",
        "planNumber": "رقم المخطط",
        "plotNumber": "رقم القطعة أو القطع",
        "district": "اسم الحي",
        "city": "المدينة",
        "totalArea": "المساحة بالأرقام فقط",
        "propertyUsage": "نوع الاستخدام (سكني، تجاري، مختلط...)"
      }
    }
  ],
  "studyContext": {
    "clientRequest": "ما هو الطلب كما ورد من العميل؟",
    "suggestedMainCategory": "التصنيف الرئيسي المقترح (إصدار، تعديل، تجديد، تسوير، فرز، الخ)",
    "suggestedSubCategory": "الخدمة الدقيقة المقترحة",
    "missingDocs": ["مستندات ناقصة للبدء في هذا الإجراء. حددها بدقة بناء على الأنظمة السعودية"],
    "conflicts": [
      { "field": "الحقل (مثال: رقم القطعة)", "desc": "شرح التعارض (مثال: اختلاف المساحة بين الصك والرخصة)" }
    ],
    "smartSummary": "ملخص ذكي من 3 أسطر يوضح: الوضع الحالي، الطلب، العوائق إن وجدت."
  },
  "decisionSupport": {
    "complexityLevel": "حدد مستوى التعقيد: (بسيط، متوسط، معقد، عالي التعقيد)",
    "feasibilityLevel": "احتمالية النجاح/القابلية: (مرتفعة، متوسطة، ضعيفة)",
    "riskFactors": ["أي مخاطر أو قيود، مثل: وجود رهن، مساحة صغيرة، ارتدادات غير نظامية"],
    "engineerTips": ["نصيحة 1 للمهندس"، "نصيحة 2 للتعامل مع هذا الطلب بذكاء"]
  }
}
تأكد من إرجاع القيم بـ null إذا لم تكن موجودة. لا تضف أي نصوص خارج هيكل الـ JSON.
`;

    const fileParts = uploadedGeminiFiles.map((f) => ({
      fileData: { fileUri: f.geminiFile.uri, mimeType: f.geminiFile.mimeType },
    }));

    // 5. استدعاء النموذج
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [
        "حلل هذه الملفات واستخرج البيانات بدقة بصيغة JSON",
        ...fileParts,
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1, // حرارة منخفضة لضمان الدقة وتجنب الهلوسة
        responseMimeType: "application/json",
      },
    });

    await updateProgress(70);

    // 6. معالجة وتنظيف الـ JSON
    let responseText = response.text || "";
    responseText = responseText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const aiResult = JSON.parse(
      responseText.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)),
    );

    await updateProgress(85);

    // ====================================================================
    // 💾 7. حفظ النتائج وتحديث قاعدة البيانات
    // ====================================================================

    await prisma.$transaction(async (tx) => {
      // أ. حفظ لقطة التحليل
      await tx.studyAiAnalysisLog.create({
        data: {
          scope: `BATCH_${batchId}`,
          extractedData: aiResult,
          conflictsFound: aiResult.studyContext?.conflicts || [],
          studyRequestId: studyRequestId,
          requestedById: userId,
        },
      });

      // ب. تحديث المرفقات بالبيانات المستخرجة (extractedFields)
      if (aiResult.documents && Array.isArray(aiResult.documents)) {
        for (const doc of aiResult.documents) {
          // يمكن حفظ extractedFields في حقل ملاحظات المرفق أو حقل JSON مخصص
          const metaString = doc.extractedFields
            ? JSON.stringify(doc.extractedFields)
            : null;

          await tx.studyAttachment.updateMany({
            where: { id: doc.id, batchId: batchId },
            data: {
              aiSuggestedType: doc.suggestedCategory,
              aiConfidence: doc.confidence,
              aiAnalysisStatus: "COMPLETED",
              reviewStatus: "NEEDS_REVIEW",
              notes: metaString, // تم تخزين الحقول المستخرجة هنا للرجوع إليها
            },
          });
        }
      }

      // ج. تحديث سياق الطلب الأساسي ومؤشرات دعم اتخاذ القرار (File 10)
      const currentRequest = await tx.studyRequest.findUnique({
        where: { id: studyRequestId },
      });

      const oldMissing = Array.isArray(currentRequest.missingDocs)
        ? currentRequest.missingDocs
        : [];
      const newMissing = aiResult.studyContext?.missingDocs || [];
      const mergedMissing = [...new Set([...oldMissing, ...newMissing])];

      const updatedRequest = await tx.studyRequest.update({
        where: { id: studyRequestId },
        data: {
          suggestedMainCategory:
            currentRequest.suggestedMainCategory ||
            aiResult.studyContext?.suggestedMainCategory,
          suggestedSubCategory:
            currentRequest.suggestedSubCategory ||
            aiResult.studyContext?.suggestedSubCategory,
          aiSummary: aiResult.studyContext?.smartSummary,
          aiConflicts: aiResult.studyContext?.conflicts || [],
          missingDocs: mergedMissing,
          originalRequestText:
            currentRequest.originalRequestText ||
            aiResult.studyContext?.clientRequest,

          // 🚀 تحديث المؤشرات الذكية بناءً على تقييم الـ AI
          complexityLevel:
            aiResult.decisionSupport?.complexityLevel || "غير مقيم",
          feasibilityLevel:
            aiResult.decisionSupport?.feasibilityLevel || "غير مقيم",

          lastActivityAt: new Date(),
        },
      });

      // د. تحويل "نصائح المهندس" والمخاطر إلى "ملاحظة ذكية" لتظهر في الـ Timeline
      if (
        aiResult.decisionSupport?.engineerTips?.length > 0 ||
        aiResult.decisionSupport?.riskFactors?.length > 0
      ) {
        const tipsText = `💡 نصائح الذكاء الاصطناعي للمهندس:\n- ${aiResult.decisionSupport.engineerTips?.join("\n- ")}\n\n⚠️ عوامل الخطر:\n- ${aiResult.decisionSupport.riskFactors?.join("\n- ")}`;

        await tx.studyNote.create({
          data: {
            studyRequestId: studyRequestId,
            type: "AI_INSIGHT",
            text: tipsText,
            authorId: userId,
          },
        });
      }

      // هـ. إعادة احتساب الجاهزية
      const { readiness, completeness } = evaluateReadiness(updatedRequest);
      await tx.studyRequest.update({
        where: { id: studyRequestId },
        data: { readinessLevel: readiness, completenessLevel: completeness },
      });

      // و. تسجيل حدث في الـ Timeline
      await logTimelineEvent(
        studyRequestId,
        userId,
        "AI_RUN",
        "اكتمل التحليل المتقدم للدفعة",
        `تم استخراج البيانات، تقييم التعقيد (${aiResult.decisionSupport?.complexityLevel})، وتقديم نصائح للمهندس.`,
        "purple",
      );
    });

    await updateProgress(100);

    return {
      success: true,
      message: "تم التحليل المتقدم واستخراج الحقول بنجاح.",
    };
  } catch (error) {
    console.error("Study AI Processing Error:", error);

    await prisma.studyAttachment.updateMany({
      where: { batchId: batchId },
      data: { aiAnalysisStatus: "FAILED" },
    });

    await logTimelineEvent(
      studyRequestId,
      userId,
      "AI_RUN",
      "فشل التحليل الذكي",
      error.message,
      "red",
    );

    throw error;
  } finally {
    if (ai && uploadedGeminiFiles.length > 0) {
      for (const f of uploadedGeminiFiles) {
        try {
          await ai.files.delete({ name: f.geminiFile.name });
        } catch (e) {}
      }
    }
  }
};

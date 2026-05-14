// src/services/contractAiService.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 1. إعادة الصياغة (تبقى كما هي لترد على الواجهة فوراً)
exports.rephraseText = async (text, formality = "strict", length = "detailed") => {
  const prompt = `أنت خبير قانوني وهندسي سعودي. قم بإعادة صياغة النص التالي بأسلوب ${
    formality === "strict" ? "قانوني رصين" : "مهني واضح"
  } وبشكل ${length === "detailed" ? "مفصل" : "موجز"}:\n\n${text}`;

  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: { temperature: 0.3 }
  });
  return result.text.trim();
};

// 2. تقييم المخاطر (تعمل في الطابور)
exports.processRiskAssessment = async (jobData, updateProgress) => {
  const { contractId, contractData } = jobData;

  await updateProgress(20);

  const prompt = `أنت محامي سعودي خبير في عقود المقاولات والمكاتب الهندسية.
  حلل بيانات العقد التالي واكتشف 3 مخاطر قانونية أو مالية محتملة، واقترح بنداً واحداً للحماية لكل خطر:
  نطاق العمل والالتزامات: ${JSON.stringify(contractData.obligationsList)}
  قيمة العقد: ${contractData.contractValue}
  شروط الدفع: ${contractData.paymentTerms}`;

  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: { temperature: 0.2 }
  });

  await updateProgress(80);

  // تحديث العقد في الداتا بيز وإضافة نتيجة تقييم المخاطر
  await prisma.advancedContract.update({
    where: { id: contractId },
    data: { aiRiskAssessment: result.text.trim() }
  });

  await updateProgress(100);
  return { success: true, contractId };
};

// 3. توليد الملخص الذكي (تعمل في الطابور)
exports.processContractSummary = async (jobData, updateProgress) => {
  const { contractId, contractData } = jobData;

  await updateProgress(20);

  const prompt = `أنت مساعد قانوني ذكي.
  قم بتوليد ملخص شامل وواضح في فقرة واحدة (لا تتجاوز 100 كلمة) للعقد التالي، ليوضع في صفحة الغلاف:
  اسم العقد: ${contractData.name}
  الطرف الأول: ${contractData.partyA}
  الطرف الثاني: ${contractData.partyB}
  الالتزامات: ${JSON.stringify(contractData.obligationsList)}`;

  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: { temperature: 0.2 }
  });

  await updateProgress(80);

  // تحديث العقد في الداتا بيز وإضافة الملخص
  await prisma.advancedContract.update({
    where: { id: contractId },
    data: { aiSummary: result.text.trim() }
  });

  await updateProgress(100);
  return { success: true, contractId };
};
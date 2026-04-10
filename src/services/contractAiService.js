const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const contractAiService = {
  // 1. إعادة صياغة البنود
  async rephraseText(text, formality = "strict", length = "detailed") {
    const prompt = `أنت خبير قانوني وهندسي سعودي. قم بإعادة صياغة النص التالي بأسلوب ${
      formality === "strict" ? "قانوني رصين" : "مهني واضح"
    } وبشكل ${length === "detailed" ? "مفصل" : "موجز"}:\n\n${text}`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    return result.text;
  },

  // 2. تقييم مخاطر العقد
  async assessRisks(contractData) {
    const prompt = `حلل العقد التالي واكتشف 3 مخاطر محتملة واقترح بنداً واحداً للحماية:
الطرف الأول: ${contractData.partyADetails.representant}
نطاق العمل: ${JSON.stringify(contractData.obligationsList)}
القيمة: ${contractData.contractValue}`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    return result.text;
  },
};

module.exports = contractAiService;

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * دالة المطابقة الذكية بالذكاء الاصطناعي
 * تأخذ القيمة المستخرجة، وقائمة السجلات من الداتابيز، وتُرجع ID السجل المطابق
 */
const findBestMatchAI = async (targetValue, candidatesList, entityType) => {
  if (!targetValue || targetValue.trim() === "" || candidatesList.length === 0) {
    return null;
  }

  try {
    // 1. تجهيز قائمة المرشحين بطريقة مبسطة للذكاء الاصطناعي (ID + الاسم فقط)
    const simplifiedCandidates = candidatesList.map(c => ({
      id: c.id,
      name: c.name || c.nameAr || c.fullNameRaw || c.planNumber || c.deedNumber || "غير محدد"
    }));

    // 2. البرومبت الذكي للمطابقة
    const prompt = `
    أنت محرك مطابقة ذكي (Smart Matching Engine) لنظام هندسي في السعودية.
    مهمتك هي البحث عن أفضل تطابق للقيمة المستهدفة (Target) داخل قائمة السجلات (Candidates).
    
    نوع السجل: ${entityType}
    القيمة المستهدفة: "${targetValue}"
    
    قائمة السجلات المتاحة:
    ${JSON.stringify(simplifiedCandidates)}

    قواعد المطابقة 🚨:
    1. تجاهل الأخطاء الإملائية البسيطة (مثل الهاء والتاء المربوطة، الألف والهمزات).
    2. تجاهل الكلمات الزائدة مثل (حي، مخطط، مؤسسة، شركة، مكتب).
    3. في أرقام المخططات، (1/222) هي نفسها (222/1) وتعتبر تطابقاً تاماً.
    4. إذا وجدت تطابقاً بنسبة ثقة (Confidence) تفوق 80%، قم بإرجاع الـ id الخاص به.
    5. إذا لم تجد أي تطابق مقنع، أرجع null.

    أعد النتيجة حصرياً بصيغة JSON بالتنسيق التالي:
    {
      "matchedId": "ID السجل المطابق أو null",
      "confidence": نسبة الثقة من 0 إلى 1,
      "reason": "سبب المطابقة باختصار شديد"
    }
    `;

    // 3. الاتصال بنموذج gpt-4o-mini (سريع جداً ومثالي لهذه المهمة)
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.0, // نريد إجابة دقيقة ومنطقية
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    console.log(`🤖 AI Match [${entityType}]: "${targetValue}" => Matched ID: ${result.matchedId} (${Math.round(result.confidence * 100)}%)`);

    // إرجاع الـ ID فقط إذا كانت نسبة الثقة عالية
    return result.confidence >= 0.8 ? result.matchedId : null;

  } catch (error) {
    console.error(`🔥 AI Matching Error for ${targetValue}:`, error.message);
    return null; // في حال فشل الـ AI، نرجع null لكي لا يتوقف النظام
  }
};

module.exports = { findBestMatchAI };
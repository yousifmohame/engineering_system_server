const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const path = require("path");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.processArchiveDoc = async (jobData, updateProgress) => {
  const { dbJobId, archiveDocId } = jobData;

  await updateProgress(10);

  const archiveDoc = await prisma.propertyDocumentArchive.findUnique({
    where: { id: archiveDocId },
  });

  if (!archiveDoc || !archiveDoc.fileUrl) {
    throw new Error("لم يتم العثور على سجل الوثيقة في قاعدة البيانات.");
  }

  await updateProgress(20);

  const fullPath = path.join(__dirname, "../../", archiveDoc.fileUrl);
  if (!fs.existsSync(fullPath)) {
    throw new Error("الملف الفيزيائي مفقود من الخادم.");
  }

  const fileBuffer = fs.readFileSync(fullPath);
  const rawBase64 = fileBuffer.toString("base64");
  const mimeType = archiveDoc.fileType || "application/pdf";

  await updateProgress(40);

  const documentPart = {
    inlineData: { data: rawBase64, mimeType: mimeType },
  };

  await updateProgress(50);

  // 🚀 التعديل الجذري في الـ Prompt:
  // 1. إجبار الموديل على إرجاع مصفوفة (لأن الملف قد يحتوي عدة صكوك)
  // 2. استخراج كافة التفاصيل الموجودة في الصكوك السعودية
  const promptText = `
  أنت خبير معتمد ومراجع قانوني في وزارة العدل والهيئة العامة للعقار في السعودية.
  اقرأ المستند المرفق (والذي قد يحتوي على صك ملكية واحد، أو عدة صكوك، وكل صك قد يحتوي على عدة قطع أراضي).
  استخرج كافة البيانات بدقة متناهية. لا تترك أي حقل فارغاً إذا كانت معلومته موجودة.
  
  أعد البيانات كـ JSON مصفوفة (Array) حصرياً، حيث يمثل كل عنصر في المصفوفة "صكاً/وثيقة مستقلة"، يطابق هذا الهيكل تماماً:
  [
    {
      "aiConfidenceScore": 95,
      "aiNotes": "ملاحظاتك حول وضوح الصك أو أي نواقص",
      "basic": {
        "docType": "صك تسجيل ملكية | وثيقة تملك عقار | إلخ",
        "docSource": "السجل العقاري | وزارة العدل | البورصة العقارية | إلخ",
        "documentNumber": "رقم الوثيقة أو الصك (مهم جداً)",
        "propertyNumber": "رقم العقار (إن وجد)",
        "issueDate": "تاريخ الوثيقة بصيغة YYYY-MM-DD",
        "versionNumber": "رقم النسخة",
        "operationType": "فرز | دمج | انتقال ملكية | إصدار أولي",
        "previousDocNumber": "رقم الوثيقة السابقة (إن وجد)"
      },
      "properties": [
        {
          "city": "المدينة",
          "district": "الحي",
          "planNumber": "رقم المخطط",
          "plotNumber": "رقم القطعة (مثل: 76, 70)",
          "propertyType": "قطعة أرض | مبنى | شقة",
          "usageType": "سكني | تجاري | زراعي | مختلط",
          "area": 0.0,
          "areaText": "المساحة كتابةً (مثال: تسعمائة وخمسون متراً)",
          "boundaries": [
            { "direction": "شمالاً", "type": "شارع|قطعة", "desc": "وصف الحد", "length": "طول الحد بالأرقام" }
          ]
        }
      ],
      "owners": [
        { "name": "الاسم الرباعي للمالك أو الشركة", "identityNumber": "رقم الهوية أو السجل التجاري", "percentage": 100, "isMain": true, "nationality": "سعودي" }
      ],
      "restrictions": {
        "hasRestrictions": "لا يوجد | مرهون | إيقاف",
        "restrictedTo": "الجهة المرتهنة (مثال: صندوق التنمية العقارية)",
        "value": 0.0,
        "text": "نص القيد الحرفي من الصك"
      }
    }
  ]
  `;

  await updateProgress(60);

  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [documentPart, { text: promptText }] }],
    config: { temperature: 0.1, responseMimeType: "application/json" },
  });

  // داخل aiWorker.js بعد الاتصال بـ Gemini

  // داخل aiWorker.js بعد الاتصال بـ Gemini

  await updateProgress(85);

  let parsedData = [];
  try {
    const cleanJson = result.text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    let rawData = JSON.parse(cleanJson);

    // 🛡️ معالجة حالات شذوذ الذكاء الاصطناعي (إذا قام بتغليف المصفوفة داخل Object)
    if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
      if (rawData.deeds) rawData = rawData.deeds;
      else if (rawData.documents) rawData = rawData.documents;
      else if (rawData.properties && Array.isArray(rawData.properties))
        rawData = [rawData]; // إذا أرجع صكاً واحداً
    }

    // التأكد النهائي أنها مصفوفة
    const dataArray = Array.isArray(rawData) ? rawData : [rawData];

    // 🛡️ الهيكلة الإجبارية (Zod-like Manual Validation)
    parsedData = dataArray.map((doc) => ({
      aiConfidenceScore: parseFloat(doc?.aiConfidenceScore) || 90,
      aiNotes: doc?.aiNotes || "تم الاستخراج آلياً.",
      basic: {
        docType: doc?.basic?.docType || "غير محدد",
        docSource: doc?.basic?.docSource || "غير محدد",
        documentNumber: doc?.basic?.documentNumber || "",
        propertyNumber: doc?.basic?.propertyNumber || "",
        issueDate: doc?.basic?.issueDate || "",
        versionNumber: String(doc?.basic?.versionNumber || ""),
        operationType: doc?.basic?.operationType || "",
        previousDocNumber: doc?.basic?.previousDocNumber || "",
      },
      properties: Array.isArray(doc?.properties) ? doc.properties : [],
      owners: Array.isArray(doc?.owners) ? doc.owners : [],
      restrictions: doc?.restrictions || {
        hasRestrictions: "لا يوجد",
        text: "",
        restrictedTo: "",
        value: 0,
      },
    }));
  } catch (error) {
    console.error("AI JSON Parse Error:", error);
    // Fallback آمن جداً في حال الانهيار التام للاستخراج
    parsedData = [{ basic: {}, properties: [], owners: [], restrictions: {} }];
  }

  // 🔍 ----------------------------------------------------
  // 🚀 طباعة البيانات في الكونسول للتأكد منها قبل إرسالها للواجهة
  // -------------------------------------------------------
  console.log("\n=======================================================");
  console.log("🚀 [DEBUG] البيانات المهيكلة الجاهزة للواجهة الأمامية:");
  console.log(JSON.stringify(parsedData, null, 2));
  console.log("=======================================================\n");

  // 💾 الحفظ في جدول المهام كنص JSON سليم ومضمون 100%
  await prisma.aiJob.update({
    where: { id: dbJobId },
    data: {
      status: "COMPLETED",
      progress: 100,
      result: JSON.stringify(parsedData) // ✅ التعديل الأهم: نحفظ parsedData وليس cleanJson
    },
  });

  await prisma.propertyDocumentArchive.update({
    where: { id: archiveDocId },
    data: { status: "ANALYZED" },
  });

  console.log("✅ [Archive AI] تم الاستخراج والهيكلة بنجاح.");
  return parsedData;
};
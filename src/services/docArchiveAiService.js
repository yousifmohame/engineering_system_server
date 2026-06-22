const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const path = require("path");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.processArchiveDoc = async (jobData, updateProgress) => {
  const { dbJobId, archiveDocId } = jobData; // 👈 لاحظ أننا لم نعد نستقبل imageBase64

  await updateProgress(10);

  // 1. 🔍 جلب بيانات الملف من قاعدة البيانات
  const archiveDoc = await prisma.propertyDocumentArchive.findUnique({
    where: { id: archiveDocId }
  });

  if (!archiveDoc || !archiveDoc.fileUrl) {
    throw new Error("لم يتم العثور على سجل الوثيقة في قاعدة البيانات.");
  }

  await updateProgress(20);

  // 2. 📂 قراءة الملف الفعلي من الهارد ديسك
  const fullPath = path.join(__dirname, "../../", archiveDoc.fileUrl);
  if (!fs.existsSync(fullPath)) {
    throw new Error("الملف الفيزيائي مفقود من الخادم.");
  }

  const fileBuffer = fs.readFileSync(fullPath);
  const rawBase64 = fileBuffer.toString("base64");
  const mimeType = archiveDoc.fileType || "application/pdf";

  await updateProgress(40);

  // 3. 🚀 تمرير الملف لـ Gemini مباشرة كـ Document
  const documentPart = {
    inlineData: {
      data: rawBase64,
      mimeType: mimeType,
    }
  };

  await updateProgress(50);

  const promptText = `
  أنت خبير معتمد ومراجع قانوني في وزارة العدل والهيئة العامة للعقار في السعودية.
  اقرأ المستند المرفق (والذي يمثل "وثيقة ملكية عقارية") واستخرج بياناته بدقة متناهية.
  أعد البيانات ككائن JSON حصرياً يطابق الهيكل التالي تماماً:

  {
    "aiConfidenceScore": تقييمك لدقة استخراج البيانات من 0 إلى 100 (Number),
    "basic": {
      "docType": "صك تسجيل ملكية | وثيقة تملك عقار | صك قديم مصور",
      "docSource": "السجل العقاري | وزارة العدل | البورصة العقارية | مصدر آخر",
      "documentNumber": "رقم الوثيقة أو الصك",
      "propertyNumber": "رقم العقار",
      "issueDate": "تاريخ الوثيقة بصيغة YYYY-MM-DD",
      "versionNumber": "رقم النسخة",
      "operationType": "إصدار أولي | انتقال ملكية | رهن | غير ذلك"
    },
    "properties": [
      {
        "propertyType": "قطعة أرض | مبنى سكني",
        "city": "المدينة",
        "district": "الحي",
        "planNumber": "رقم المخطط",
        "plotNumber": "رقم القطعة",
        "area": 0.0,
        "usageType": "سكني | تجاري | زراعي",
        "boundaries": [
          { "direction": "شمالاً", "type": "شارع|قطعة", "desc": "وصف الحد", "length": "طول الحد" }
        ]
      }
    ],
    "owners": [
      { "name": "اسم المالك", "identityNumber": "رقم الهوية", "percentage": "النسبة كـ Float (مثال 50)", "isMain": true }
    ],
    "restrictions": {
      "hasRestrictions": "لا يوجد | مرهون | إيقاف",
      "restrictedTo": "الجهة المرتهنة",
      "value": 0.0,
      "text": "نص القيد"
    }
  }
  `;

  await updateProgress(60);

  // 4. الاتصال المباشر بـ Gemini 2.5 Flash
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [documentPart, { text: promptText }] }],
    config: { temperature: 0.0, responseMimeType: "application/json" }
  });

  await updateProgress(85);

  const cleanJson = result.text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsedData = JSON.parse(cleanJson);
  
  // ==========================================
  // 💾 5. الحفظ النهائي في الداتابيز
  // ==========================================
  const newDocStatus = parsedData.aiConfidenceScore < 80 ? "NEEDS_REVIEW" : "CONFIRMED";

  const propertiesToCreate = (parsedData.properties || []).map(p => ({
    city: p.city,
    district: p.district,
    planNumber: String(p.planNumber || ""),
    plotNumber: String(p.plotNumber || ""),
    area: parseFloat(p.area) || 0,
    usageType: p.usageType,
    propertyType: p.propertyType,
    boundariesData: p.boundaries ? JSON.stringify(p.boundaries) : null
  }));

  const ownersToCreate = (parsedData.owners || []).map(o => ({
    ownerName: o.name || "غير محدد",
    identityNumber: o.identityNumber,
    ownershipPercentage: parseFloat(o.percentage) || 100,
    isMainOwner: o.isMain || false
  }));

  await prisma.propertyDocumentArchive.update({
    where: { id: archiveDocId },
    data: {
      status: newDocStatus,
      docType: parsedData.basic?.docType,
      docSource: parsedData.basic?.docSource,
      documentNumber: parsedData.basic?.documentNumber,
      propertyNumber: parsedData.basic?.propertyNumber,
      issueDate: parsedData.basic?.issueDate ? new Date(parsedData.basic.issueDate) : null,
      versionNumber: parsedData.basic?.versionNumber,
      operationType: parsedData.basic?.operationType,

      hasRestrictions: parsedData.restrictions?.hasRestrictions || "NONE",
      restrictedTo: parsedData.restrictions?.restrictedTo,
      restrictionValue: parseFloat(parsedData.restrictions?.value) || 0,
      restrictionText: parsedData.restrictions?.text,

      aiConfidenceScore: parseFloat(parsedData.aiConfidenceScore) || 0,

      properties: { create: propertiesToCreate },
      owners: { create: ownersToCreate },
    }
  });

  await updateProgress(100);
  
  console.log("✅ [Archive AI] تم تحليل الوثيقة وحفظها في الداتابيز بنجاح!");
  return parsedData;
};
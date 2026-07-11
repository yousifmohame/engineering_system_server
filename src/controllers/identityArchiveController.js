const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ==========================================
// 1. رفع الهوية وبدء التحليل في الخلفية
// ==========================================
const uploadIdentity = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "الرجاء إرفاق ملف الهوية" });
    }

    const userId = req.user?.id || "النظام";
    const createdRecords = [];

    // الدوران على الملفات المرفوعة (لدعم الرفع المتعدد Bulk Upload)
    for (const file of req.files) {
      const fileUrl = `/uploads/identities/${file.filename}`;

      // إنشاء السجل الأولي بحالة "قيد التحليل"
      const newRecord = await prisma.identityArchiveRecord.create({
        data: {
          identityType: "UNKNOWN",
          entityType: "INDIVIDUAL",
          sourceFileUrl: fileUrl,
          sourceFileName: file.originalname,
          status: "ANALYZING",
          uploadedBy: userId,
        },
      });
      createdRecords.push(newRecord);

      // 💡 إطلاق المعالجة الذكية في الخلفية (Fire & Forget)
      processIdentityAI(newRecord.id, file.path, userId).catch(console.error);
    }

    res.status(202).json({
      success: true,
      message: "تم استلام الملفات وجاري تحليلها بالذكاء الاصطناعي",
      data: createdRecords,
    });
  } catch (error) {
    console.error("Upload Identity Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 💡 دالة معالجة الذكاء الاصطناعي (تعمل بالخلفية) - النسخة المصححة ✅
// ==========================================
const processIdentityAI = async (recordId, filePath, userId) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);

    // تحديد نوع الملف بدقة لتجنب أخطاء Gemini
    const ext = path.extname(filePath).toLowerCase();
    let mimeType = "image/jpeg";
    if (ext === ".pdf") mimeType = "application/pdf";
    else if (ext === ".png") mimeType = "image/png";
    else if (ext === ".webp") mimeType = "image/webp";

    const documentPart = {
      inlineData: { data: fileBuffer.toString("base64"), mimeType },
    };

    const prompt = `
      أنت نظام ذكاء اصطناعي خبير في قراءة الهويات السعودية والمستندات الرسمية.
      استخرج البيانات التالية من الصورة أو الـ PDF المرفق بصيغة JSON فقط بدون أي نصوص إضافية أو مقدمات:
      {
        "identityType": "NATIONAL_ID أو IQAMA أو PASSPORT أو CR أو AUTHORIZATION أو UNKNOWN",
        "entityType": "INDIVIDUAL أو COMPANY أو INSTITUTION",
        "primaryNumber": "رقم الهوية / الإقامة / السجل التجاري / الجواز (أرقام فقط)",
        "arabicName": "الاسم العربي",
        "englishName": "الاسم الإنجليزي إن وجد",
        "nationality": "الجنسية",
        "gender": "الجنس",
        "placeOfBirth": "مكان الميلاد",
        "dateOfBirthGregorian": "تاريخ الميلاد الميلادي YYYY-MM-DD",
        "issueDateGregorian": "تاريخ الإصدار الميلادي YYYY-MM-DD",
        "expiryDateGregorian": "تاريخ الانتهاء الميلادي YYYY-MM-DD",
        "issuingAuthority": "جهة الإصدار",
        "aiConfidenceOverall": 0.95
      }
      تأكد من تحويل أي أرقام هندية (مثل ١٢٣) إلى إنجليزية (123)، وإذا لم تجد معلومة ضعها null.
    `;

    const fallbackModels = [
      "gemini-3-flash-preview",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ];
    let response = null;

    for (const model of fallbackModels) {
      try {
        response = await ai.models.generateContent({
          model: model,
          contents: [prompt, documentPart],
          config: { temperature: 0.0, responseMimeType: "application/json" },
        });
        break; // نجح الاتصال، اخرج من الحلقة
      } catch (e) {
        console.warn(`فشل الموديل ${model}، جاري تجربة آخر...`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (!response) throw new Error("فشل الاتصال بجميع نماذج الذكاء الاصطناعي");

    // 💡 الإصلاح الأول: تنظيف نص الـ Markdown الذي يرسله Gemini أحياناً
    let jsonStr = response.text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    // تحويل الأرقام العربية/الهندية
    const cleanedText = jsonStr.replace(/[٠-٩]/g, (d) =>
      "٠١٢٣٤٥٦٧٨٩".indexOf(d),
    );
    const aiData = JSON.parse(cleanedText);

    // حساب حالة الصلاحية (سارية أو منتهية)
    let validityStatus = "UNKNOWN";
    let daysUntilExpiry = null;
    if (aiData.expiryDateGregorian) {
      const expiry = new Date(aiData.expiryDateGregorian);
      const today = new Date();
      const diffTime = expiry - today;
      daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (daysUntilExpiry < 0) validityStatus = "EXPIRED";
      else if (daysUntilExpiry <= 30) validityStatus = "EXPIRING_SOON";
      else validityStatus = "VALID";
    }

    // التحقق من التكرار في قاعدة البيانات
    let finalStatus = "COMPLETED";
    if (aiData.primaryNumber) {
      const existing = await prisma.identityArchiveRecord.findFirst({
        where: { primaryNumber: aiData.primaryNumber, id: { not: recordId } },
      });

      if (existing) {
        finalStatus = "DUPLICATE";
        await prisma.identityDuplicateCandidate.create({
          data: {
            recordAId: existing.id,
            recordBId: recordId,
            duplicateType: "EXACT_MATCH",
            matchScore: 100,
          },
        });
      }
    }

    // 💡 الإصلاح الثاني: استخدام (aiData.aiConfidenceOverall) بدلاً من المتغير غير المعرف
    const confidence = aiData.aiConfidenceOverall || 0.9;

    // تحديث السجل بالبيانات المستخرجة
    await prisma.identityArchiveRecord.update({
      where: { id: recordId },
      data: {
        identityType: aiData.identityType || "UNKNOWN",
        entityType: aiData.entityType || "INDIVIDUAL",
        primaryNumber: aiData.primaryNumber,
        arabicName: aiData.arabicName,
        englishName: aiData.englishName,
        nationality: aiData.nationality,
        gender: aiData.gender,
        placeOfBirth: aiData.placeOfBirth,
        dateOfBirthGregorian: aiData.dateOfBirthGregorian
          ? new Date(aiData.dateOfBirthGregorian)
          : null,
        issueDateGregorian: aiData.issueDateGregorian
          ? new Date(aiData.issueDateGregorian)
          : null,
        expiryDateGregorian: aiData.expiryDateGregorian
          ? new Date(aiData.expiryDateGregorian)
          : null,
        issuingAuthority: aiData.issuingAuthority,

        status: confidence < 0.7 ? "NEEDS_REVIEW" : finalStatus,
        validityStatus,
        daysUntilExpiry,
        aiConfidenceOverall: confidence,
        aiExtractedJson: aiData, // حفظ الـ JSON الخام للرجوع إليه
      },
    });

    // تسجيل في الـ Audit Log
    await prisma.identityAuditLog.create({
      data: { identityArchiveRecordId: recordId, action: "AI_ANALYZE", userId },
    });
  } catch (error) {
    console.error(`AI Error for Record ${recordId}:`, error);
    // في حالة فشل التحليل، نغير الحالة ليقوم الموظف بإدخالها يدوياً بدلاً من بقائها "معلقة"
    await prisma.identityArchiveRecord.update({
      where: { id: recordId },
      data: { status: "NEEDS_REVIEW" },
    });
  }
};

// ==========================================
// 2. جلب جميع الهويات (مع الفلاتر)
// ==========================================
const getIdentities = async (req, res) => {
  try {
    const { search, identityType, status, validityStatus } = req.query;

    const where = { isArchived: false };
    if (identityType) where.identityType = identityType;
    if (status) where.status = status;
    if (validityStatus) where.validityStatus = validityStatus;
    if (search) {
      where.OR = [
        { primaryNumber: { contains: search } },
        { arabicName: { contains: search } },
        { englishName: { contains: search } },
      ];
    }

    const identities = await prisma.identityArchiveRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: identities });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. جلب تفاصيل هوية واحدة مع الارتباطات (مع جلب أسماء الموظفين)
// ==========================================
const getIdentityById = async (req, res) => {
  try {
    const { id } = req.params;
    const identity = await prisma.identityArchiveRecord.findUnique({
      where: { id },
      include: {
        representatives: true,
        links: true,
        auditLogs: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });

    if (!identity)
      return res
        .status(404)
        .json({ success: false, message: "الهوية غير موجودة" });

    // 💡 1. استخراج جميع معرّفات الموظفين (IDs) من سجل التدقيق بدون تكرار
    const userIds = [
      ...new Set(identity.auditLogs.map((log) => log.userId)),
    ].filter((uid) => uid !== "System" && uid !== "النظام");

    // 💡 2. جلب أسماء الموظفين من جدول (Employee) بناءً على الـ schema الخاص بك
    let userMap = {};
    if (userIds.length > 0) {
      // ✅ تم تصحيح { in: userIds } واستخدام prisma.employee بالحرف الصغير كما تتطلب Prisma
      const employees = await prisma.employee.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      });
      employees.forEach((emp) => {
        userMap[emp.id] = emp.name;
      });
    }

    // 💡 3. حقن اسم الموظف داخل كل سجل تدقيق
    const auditLogsWithNames = identity.auditLogs.map((log) => ({
      ...log,
      userName:
        log.userId === "System" || log.userId === "النظام"
          ? "النظام الآلي"
          : userMap[log.userId] || "مستخدم غير معروف",
    }));

    identity.auditLogs = auditLogsWithNames;

    res.json({ success: true, data: identity });
  } catch (error) {
    console.error("Get Identity Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
// ==========================================
// 4. دمج هويتين (التكرارات)
// ==========================================
const mergeIdentities = async (req, res) => {
  try {
    const { duplicateId } = req.params; // ID من جدول IdentityDuplicateCandidate
    const userId = req.user?.id || "النظام";

    const duplicateRecord = await prisma.identityDuplicateCandidate.findUnique({
      where: { id: duplicateId },
    });
    if (!duplicateRecord)
      return res
        .status(404)
        .json({ success: false, message: "سجل التكرار غير موجود" });

    // نقل الارتباطات (Links) من السجل القديم إلى الجديد
    await prisma.identityArchiveLink.updateMany({
      where: { identityArchiveRecordId: duplicateRecord.recordBId },
      data: { identityArchiveRecordId: duplicateRecord.recordAId },
    });

    // أرشفة السجل المدمج (لا نحذفه للحفاظ على الملف الأصلي)
    await prisma.identityArchiveRecord.update({
      where: { id: duplicateRecord.recordBId },
      data: { isArchived: true, status: "MERGED" },
    });

    // تحديث حالة التكرار
    await prisma.identityDuplicateCandidate.update({
      where: { id: duplicateId },
      data: { status: "MERGED", resolvedBy: userId, resolvedAt: new Date() },
    });

    res.json({ success: true, message: "تم دمج السجلات بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  uploadIdentity,
  getIdentities,
  getIdentityById,
  mergeIdentities,
};

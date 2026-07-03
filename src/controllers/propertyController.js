// src/controllers/propertyController.js
const prisma = require("../utils/prisma");
const { GoogleGenAI } = require("@google/genai");
const { decrypt } = require("../utils/cryptoUtils");
const fs = require("fs");
const path = require("path");

// ==========================================
// 1. الدالة المساعدة لإنشاء كود عميل تسلسلي
// ==========================================
const generateNextClientCode = async () => {
  const year = new Date().getFullYear();
  const prefix = `CLT-${year}-`;

  const lastClient = await prisma.client.findFirst({
    where: { clientCode: { startsWith: prefix } },
    orderBy: { clientCode: "desc" },
  });

  let nextNumber = 1;

  if (lastClient) {
    try {
      const lastNumberStr = lastClient.clientCode.split("-")[2];
      const lastNumber = parseInt(lastNumberStr, 10);
      nextNumber = lastNumber + 1;
    } catch (e) {
      console.error("Failed to parse last client code, defaulting to 1", e);
      nextNumber = 1;
    }
  }

  const paddedNumber = String(nextNumber).padStart(3, "0");
  return `${prefix}${paddedNumber}`; // النتيجة: CLT-2026-001
};

// ==========================================
// 2. معالجة الصك العقاري باستخدام Gemini AI (يدعم PDF والصور مباشرة)
// ==========================================
exports.analyzeDeedAI = async (req, res) => {
  let uploadedGeminiFiles = [];
  let ai;
  let tempFilePath = null;

  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرسال أي ملف" });
    }

    // --- تهيئة إعدادات Gemini ---
    const systemSettings = await prisma.systemSettings.findUnique({
      where: { id: 1 },
    });
    const apiKey = systemSettings?.geminiApiKey
      ? decrypt(systemSettings.geminiApiKey)
      : process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey.trim() === "" || apiKey.includes("***")) {
      throw new Error(
        "⚠️ مفتاح الذكاء الاصطناعي (Gemini) غير متوفر في إعدادات النظام.",
      );
    }

    ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 600000 },
    });

    // --- استخراج البيانات النقية والنوع ---
    let mimeType = "application/pdf"; // النوع الافتراضي
    let base64Data = imageBase64;

    if (imageBase64.includes(";base64,")) {
      const parts = imageBase64.split(";base64,");
      mimeType = parts[0].split(":")[1];
      base64Data = parts[1];
    }

    // 🚀 تحويل الـ Base64 إلى Buffer
    const fileBuffer = Buffer.from(base64Data, "base64");

    // تحديد امتداد الملف لحفظه مؤقتاً
    let ext = ".pdf";
    if (mimeType.includes("png")) ext = ".png";
    else if (mimeType.includes("jpeg") || mimeType.includes("jpg"))
      ext = ".jpg";
    else if (mimeType.includes("webp")) ext = ".webp";

    // التأكد من وجود مجلد الرفع المؤقت
    const tempDir = path.join(__dirname, "../../uploads/temp_ai");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // حفظ الملف محلياً بشكل مؤقت (سواء كان PDF أو صورة)
    tempFilePath = path.join(tempDir, `deed_doc_${Date.now()}${ext}`);
    fs.writeFileSync(tempFilePath, fileBuffer);

    console.log(
      `🚀 جاري رفع الملف (${ext}) إلى خوادم Gemini للتحليل المباشر...`,
    );

    // --- رفع الملف إلى واجهة Gemini File API ---
    const uploadResult = await ai.files.upload({
      file: tempFilePath,
      mimeType: mimeType,
      displayName: `Deed_Document_${Date.now()}`,
    });

    uploadedGeminiFiles.push(uploadResult);

    // 🧹 حذف الملف المؤقت المحلي فوراً بعد الرفع لضمان نظافة السيرفر
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
      tempFilePath = null;
    }

    // ==========================================
    // 3. البرومبت الشامل (Master Extraction Prompt)
    // ==========================================
    const DYNAMIC_SYSTEM_PROMPT = `
أنت خبير معتمد ومراجع قانوني في وزارة العدل والهيئة العامة للعقار في السعودية.
مهمتك قراءة المستند المرفق والذي يمثل "صكاً عقارياً" (قد يكون صك كتابة عدل قديم، أو وثيقة بورصة عقارية، أو صك سجل عقاري RER).
استخرج البيانات التالية بدقة متناهية وأعدها كـ JSON صالح 100%.

🔍 **دليل البحث الاستراتيجي حسب نوع الصك:**
1. **السجل العقاري (RER):** "رقم العقار" هو رقم الوثيقة. المساحة واستعمال العقار تكون في جدول "بيانات قطعة الأرض".
2. **البورصة العقارية:** رقم الوثيقة عادة 12 رقم. قد يحتوي الصك على عدة عقارات. اجمع المساحات معاً، وادمج أرقام القطع بفاصلة.
3. **صكوك كتابة العدل القديمة (النصية):** اقرأ النص السردي. استخرج رقم الصك من الأعلى، المساحة من جملة "ومساحتها (...) متر"، الأطوال من "شمالا ... بطول (...)".

⚠️ **قواعد البيانات الصارمة (Data Types):**
- الأرقام يجب أن تكون من نوع Number (أزل الفواصل النصية وأي نصوص مثل "م2" أو "%").
- إذا لم تجد المعلومة، أرجع null (للنصوص) أو 0 (للأرقام).

التركيبة المطلوبة للـ JSON حصرياً:
{
  "documentInfo": {
    "documentNumber": "رقم الوثيقة/الصك/العقار (String)",
    "hijriDate": "تاريخ الوثيقة الهجري DD/MM/YYYY (String)",
    "gregorianDate": "تاريخ الوثيقة الميلادي DD/MM/YYYY (String)",
    "documentType": "صك ملكية أو وثيقة تملك أو صك تسجيل ملكية (String)",
    "issuingAuthority": "الجهة المصدرة (String)",
    "propertyId": "رقم الهوية العقارية إن وجد (String)"
  },
  "previousDocumentInfo": {
    "previousDocumentNumber": "رقم الوثيقة/الصك السابق (String)",
    "previousDocumentDate": "تاريخ الوثيقة السابقة (String)",
    "transactionValue": قيمة انتقال الملكية/الثمن (Number)
  },
  "locationInfo": {
    "city": "اسم المدينة (String)",
    "district": "اسم الحي (String)",
    "planNumber": "رقم المخطط (String)"
  },
  "plots": [
    {
      "plotNumber": "رقم القطعة (String)",
      "planNumber": "رقم المخطط (String)",
      "blockNumber": "رقم البلك (String)",
      "area": مساحة القطعة (Number),
      "propertyType": "نوع العقار (String)",
      "usageType": "الاستخدام (String)"
    }
  ],
  "propertySpecs": {
    "totalArea": إجمالي المساحة (Number)
  },
  "owners": [
    {
      "name": "اسم المالك أو الشركة (String)",
      "identityNumber": "رقم الهوية الوطنية أو الرقم الموحد (String)",
      "nationality": "الجنسية (String)",
      "sharePercentage": نسبة التملك (Number)
    }
  ],
  "boundaries": [
    { "direction": "شمال", "length": الطول (Number), "description": "وصف المجاور (String)" },
    { "direction": "جنوب", "length": الطول (Number), "description": "وصف المجاور (String)" },
    { "direction": "شرق", "length": الطول (Number), "description": "وصف المجاور (String)" },
    { "direction": "غرب", "length": الطول (Number), "description": "وصف المجاور (String)" }
  ],
  "metadata": {
    "confidenceScore": تقييم الدقة من 0 إلى 100 (Number),
    "aiNotes": "ملاحظات (String)"
  }
}
`;

    // 🚀 تمرير الـ URI الخاص بالملف إلى الموديل
    const fileParts = uploadedGeminiFiles.map((f) => ({
      fileData: { fileUri: f.uri, mimeType: f.mimeType },
    }));

    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [
        "يرجى تحليل هذا المستند العقاري (سواء كان PDF أو صورة) واستخراج البيانات بصيغة JSON فقط.",
        ...fileParts,
      ],
      config: {
        systemInstruction: DYNAMIC_SYSTEM_PROMPT,
        temperature: 0.1, // دقة عالية
        responseMimeType: "application/json",
      },
    });

    let responseText = response.text || "";
    responseText = responseText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    // تحويل الأرقام الهندية إن وجدت
    const parsedData = JSON.parse(
      responseText.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)),
    );

    console.log("✅ تم تحليل المستند واستخراج البيانات بنجاح باستخدام Gemini!");

    res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("AI Analysis Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل تحليل الوثيقة بالذكاء الاصطناعي",
      details: error.message,
    });
  } finally {
    // تنظيف الملف المؤقت إذا فشلت العملية قبل حذفه
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {}
    }
    // تنظيف الملفات من خوادم Gemini
    if (ai && uploadedGeminiFiles.length > 0) {
      for (const file of uploadedGeminiFiles) {
        try {
          await ai.files.delete({ name: file.name });
        } catch (e) {
          console.warn(`⚠️ فشل حذف الملف من Gemini:`, e.message);
        }
      }
    }
  }
};

exports.getAllProperties = async (req, res) => {
  try {
    const { search, limit = 10, page = 1, clientId } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (clientId) {
      where.clientId = clientId;
    }

    if (search) {
      where.OR = [
        { deedNumber: { contains: search } },
        { district: { contains: search } },
        { client: { name: { path: ["ar"], string_contains: search } } },
      ];
    }

    const [deeds, total] = await Promise.all([
      prisma.ownershipFile.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        orderBy: { createdAt: "desc" },
        include: {
          client: { select: { id: true, name: true, mobile: true } },
        },
      }),
      prisma.ownershipFile.count({ where }),
    ]);

    res.json({
      success: true,
      data: deeds, // البيانات تأتي الآن بنفس الأسماء المطلوبة للواجهة
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error getting properties:", error);
    res.status(500).json({ success: false, message: "فشل جلب البيانات" });
  }
};

exports.createProperty = async (req, res) => {
  try {
    const {
      deedNumber,
      deedDate,
      district,
      city,
      plotNumber,
      blockNumber,
      planNumber,
      area,
      clientId,
      notes,
      documents = [],
      plots = [],
      owners = [],
      boundaries = [],
      attachments = [],

      // 🚀 استقبال معرف الحي من الفرونت إند للربط الإحصائي 🚀
      districtId,
    } = req.body;

    if (!clientId) {
      return res
        .status(400)
        .json({ success: false, message: "يجب إدخال اسم أو معرّف العميل" });
    }

    // ==========================================
    // 1. معالجة رقم الصك (منع التكرار)
    // ==========================================
    const validDeedNumber =
      deedNumber && String(deedNumber).trim() !== ""
        ? String(deedNumber).trim()
        : null;

    if (validDeedNumber) {
      const existingDeed = await prisma.ownershipFile.findFirst({
        where: { deedNumber: validDeedNumber },
      });
      if (existingDeed) {
        return res.status(400).json({
          success: false,
          message: `عفواً، الصك المرجعي (${validDeedNumber}) مرتبط بملف آخر مسبقاً.`,
        });
      }
    }

    // ==========================================
    // 2. معالجة التاريخ
    // ==========================================
    let validDeedDate = null;
    if (deedDate) {
      const parsedDate = new Date(deedDate);
      if (!isNaN(parsedDate.getTime())) validDeedDate = parsedDate;
    }

    // ==========================================
    // 3. معالجة العميل التلقائية (Smart Client)
    // ==========================================
    let finalClientId = clientId;
    if (clientId.includes(" ") || /[\u0600-\u06FF]/.test(clientId)) {
      // استخدام دالة توليد الكود لتوحيد النسق
      const newClientCode = await generateNextClientCode();

      const tempIdNumber =
        "10" +
        Math.floor(Math.random() * 100000000)
          .toString()
          .padStart(8, "0");
      const tempMobile =
        "05" +
        Math.floor(Math.random() * 100000000)
          .toString()
          .padStart(8, "0");

      const newClient = await prisma.client.create({
        data: {
          clientCode: newClientCode,
          name: { ar: clientId },
          mobile: tempMobile,
          idNumber: tempIdNumber,
          type: "فرد سعودي",
          contact: {},
          identification: {},
          ...(districtId && { districtNode: { connect: { id: districtId } } }),
        },
      });
      finalClientId = newClient.id;
    }

    // ==========================================
    // 4. توليد كود الملكية والحفظ النهائي
    // ==========================================
    const count = await prisma.ownershipFile.count();
    const sequence = String(count + 1).padStart(4, "0");
    const code = `PRO-800-${sequence}`;

    const newDeed = await prisma.ownershipFile.create({
      data: {
        code,
        deedNumber: validDeedNumber,
        deedDate: validDeedDate,
        district,
        city: city || "الرياض",
        planNumber: planNumber || null,
        plotNumber: plotNumber || null,
        blockNumber: blockNumber || null,
        area: area ? parseFloat(area) : 0,
        status: "Active",
        notes,

        // 🚀 إضافة الربط المباشر مع جدول الأحياء (districtId)
        ...(districtId && { districtNode: { connect: { id: districtId } } }),

        // حفظ المصفوفات
        documents,
        plots,
        owners,
        boundaries,
        attachments,

        client: { connect: { id: finalClientId } },
      },
    });

    res.status(201).json({
      success: true,
      message: "تم حفظ الصك والبيانات بنجاح!",
      data: newDeed,
    });
  } catch (error) {
    console.error("🔥 Create Property Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل الحفظ",
      error: error.message,
    });
  }
};

// تحديث بيانات ملف الملكية (الصك)
exports.updateProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      // 1. المصفوفات (JSON)
      documents,
      plots,
      owners,
      boundaries,
      attachments,

      // 2. الحقول الأساسية
      area,
      city,
      district,
      planNumber,
      deedNumber, // 👈 تمت الإضافة
      deedDate, // 👈 تمت الإضافة
      status, // 👈 تمت الإضافة (لتاب التحقق)
      notes, // 👈 تمت الإضافة (لتاب الملاحظات)
    } = req.body;

    // معالجة التاريخ إذا تم إرسال تاريخ جديد
    let validDeedDate = undefined;
    if (deedDate) {
      const parsedDate = new Date(deedDate);
      if (!isNaN(parsedDate.getTime())) {
        validDeedDate = parsedDate;
      }
    }

    const updatedProperty = await prisma.ownershipFile.update({
      where: { id },
      data: {
        // تحديث الحقول الأساسية (نستخدم !== undefined للسماح بحفظ القيم الفارغة إذا مسحها المستخدم)
        ...(area !== undefined && { area: parseFloat(area) }),
        ...(city !== undefined && { city }),
        ...(district !== undefined && { district }),
        ...(planNumber !== undefined && { planNumber }),
        ...(deedNumber !== undefined && { deedNumber }),
        ...(validDeedDate !== undefined && { deedDate: validDeedDate }),
        ...(status !== undefined && { status }), // ✅ حفظ تغيير الحالة
        ...(notes !== undefined && { notes }), // ✅ حفظ الملاحظات

        // تحديث حقول الـ JSON
        ...(documents && { documents }),
        ...(plots && { plots }),
        ...(owners && { owners }),
        ...(boundaries && { boundaries }),
        ...(attachments && { attachments }),
      },
    });

    res.json({
      success: true,
      data: updatedProperty,
      message: "تم تحديث الملف وتخزين البيانات بنجاح",
    });
  } catch (error) {
    console.error("Update Property Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل في تحديث بيانات الملكية" });
  }
};

// 3. جلب تفاصيل صك
exports.getPropertyById = async (req, res) => {
  try {
    const { id } = req.params;
    const property = await prisma.ownershipFile.findUnique({
      where: { id },
      include: {
        client: {
          select: { id: true, name: true, mobile: true, idNumber: true },
        },
      },
    });

    if (!property) {
      return res
        .status(404)
        .json({ success: false, message: "ملف الملكية غير موجود" });
    }

    res.json({ success: true, data: property });
  } catch (error) {
    console.error("Error fetching property details:", error);
    res.status(500).json({ success: false, message: "فشل جلب التفاصيل" });
  }
};

// ===============================================
// 🚀 جلب الإحصائيات الشاملة للملكيات والصكوك
// GET /api/properties/stats
// ===============================================
exports.getPropertyStats = async (req, res) => {
  try {
    const properties = await prisma.ownershipFile.findMany({
      select: {
        id: true,
        area: true,
        status: true,
        district: true,
        plots: true,
        createdAt: true
      }
    });

    let totalArea = 0;
    let statusCount = { active: 0, pending: 0, disputed: 0 };
    let typesCount = { residential: 0, commercial: 0, agricultural: 0, land: 0, other: 0 };
    let districtMap = {};

    properties.forEach((p) => {
      // 1. حساب المساحة
      totalArea += Number(p.area) || 0;

      // 2. حساب الحالات
      const st = (p.status || "").toLowerCase();
      if (st === "active" || st === "مؤكد" || st === "معتمد") statusCount.active++;
      else if (st === "pending" || st === "قيد المراجعة") statusCount.pending++;
      else statusCount.disputed++;

      // 3. حساب الأحياء
      if (p.district && p.district.trim() !== "") {
        const dist = p.district.trim();
        districtMap[dist] = (districtMap[dist] || 0) + 1;
      }

      // 4. حساب أنواع العقارات (من أول قطعة)
      let pType = "أرض";
      try {
        const parsedPlots = typeof p.plots === 'string' ? JSON.parse(p.plots) : p.plots;
        if (parsedPlots && parsedPlots.length > 0) {
          pType = parsedPlots[0].propertyType || "أرض";
        }
      } catch (e) {}

      if (pType.includes("سكن")) typesCount.residential++;
      else if (pType.includes("تجار")) typesCount.commercial++;
      else if (pType.includes("زراع")) typesCount.agricultural++;
      else if (pType.includes("أرض") || pType.includes("ارض")) typesCount.land++;
      else typesCount.other++;
    });

    // ترتيب الأحياء لأعلى 5
    const topDistricts = Object.entries(districtMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    res.json({
      success: true,
      data: {
        totalProperties: properties.length,
        totalArea,
        statusCount,
        typesCount,
        topDistricts
      }
    });

  } catch (error) {
    console.error("Stats Error:", error);
    res.status(500).json({ success: false, message: "فشل في حساب الإحصائيات" });
  }
};
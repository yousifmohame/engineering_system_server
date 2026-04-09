const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const { z } = require("zod");

// 💡 1. استيراد الـ SDK الجديد
const { GoogleGenAI } = require("@google/genai");

// 💡 2. تهيئة العميل الجديد
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const { findBestMatchAI } = require("../services/aiMatchingService");

// ==========================================
// 💡 Zod Schema (لضمان نوع البيانات)
// ==========================================
const PermitSchema = z.object({
  permitNumber: z.string().nullable().catch(""),
  issueDate: z.string().nullable().catch(""),
  expiryDate: z.string().nullable().catch(""),
  year: z.string().nullable().catch(new Date().getFullYear().toString()),
  type: z.string().nullable().catch("غير محدد"),
  ownerName: z.string().nullable().catch(""),
  idNumber: z.string().nullable().catch(""),
  district: z.string().nullable().catch(""),
  sector: z.string().nullable().catch(""),
  plotNumber: z.string().nullable().catch(""),
  planNumber: z.string().nullable().catch(""),
  mainUsage: z.string().nullable().catch("سكني"),
  subUsage: z.string().nullable().catch(""),
  landArea: z
    .union([z.number(), z.string()])
    .nullable()
    .catch("")
    .transform((val) => Number(val) || 0),
  engineeringOffice: z.string().nullable().catch(""),
  form: z.string().nullable().catch("أخضر"),
  notes: z.string().nullable().catch(""),
  componentsData: z
    .array(
      z.object({
        name: z.string().catch("مكون غير معروف"),
        usage: z.string().nullable().catch(""),
        area: z
          .union([z.number(), z.string()])
          .nullable()
          .catch("")
          .transform((val) => Number(val) || 0),
        units: z
          .union([z.number(), z.string()])
          .nullable()
          .catch("")
          .transform((val) => Number(val) || 0),
      }),
    )
    .catch([]),
  boundariesData: z
    .array(
      z.object({
        direction: z.string().catch("اتجاه غير معروف"),
        length: z
          .union([z.number(), z.string()])
          .nullable()
          .catch("")
          .transform((val) => Number(val) || 0),
        neighbor: z.string().nullable().catch(""),
      }),
    )
    .catch([]),
  detailedReport: z.string().catch("لم يتم توليد تقرير مفصل."),
});

// ==========================================
// 💡 تحليل رخص البناء بالذكاء الاصطناعي (Enterprise Version)
// ==========================================
const analyzePermitAI = async (req, res) => {
  let tempFilePath = null;

  try {
    let fileBuffer;
    let mimeType;

    // استلام الملف
    if (req.file) {
      tempFilePath = req.file.path;
      fileBuffer = fs.readFileSync(tempFilePath);
      mimeType = req.file.mimetype;
    } else if (req.body.imageBase64) {
      const { imageBase64 } = req.body;
      mimeType = imageBase64.substring(
        imageBase64.indexOf(":") + 1,
        imageBase64.indexOf(";"),
      );
      const base64Data = imageBase64.split(",")[1];
      fileBuffer = Buffer.from(base64Data, "base64");
    } else {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرسال أي وثيقة" });
    }

    console.log(
      `🚀 جاري إرسال الملف بصيغة (${mimeType}) إلى Gemini 3 Flash Preview للتحليل...`,
    );

    // تجهيز الملف بالطريقة التي يفهمها Gemini
    const documentPart = {
      inlineData: {
        data: fileBuffer.toString("base64"),
        mimeType: mimeType,
      },
    };

    const prompt = `
    أنت نظام استخراج بيانات (Data Extractor) عالي الدقة تعمل لدى أمانة منطقة الرياض.
    أمامك وثيقة رسمية (رخصة بناء). استخرج البيانات الموجودة فيها حصرياً لملء كائن الـ JSON التالي.

    تعليمات صارمة جداً:
    1. اقرأ البيانات من الجداول بدقة، خاصة جدول "الحدود والأبعاد والإرتدادات" وجدول "عرض مكونات البناء".
    2. الأرقام: قم بتحويل أي رقم هندي (١،٢،٣) إلى رقم إنجليزي (1,2,3).
    3. المساحات والأطوال: استخرج الرقم فقط (بدون كتابة حرف 'م' أو 'م2').
    4. لا تخمن أي معلومة. إذا كانت المعلومة غير موجودة في المستند، أرجع null للنصوص أو 0 للأرقام.
    5. التقرير (detailedReport): اكتب 3 أسطر باللغة العربية تلخص محتوى الرخصة وأهم ما جاء في خانة "الملاحظات" أو "الموقع العام".

    يجب أن يكون المخرج حصرياً بصيغة JSON المطابقة للتركيبة التالية:
    {
      "permits": [
        {
          "permitNumber": "رقم الرخصة",
          "issueDate": "تاريخ إصدارها",
          "expiryDate": "تاريخ انتهائها",
          "year": "سنة الإصدار",
          "type": "نوع الطلب أو الرخصة (مثال: رخصة بناء)",
          "ownerName": "اسم صاحب الرخصة",
          "idNumber": "رقم الهوية أو السجل التجاري",
          "district": "الحي",
          "sector": "الجهة (مثال: قطاع وسط مدينة الرياض)",
          "plotNumber": "رقم قطعة الأرض",
          "planNumber": "رقم المخطط",
          "mainUsage": "التصنيف الرئيسي (مثال: تجاري)",
          "subUsage": "التصنيف الفرعي (مثال: المركز التجارية الصغيرة)",
          "landArea": 0,
          "engineeringOffice": "المكتب الهندسي المصمم أو المشرف",
          "notes": "الملاحظات والشروط",
          "form": "أخضر",
          "componentsData": [
            { "name": "اسم المكون", "usage": "الاستخدام", "area": 0, "units": 0 }
          ],
          "boundariesData": [
            { "direction": "الشمال/الجنوب/الشرق/الغرب", "length": 0, "neighbor": "حدودها" }
          ],
          "detailedReport": "تقرير هندسي وصفي..."
        }
      ]
    }
    `;

    // 💡 قائمة النماذج حسب الأولوية (من الأحدث إلى الأكثر استقراراً)
    const fallbackModels = [
      "gemini-3-flash-preview", // المحاولة الأولى (الأحدث)
      "gemini-2.5-flash",       // المحاولة الثانية (سريع ومستقر جداً)
      "gemini-1.5-flash",       // المحاولة الثالثة (صخرة لا تنكسر)
      "gemini-1.5-pro"          // المحاولة الأخيرة
    ];

    let response = null;
    let lastError = null;

    // 💡 نظام الطوارئ: المحاولة على عدة نماذج متتالية إذا كان السيرفر مشغولاً
    for (const modelName of fallbackModels) {
      try {
        console.log(`🔄 جاري محاولة التحليل باستخدام الموديل: ${modelName}...`);
        
        response = await ai.models.generateContent({
          model: modelName,
          contents: [prompt, documentPart],
          config: {
            temperature: 0.0,
            responseMimeType: "application/json",
          },
        });
        
        console.log(`✅ نجح التحليل باستخدام: ${modelName}`);
        break; // إذا نجح الطلب، نوقف اللوب فوراً
      } catch (error) {
        console.warn(`⚠️ الموديل ${modelName} مشغول أو غير متاح (${error.status}). جاري التحويل للبديل...`);
        lastError = error;
        
        // انتظار بسيط (ثانية واحدة) قبل المحاولة بالنموذج التالي لتجنب حظر الـ API
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // إذا فشلت جميع المحاولات
    if (!response) {
      throw new Error(`جميع نماذج الذكاء الاصطناعي مشغولة حالياً بسبب الضغط العالي. يرجى المحاولة بعد قليل. (الخطأ الأخير: ${lastError.message})`);
    }

    // استخراج النص من الاستجابة الناجحة
    const responseText = response.text;

    // الفلتر السحري لتنظيف الأرقام العربية الهندية (احتياطياً)
    let cleanedContent = responseText.replace(/[٠-٩]/g, (d) =>
      "٠١٢٣٤٥٦٧٨٩".indexOf(d)
    );

    const parsedData = JSON.parse(cleanedContent);
    let rawPermits = parsedData.permits || [];

    // 🛡️ التحقق والتنظيف بواسطة Zod
    const validatedPermits = rawPermits.map((permit) =>
      PermitSchema.parse(permit)
    );

    console.log("✅ تم تحليل الوثيقة بنجاح بواسطة Gemini 3!");

    // المطابقة الذكية في الباك إند
    console.log("🔄 جاري المطابقة الذكية مع قاعدة البيانات...");

    const dbClients = await prisma.client.findMany({
      select: { id: true, name: true, idNumber: true },
    });
    const dbOffices = await prisma.intermediaryOffice.findMany({
      select: { id: true, nameAr: true, nameEn: true },
    });
    const dbDistricts = await prisma.riyadhDistrict.findMany({
      select: { id: true, name: true },
    });
    const dbPlans = await prisma.riyadhPlan.findMany({
      select: { id: true, planNumber: true },
    });

    const smartLinkedPermits = await Promise.all(
      validatedPermits.map(async (permit) => {
        const [
          matchedClientId,
          matchedOfficeId,
          matchedDistrictId,
          matchedPlanId,
        ] = await Promise.all([
          findBestMatchAI(permit.ownerName, dbClients, "Client/العميل"),
          findBestMatchAI(
            permit.engineeringOffice,
            dbOffices,
            "Engineering Office/المكتب الهندسي",
          ),
          findBestMatchAI(permit.district, dbDistricts, "District/الحي"),
          findBestMatchAI(permit.planNumber, dbPlans, "Plan Number/المخطط"),
        ]);

        return {
          ...permit,
          linkedClientId: matchedClientId,
          linkedOfficeId: matchedOfficeId,
          linkedDistrictId: matchedDistrictId,
          linkedPlanId: matchedPlanId,
        };
      }),
    );

    res.json({ success: true, data: smartLinkedPermits });
  } catch (error) {
    console.error("🔥 Gemini Analysis Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل تحليل الرخصة بواسطة الذكاء الاصطناعي",
      details: error.message,
    });
  } finally {
    // الحذف المضمون للملفات المؤقتة
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.error("⚠️ فشل في حذف الملف المؤقت:", cleanupError);
      }
    }
  }
};

// جلب جميع الرخص
const getPermits = async (req, res) => {
  try {
    const permits = await prisma.permit.findMany({
      orderBy: { archiveDate: "desc" },
    });
    res.json({ success: true, data: permits });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// إضافة رخصة جديدة
const createPermit = async (req, res) => {
  try {
    const data = req.body;

    let attachmentUrl = null;
    if (req.file) {
      attachmentUrl = `/uploads/permits/${req.file.filename}`;
    }

    const parsedYear = parseInt(data.year);
    const safeYear = isNaN(parsedYear) ? new Date().getFullYear() : parsedYear;

    const parsedLandArea = parseFloat(data.landArea);
    const safeLandArea = isNaN(parsedLandArea) ? null : parsedLandArea;

    const newPermit = await prisma.permit.create({
      data: {
        permitNumber: data.permitNumber || "بدون رقم",
        year: safeYear,
        type: data.type || "غير محدد",
        form: data.form || "غير محدد",
        ownerName: data.ownerName || "بدون اسم",
        idNumber: data.idNumber || "",

        issueDate: data.issueDate || null,
        expiryDate: data.expiryDate || null,

        district: data.district || "",
        sector: data.sector || "",
        plotNumber: data.plotNumber || "",
        planNumber: data.planNumber || "",
        usage: data.usage || "",
        mainUsage: data.mainUsage || "غير محدد",
        subUsage: data.subUsage || "",
        detailedReport: data.detailedReport || null,
        landArea: safeLandArea,
        engineeringOffice: data.engineeringOffice || "",
        source: data.source || "يدوي",
        notes: data.notes || "",
        aiStatus: data.source === "رفع يدوي (AI)" ? "تم التحليل" : "غير مطبق",
        attachmentUrl: attachmentUrl,

        componentsData: data.componentsData || "[]",
        boundariesData: data.boundariesData || "[]",
      },
    });

    res.status(201).json({ success: true, data: newPermit });
  } catch (error) {
    console.error("Create Permit Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// تعديل بيانات الرخصة
const updatePermit = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updateData = {};

    if (data.permitNumber !== undefined)
      updateData.permitNumber = data.permitNumber;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.form !== undefined) updateData.form = data.form;
    if (data.ownerName !== undefined) updateData.ownerName = data.ownerName;
    if (data.idNumber !== undefined) updateData.idNumber = data.idNumber;

    if (data.issueDate !== undefined) updateData.issueDate = data.issueDate;
    if (data.expiryDate !== undefined) updateData.expiryDate = data.expiryDate;

    if (data.district !== undefined) updateData.district = data.district;
    if (data.sector !== undefined) updateData.sector = data.sector;
    if (data.plotNumber !== undefined) updateData.plotNumber = data.plotNumber;
    if (data.planNumber !== undefined) updateData.planNumber = data.planNumber;
    if (data.usage !== undefined) updateData.usage = data.usage;
    if (data.mainUsage !== undefined) updateData.mainUsage = data.mainUsage;
    if (data.subUsage !== undefined) updateData.subUsage = data.subUsage;
    if (data.detailedReport !== undefined)
      updateData.detailedReport = data.detailedReport;

    if (data.linkedTransactionId !== undefined)
      updateData.linkedTransactionId = data.linkedTransactionId;
    if (data.linkedOwnershipId !== undefined)
      updateData.linkedOwnershipId = data.linkedOwnershipId;
    if (data.linkedClientId !== undefined)
      updateData.linkedClientId = data.linkedClientId;
    if (data.linkedOfficeId !== undefined)
      updateData.linkedOfficeId = data.linkedOfficeId;
    if (data.engineeringOffice !== undefined)
      updateData.engineeringOffice = data.engineeringOffice;
    if (data.source !== undefined) updateData.source = data.source;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.aiStatus !== undefined) updateData.aiStatus = data.aiStatus;
    if (data.extraAttachments !== undefined)
      updateData.extraAttachments = data.extraAttachments;

    if (data.year !== undefined) {
      const parsedYear = parseInt(data.year);
      if (!isNaN(parsedYear)) updateData.year = parsedYear;
    }

    if (data.landArea !== undefined) {
      const parsedArea = parseFloat(data.landArea);
      updateData.landArea = isNaN(parsedArea) ? null : parsedArea;
    }

    if (data.componentsData !== undefined)
      updateData.componentsData = data.componentsData;
    if (data.boundariesData !== undefined)
      updateData.boundariesData = data.boundariesData;

    if (req.file) {
      updateData.attachmentUrl = `/uploads/permits/${req.file.filename}`;
    }

    const updatedPermit = await prisma.permit.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, data: updatedPermit });
  } catch (error) {
    console.error("Update Permit Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// حذف رخصة
const deletePermit = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.permit.delete({ where: { id } });
    res.json({ success: true, message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getPermits,
  createPermit,
  updatePermit,
  deletePermit,
  analyzePermitAI,
};

// src/services/permitAiService.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const { z } = require("zod");
const { GoogleGenAI } = require("@google/genai");
const { findBestMatchAI } = require("./aiMatchingService"); // تأكد من مسار الاستيراد
const path = require("path");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 💡 Zod Schema (لضمان نوع البيانات وحمايتها)
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

// دالة المعالجة التي سيستدعيها الـ Worker
const processPermitJob = async (jobData, updateProgress) => {
  const { filePath, mimeType, dbJobId, fixedOffice } = jobData;
  let savedAttachmentUrl = null;

  try {
    await updateProgress(10); // تحديث: جاري القراءة

    // ========================================================
    // 💡 1. نقل وحفظ الملف في المجلد الدائم للرخص قبل التحليل
    // ========================================================
    if (filePath && fs.existsSync(filePath)) {
      // استخراج امتداد الملف (pdf, jpg, png)
      const ext =
        path.extname(filePath) || (mimeType.includes("pdf") ? ".pdf" : ".jpg");
      const fileName = `permit_ai_${Date.now()}${ext}`; // إنشاء اسم فريد
      const targetDir = path.join(__dirname, "../../uploads/permits"); // المجلد الدائم للرخص

      // إنشاء المجلد إذا لم يكن موجوداً
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const targetPath = path.join(targetDir, fileName);
      fs.copyFileSync(filePath, targetPath); // نسخ الملف من المؤقت للدائم
      savedAttachmentUrl = `/uploads/permits/${fileName}`; // هذا هو الرابط الذي سيُحفظ في الداتا بيز
    }

    const fileBuffer = fs.readFileSync(filePath);
    const documentPart = {
      inlineData: {
        data: fileBuffer.toString("base64"),
        mimeType: mimeType,
      },
    };

    // Prompt (التعليمات الموجهة للذكاء الاصطناعي)
    const prompt = `
    أنت نظام استخراج بيانات (Data Extractor) عالي الدقة تعمل لدى أمانة منطقة الرياض.
    أمامك وثيقة رسمية (قد تكون: رخصة بناء، تعديل مخططات، رخصة تسوير، إضافة، أو أي وثيقة بلدية). 
    استخرج البيانات الموجودة فيها حصرياً لملء كائن الـ JSON التالي.

    ⚠️ أمر حاسم (CRITICAL): يجب أن تحتوي المصفوفة "permits" على عنصر واحد على الأقل طالما أن المستند يحتوي على أي بيانات عقارية (رقم رخصة، مالك، قطعة، الخ). يُمنع منعاً باتاً إرجاع مصفوفة فارغة.

    تعليمات صارمة جداً:
    1. اقرأ البيانات من الجداول بدقة، خاصة جدول "الحدود والأبعاد والإرتدادات" وجدول "عرض مكونات البناء".
    2. الأرقام: قم بتحويل أي رقم هندي (١،٢،٣) إلى رقم إنجليزي (1,2,3).
    3. المساحات والأطوال: استخرج الرقم فقط (بدون كتابة حرف 'م' أو 'م2').
    4. لا تخمن أي معلومة. إذا كانت المعلومة غير موجودة في المستند، أرجع null للنصوص أو 0 للأرقام.
    5. التقرير (detailedReport): اكتب 3 أسطر باللغة العربية تلخص محتوى الرخصة (مثل نوع الطلب المذكور وأهم الشروط).

    يجب أن يكون المخرج حصرياً بصيغة JSON المطابقة للتركيبة التالية:
    {
      "permits": [
        {
          "permitNumber": "رقم الرخصة",
          "issueDate": "تاريخ إصدارها",
          "expiryDate": "تاريخ انتهائها",
          "year": "سنة الإصدار",
          "type": "نوع الطلب أو الرخصة المكتوب (مثال: تعديل مخططات، رخصة بناء)",
          "ownerName": "اسم صاحب الرخصة",
          "idNumber": "رقم الهوية أو السجل التجاري",
          "district": "الحي",
          "sector": "الجهة (مثال: قطاع وسط مدينة الرياض)",
          "plotNumber": "رقم قطعة الأرض",
          "planNumber": "رقم المخطط",
          "mainUsage": "التصنيف الرئيسي (مثال: تجاري)",
          "subUsage": "التصنيف الفرعي",
          "landArea": 0,
          "engineeringOffice": "المكتب الهندسي المصمم أو المشرف",
          "notes": "الملاحظات والشروط المكتوبة أسفل الرخصة",
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

    const fallbackModels = [
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ];

    let response = null;
    await updateProgress(30); // تحديث: جاري الاتصال بـ Gemini

    for (const modelName of fallbackModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: [prompt, documentPart],
          config: { temperature: 0.0, responseMimeType: "application/json" },
        });
        break;
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!response) throw new Error("فشل الاتصال بجميع نماذج الذكاء الاصطناعي.");

    await updateProgress(60); // تحديث: تم استلام البيانات

    let cleanedContent = response.text.replace(/[٠-٩]/g, (d) =>
      "٠١٢٣٤٥٦٧٨٩".indexOf(d),
    );
    const parsedData = JSON.parse(cleanedContent);
    let rawPermits = parsedData.permits || [];
    const validatedPermits = rawPermits.map((permit) =>
      PermitSchema.parse(permit),
    );

    await updateProgress(80); // تحديث: جاري المطابقة الذكية والدمج

    // جلب البيانات للمطابقة
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

    // ========================================================
    // 💡 2. نظام الدمج (Smart Merging) وتجهيز السجلات
    // ========================================================
    const finalResults = [];

    for (const permit of validatedPermits) {
      const parsedYear = parseInt(permit.year);
      const validYear = isNaN(parsedYear) ? null : parsedYear;

      const finalOfficeName = fixedOffice
        ? fixedOffice
        : permit.engineeringOffice;

      const [
        matchedClientId,
        matchedOfficeId,
        matchedDistrictId,
        matchedPlanId,
      ] = await Promise.all([
        findBestMatchAI(permit.ownerName, dbClients, "Client/العميل"),
        findBestMatchAI(
          finalOfficeName,
          dbOffices,
          "Engineering Office/المكتب الهندسي",
        ),
        findBestMatchAI(permit.district, dbDistricts, "District/الحي"),
        findBestMatchAI(permit.planNumber, dbPlans, "Plan Number/المخطط"),
      ]);

      const existingPermit = await prisma.permit.findFirst({
        where: {
          OR: [
            { permitNumber: permit.permitNumber },
            { idNumber: permit.idNumber, planNumber: permit.planNumber },
          ],
          NOT: { permitNumber: "" },
        },
      });

      const permitData = {
        ...permit,
        permitNumber: permit.permitNumber || "بدون رقم",
        ownerName: permit.ownerName || "بدون اسم",
        notes: permit.notes || "",
        attachmentUrl: savedAttachmentUrl,
        year: validYear,
        componentsData: permit.componentsData,
        boundariesData: permit.boundariesData,
        linkedClientId: matchedClientId,
        engineeringOffice: finalOfficeName,
        linkedOfficeId: matchedOfficeId,
        district: matchedDistrictId || permit.district,
        planNumber: matchedPlanId || permit.planNumber,
        source: "رفع يدوي (AI)",
        aiStatus: existingPermit ? "مكرر - بانتظار الدمج" : "تم التحليل",
        aiJobId: dbJobId,
      };

      // 🛑 تنفيذ الحفظ التلقائي فقط إذا كانت النية واضحة من الفرونت إند
      if (jobData.processingMode === "BACKGROUND") {
        const newPermit = await prisma.permit.create({
          data: {
            ...permitData,
            componentsData: JSON.stringify(permitData.componentsData),
            boundariesData: JSON.stringify(permitData.boundariesData),
          },
        });
        finalResults.push(newPermit);
      } else {
        // في وضع المراجعة، نعيد الكائن فقط
        finalResults.push(permitData);
      }
    }

    await updateProgress(100);

    // 🚀 Enterprise Pattern: إرجاع كائن يصف الحالة بوضوح وليس مجرد داتا
    return {
      status:
        jobData.processingMode === "BACKGROUND" ? "AUTO_SAVED" : "NEEDS_REVIEW",
      data: finalResults,
    };
  } finally {
    // 🧹 تنظيف الملف المؤقت فقط (النسخة الدائمة أصبحت في مجلد الرخص بأمان)
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error("فشل حذف الملف المؤقت:", e);
      }
    }
  }
};

module.exports = { processPermitJob };

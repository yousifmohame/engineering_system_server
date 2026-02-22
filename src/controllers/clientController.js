// server/src/controllers/clientController.js

const { OpenAI } = require("openai");
const { fromBuffer } = require("pdf2pic");
const { PDFDocument } = require("pdf-lib");
const prisma = require("../utils/prisma");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ==================================================
// 1. الدوال المساعدة (Helpers)
// ==================================================

// دالة مساعدة لحساب الاسم الكامل
const getFullName = (name) => {
  if (!name) return "";

  // حالة 1: الاسم نص عادي
  if (typeof name === "string") return name;

  // حالة 2: الاسم مخزن بصيغة { ar: "...", en: "..." } (النموذج السريع)
  if (name.ar) return name.ar;

  // حالة 3: الاسم مجزأ { firstName, familyName... }
  const parts = [
    name.firstName,
    name.fatherName,
    name.grandFatherName,
    name.familyName,
  ];

  // دمج الأجزاء الموجودة فقط
  const fullName = parts.filter(Boolean).join(" ").trim();

  // إذا فشل كل شيء، نرجع نص فارغ أو الاسم الانجليزي إن وجد
  return fullName || name.en || "";
};

// دالة حساب نسبة اكتمال الملف (من ملفك الأصلي)
const calculateCompletionPercentage = (client) => {
  let completedFields = 0;
  const totalFields = 11; // العدد الإجمالي للحقول التي تتبعها

  if (client.name?.firstName && client.name?.familyName) completedFields++;
  if (client.type) completedFields++;
  if (client.nationality) completedFields++;
  if (client.category) completedFields++;
  if (client.rating) completedFields++;
  if (client.contact?.mobile) completedFields++; // mobile موجود في contact
  if (client.contact?.email) completedFields++; // email موجود في contact
  if (client.address?.city && client.address?.district) completedFields++;
  if (client.identification?.idNumber && client.identification?.idType)
    completedFields++;
  if (client.occupation) completedFields++;
  if (client.notes) completedFields++;

  return (completedFields / totalFields) * 100;
};

// معايير التقييم (من ملفك الأصلي)
const gradingCriteria = {
  totalFeesWeight: 0.3,
  projectTypesWeight: 0.2,
  transactionTypesWeight: 0.15,
  completionRateWeight: 0.2,
  secretRatingWeight: 0.15,
};

// حدود الدرجات (من ملفك الأصلي)
const gradeThresholds = {
  gradeA: { min: 80, max: 100 },
  gradeB: { min: 60, max: 79 },
  gradeC: { min: 0, max: 59 },
};

// دالة حساب الدرجة (من ملفك الأصلي - مع تعديل بسيط)
const calculateClientGrade = (client, completionPercentage) => {
  let totalScore = 0;

  // نفترض أن هذه الحقول قد لا تكون موجودة في req.body عند الإنشاء
  const totalFees = client.totalFees || 0;
  const projectTypes = client.projectTypes || [];
  const transactionTypes = client.transactionTypes || [];
  const totalTransactions = client.totalTransactions || 0;
  const completedTransactions = client.completedTransactions || 0;
  const secretRating = client.secretRating || 50;

  const feesScore = Math.min(100, (totalFees / 500000) * 100);
  totalScore += feesScore * gradingCriteria.totalFeesWeight;

  const uniqueProjectTypes = new Set(projectTypes);
  const projectTypesScore = Math.min(100, (uniqueProjectTypes.size / 5) * 100);
  totalScore += projectTypesScore * gradingCriteria.projectTypesWeight;

  const uniqueTransactionTypes = new Set(transactionTypes);
  const transactionTypesScore = Math.min(
    100,
    (uniqueTransactionTypes.size / 8) * 100,
  );
  totalScore += transactionTypesScore * gradingCriteria.transactionTypesWeight;

  const completionRate =
    totalTransactions > 0
      ? (completedTransactions / totalTransactions) * 100
      : 0;
  totalScore += completionRate * gradingCriteria.completionRateWeight;

  totalScore += (secretRating / 100) * gradingCriteria.secretRatingWeight;

  const score = Math.round(Math.min(100, totalScore)); // تأكيد أن النتيجة لا تتجاوز 100
  let grade = "ج";
  if (score >= gradeThresholds.gradeA.min) {
    grade = "أ";
  } else if (score >= gradeThresholds.gradeB.min) {
    grade = "ب";
  }
  return { grade, score };
};

// ✅✅✅ دالة جديدة لتوليد كود العميل ✅✅✅
const generateNextClientCode = async () => {
  const year = new Date().getFullYear();
  const prefix = `CLT-${year}-`; // النسق المطلوب

  const lastClient = await prisma.client.findFirst({
    where: {
      clientCode: {
        startsWith: prefix,
      },
    },
    orderBy: {
      clientCode: "desc",
    },
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
  return `${prefix}${paddedNumber}`; // CLT-2025-001
};

// ==================================================
// 2. دوال الـ API (Controllers)
// ==================================================

// جلب جميع العملاء
// جلب جميع العملاء (مُحدث لدعم جلب المرفقات عند الحاجة)
const getAllClients = async (req, res) => {
  try {
    // 1. استلام includeAttachments من الـ query
    const { search, limit, includeAttachments } = req.query;
    const where = {};

    if (search) {
      where.OR = [
        { mobile: { contains: search } },
        { idNumber: { contains: search } },
        { clientCode: { contains: search } },
        { name: { path: ["ar"], string_contains: search } },
        { name: { path: ["firstName"], string_contains: search } },
        { name: { path: ["familyName"], string_contains: search } },
      ];
    }

    const clients = await prisma.client.findMany({
      where,
      take: limit ? parseInt(limit) : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        transactions: { select: { id: true } },
        // 2. الشرط الجديد: جلب المرفقات فقط إذا كانت includeAttachments تساوي 'true'
        ...(includeAttachments === "true" && {
          attachments: true,
        }),
      },
    });

    res.json(clients);
  } catch (error) {
    console.error("Get Clients Error:", error);
    res.json([]);
  }
};

// 2. إنشاء عميل جديد
const createClient = async (req, res) => {
  try {
    let {
      mobile,
      email,
      idNumber,
      name,
      nameAr,
      contact,
      address,
      identification,
      type,
      category,
      nationality,
      occupation,
      company,
      taxNumber,
      rating,
      secretRating,
      notes,
      isActive,
      attachments, // 👈 إضافة استقبال المرفقات
      profilePictureBase64, // 👈 إضافة استقبال الصورة الشخصية
    } = req.body;

    // تحسين منطق الاسم
    if (!name) {
      if (nameAr) name = { ar: nameAr, en: nameAr };
      else return res.status(400).json({ message: "اسم العميل مطلوب" });
    }

    if (!mobile || !idNumber || !type) {
      return res
        .status(400)
        .json({ message: "الجوال، رقم الهوية، والنوع مطلوبات" });
    }

    const generatedClientCode = await generateNextClientCode();

    // 👈 حفظ الصورة الشخصية داخل الـ contact JSON (بما أنه لا يوجد حقل مخصص لها في الـ DB)
    const finalContact = contact || { mobile, email };
    if (profilePictureBase64) {
      finalContact.profilePicture = profilePictureBase64;
    }

    const finalIdentification = identification || {
      idNumber,
      type: "NationalID",
    };

    const completionPercentage = calculateCompletionPercentage({
      ...req.body,
      name,
    });

    let uploaderId = req.user?.id;

    // (حماية إضافية): إذا لم يكن هناك مستخدم مسجل الدخول، نجلب أي موظف من القاعدة لتجنب الخطأ
    if (!uploaderId && attachments && attachments.length > 0) {
      const defaultEmployee = await prisma.employee.findFirst();
      if (defaultEmployee) {
        uploaderId = defaultEmployee.id;
      } else {
        return res.status(400).json({
          message: "يجب وجود موظف واحد على الأقل في النظام لرفع المرفقات",
        });
      }
    }

    // ==========================================
    // 2. تجهيز المرفقات لـ Prisma وتعبئة كل الحقول الإجبارية
    // ==========================================
    const attachmentsData =
      attachments && attachments.length > 0
        ? {
            create: attachments.map((doc, index) => ({
              fileName: doc.name || "مستند بدون اسم",

              // نضع مسار فريد وهمي لتجنب خطأ الـ @unique (لا تضع الـ Base64 هنا لأنه سيسبب Crash للـ DB)
              filePath: `/uploads/clients/temp_${Date.now()}_${index}_${Math.floor(Math.random() * 1000)}`,

              fileType: doc.type || "عام",
              fileSize: doc.size ? parseInt(doc.size) : 0,
              uploadedById: uploaderId, // ربط الملف بالموظف
            })),
          }
        : undefined;

    const newClient = await prisma.client.create({
      data: {
        clientCode: generatedClientCode,
        mobile,
        email,
        idNumber,
        name,
        contact: finalContact,
        address: address || {},
        identification: finalIdentification,
        type,
        category,
        nationality,
        occupation,
        company,
        taxNumber,
        rating,
        secretRating,
        notes,
        isActive: isActive ?? true,
        completionPercentage,
        grade: "ج",
        gradeScore: 0,

        // 👈 ربط وإنشاء المرفقات في نفس خطوة إنشاء العميل
        ...(attachmentsData && { attachments: attachmentsData }),
      },
    });

    res.status(201).json({ success: true, data: newClient });
  } catch (error) {
    if (error.code === "P2002") {
      return res
        .status(400)
        .json({ message: "البيانات (الجوال أو الهوية) مسجلة مسبقاً." });
    }
    console.error("Create Client Error:", error);
    res.status(500).json({ message: "فشل الإنشاء", error: error.message });
  }
};

// تحديث عميل
// تحديث عميل
const updateClient = async (req, res) => {
  const { id: clientId } = req.params;
  try {
    // 1. جلب البيانات الحالية للعميل من قاعدة البيانات
    const existingClient = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        transactions: true, // نحتاج المعاملات لحساب الدرجة بدقة
      },
    });

    if (!existingClient) {
      return res.status(404).json({ message: "لم يتم العثور على العميل" });
    }

    // 2. دمج البيانات الجديدة مع البيانات القديمة
    const mergedData = {
      ...existingClient,
      ...req.body,
      name: req.body.name || existingClient.name,
      contact: req.body.contact
        ? { ...existingClient.contact, ...req.body.contact }
        : existingClient.contact,
      address: req.body.address
        ? { ...existingClient.address, ...req.body.address }
        : existingClient.address,
      identification: req.body.identification
        ? { ...existingClient.identification, ...req.body.identification }
        : existingClient.identification,
    };

    // 3. إعادة حساب النسبة والدرجة التلقائية
    const completionPercentage = calculateCompletionPercentage(mergedData);
    const gradeInfo = calculateClientGrade(mergedData, completionPercentage);

    // ✅ إعطاء الأولوية للتقييم المرسل يدوياً، وإلا استخدم المحسوب آلياً
    const finalGrade =
      req.body.grade !== undefined ? req.body.grade : gradeInfo.grade;

    // 4. تنفيذ التحديث
    const updatedClient = await prisma.client.update({
      where: { id: clientId },
      data: {
        mobile: req.body.mobile,
        email: req.body.email,
        idNumber: req.body.idNumber,
        type: req.body.type,
        category: req.body.category,
        nationality: req.body.nationality,
        occupation: req.body.occupation,
        company: req.body.company,
        taxNumber: req.body.taxNumber,
        rating: req.body.rating,
        secretRating: req.body.secretRating,
        notes: req.body.notes,
        isActive: req.body.isActive,

        // ✅ إضافة مستوى المخاطرة ليتم حفظه في قاعدة البيانات
        riskTier: req.body.riskTier,

        name: req.body.name ? req.body.name : undefined,
        contact: req.body.contact ? req.body.contact : undefined,
        address: req.body.address ? req.body.address : undefined,
        identification: req.body.identification
          ? req.body.identification
          : undefined,

        completionPercentage,
        grade: finalGrade, // ✅ استخدام التقييم النهائي المدمج
        gradeScore: gradeInfo.score,
      },
      include: {
        // نستخدم include بشكل آمن (تأكد من مطابقة هذه الحقول لما هو موجود في مخططك)
        transactions: { include: { payments: true } },
        contracts: true,
        quotations: true,
        attachments: true,
        ownerships: true, // في حال أضفتها مسبقاً
        activityLogs: {
          include: { performedBy: { select: { id: true, name: true } } },
        },
        _count: {
          select: {
            transactions: true,
            contracts: true,
            quotations: true,
            ownerships: true,
            attachments: true,
          },
        },
      },
    });

    // تسجيل النشاط (Activity Log)
    if (req.user) {
      try {
        await prisma.activityLog.create({
          data: {
            action: "تعديل عميل",
            description: `تم تحديث بيانات العميل "${getFullName(updatedClient.name)}".`,
            category: "تعديل بيانات",
            clientId: updatedClient.id,
            performedById: req.user.id,
          },
        });
      } catch (logError) {
        console.error("Failed to create activity log:", logError);
      }
    }

    res.json(updatedClient);
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(400).json({
        message: "فشل التحديث: تضارب في البيانات",
        error: `البيانات (مثل الجوال أو الإيميل) مستخدمة مسبقاً.`,
      });
    }
    console.error("Error updating client:", error);
    res
      .status(500)
      .json({ message: "فشل في تحديث العميل", error: error.message });
  }
};

// حذف عميل
const deleteClient = async (req, res) => {
  const { id: clientId } = req.params;
  try {
    // اختياري: تسجيل النشاط قبل الحذف
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (client && req.user) {
      await prisma.activityLog.create({
        data: {
          action: "حذف عميل",
          description: `تم حذف العميل "${getFullName(client.name)}" (الكود: ${client.clientCode}).`,
          category: "حذف",
          clientId: client.id,
          performedById: req.user.id,
        },
      });
    }

    await prisma.client.delete({
      where: { id: clientId },
    });

    res.status(200).json({ message: "تم حذف العميل بنجاح" });
  } catch (error) {
    console.error("Error deleting client:", error);
    res
      .status(500)
      .json({ message: "فشل في حذف العميل", error: error.message });
  }
};

// جلب عميل واحد
// ==================================================
// جلب عميل واحد (نسخة آمنة 100%)
// ==================================================
const getClientById = async (req, res) => {
  const { id: clientId } = req.params;
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        // جلب العلاقات الأساسية
        transactions: { include: { payments: true } },
        contracts: true,
        quotations: true,
        attachments: true,
        ownerships: true, // ✅ جلب الملكيات (الصكوك)

        // جلب سجل النشاط (بدون ترتيب لتجنب أخطاء حقل التاريخ)
        activityLogs: {
          include: { performedBy: { select: { id: true, name: true } } },
        },

        // عدّاد العلاقات للإحصائيات السريعة
        _count: {
          select: {
            transactions: true,
            contracts: true,
            quotations: true,
            ownerships: true, // ✅ عد الملكيات
            attachments: true, // ✅ عد الوثائق
          },
        },
      },
    });

    if (client) {
      res.json(client);
    } else {
      res.status(404).json({ message: "لم يتم العثور على العميل" });
    }
  } catch (error) {
    // 🔴 هذه الأسطر ستطبع الخطأ الدقيق في شاشة الـ Terminal لديك في الباك إند
    console.error("🔥 Prisma Error in getClientById:", error.message);
    res
      .status(500)
      .json({ message: "فشل في جلب العميل", error: error.message });
  }
};

// ==================================================
// ✅ 3. دالة لجلب قائمة عملاء خفيفة (Dropdowns)
// ==================================================
const getSimpleClients = async (req, res) => {
  try {
    const { search } = req.query;
    const where = { isActive: true };

    if (search) {
      where.OR = [
        { mobile: { contains: search } },
        { idNumber: { contains: search } },
        { name: { path: ["ar"], string_contains: search } },
        { name: { path: ["firstName"], string_contains: search } },
      ];
    }

    const clients = await prisma.client.findMany({
      select: {
        id: true,
        name: true,
        clientCode: true,
        mobile: true,
        idNumber: true,
      },
      where,
      orderBy: { clientCode: "asc" },
      take: 50,
    });

    const simpleList = clients.map((client) => {
      // ✅ استخدام الدالة المحدثة لضمان عدم عودة نص فارغ
      const fullName = getFullName(client.name);

      return {
        id: client.id,
        name: `${fullName} (${client.clientCode})`, // الاسم للعرض في القائمة
        // بيانات إضافية قد تحتاجها الواجهة
        clientCode: client.clientCode,
        mobile: client.mobile,
        idNumber: client.idNumber,
        fullNameRaw: fullName,
      };
    });

    res.json(simpleList);
  } catch (error) {
    console.error("Simple Clients Error:", error);
    res.status(500).json({ message: "فشل الجلب", error: error.message });
  }
};

const analyzeIdentityImage = async (req, res) => {
  console.log("==========================================");
  console.log("🚀 [START] analyzeIdentityImage request received");
  console.log("📦 [HEADERS]: Content-Type =", req.headers['content-type']);
  console.log("📦 [BODY KEYS]:", Object.keys(req.body)); // لنرى إذا كان Express قد قرأ الـ Body أصلاً
  console.log("==========================================");

  try {
    // 1. استقبال البيانات (ندعم كلا الاسمين تجنباً لأي خطأ من الواجهة)
    const base64DataInput = req.body.imageBase64 || req.body.base64Image;
    const documentType = req.body.documentType;

    console.log("📄 Document Type:", documentType);

    if (!base64DataInput) {
      console.warn("⚠️ [VALIDATION FAILED]: No image base64 data found in req.body!");
      console.log("💡 تلميح: إذا كانت المصفوفة [BODY KEYS] فارغة، فهذا يعني أن حجم الملف تجاوز الحد المسموح به في Express أو Nginx.");
      return res.status(400).json({ success: false, message: "لم يتم إرسال أي وثيقة (أو حجم الملف كبير جداً)" });
    }

    console.log(`✅ Base64 string received. Length: ${base64DataInput.length} characters.`);

    // 2. استخراج الـ MIME Type بأمان
    const mimeTypeMatch = base64DataInput.match(/^data:(.*?);base64,/);
    if (!mimeTypeMatch) {
        console.warn("⚠️ [VALIDATION FAILED]: Invalid Base64 format!");
        return res.status(400).json({ success: false, message: "صيغة الملف غير صالحة" });
    }
    
    const mimeType = mimeTypeMatch[1];
    console.log(`🔍 Detected MIME Type: ${mimeType}`);

    const cleanBase64 = base64DataInput.replace(/^data:.*?;base64,/, "");
    const fileBuffer = Buffer.from(cleanBase64, "base64");
    console.log(`📦 Buffer created successfully. Size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);

    let imagesToSend = [];

    // ==========================================
    // 1. معالجة الـ PDF (الأسلوب المؤسسي)
    // ==========================================
    if (mimeType === "application/pdf") {
      console.log("📚 Processing PDF file...");
      try {
        const pdfDoc = await PDFDocument.load(fileBuffer);
        const totalPages = pdfDoc.getPageCount();
        const pagesToProcess = Math.min(totalPages, 2);

        console.log(`🚀 PDF loaded. Total pages: ${totalPages}. Processing ${pagesToProcess} pages...`);

        const options = {
          density: 150,
          format: "jpeg",
          width: 1240,
          height: 1754,
        };

        const convert = fromBuffer(fileBuffer, options);

        for (let i = 1; i <= pagesToProcess; i++) {
          console.log(`📸 Converting PDF page ${i} to image...`);
          const image = await convert(i, { responseType: "base64" });
          imagesToSend.push(`data:image/jpeg;base64,${image.base64}`);
          console.log(`✅ Page ${i} converted successfully.`);
        }
      } catch (pdfError) {
        console.error("🔥 [PDF ERROR]:", pdfError.message);
        throw new Error("فشل في معالجة الـ PDF. هل مكتبة Ghostscript مثبتة على السيرفر؟");
      }
    }
    // ==========================================
    // 2. معالجة الصور المباشرة
    // ==========================================
    else if (mimeType.startsWith("image/")) {
      console.log("🖼️ Processing direct image file...");
      imagesToSend.push(base64DataInput);
    } else {
      console.warn(`⚠️ Unsupported MIME Type: ${mimeType}`);
      return res.status(400).json({
        success: false,
        message: `نوع الملف غير مدعوم (${mimeType}). يرجى رفع PDF أو صورة.`,
      });
    }

    // ==========================================
    // 3. إرسال البيانات للذكاء الاصطناعي
    // ==========================================
    console.log(`🧠 Sending ${imagesToSend.length} images to OpenAI for analysis...`);
    
    const prompt = `
    أنت خبير في قراءة الوثائق الرسمية السعودية (هوية وطنية، إقامة، سجل تجاري، جواز سفر، شهادة رقم موحد).
    مهمتك قراءة الصورة/الصور المرفقة واستخراج البيانات بدقة متناهية وإعادتها كـ JSON صالح 100%.

    نوع الوثيقة المتوقع: ${documentType || "غير محدد"}

    القواعد:
    - إذا كانت الوثيقة "سجل تجاري" أو "شركة": ضع اسم الشركة بالكامل في "firstAr" واترك باقي أجزاء الاسم فارغة.
    - إذا كانت "هوية" أو "إقامة": قم بتفكيك الاسم إلى 4 أجزاء (أول، أب، جد، عائلة) بالعربية والإنجليزية إن وجد.
    - إذا لم تجد المعلومة، أرجع نصاً فارغاً "".

    التركيبة المطلوبة للـ JSON:
    {
      "firstAr": "الاسم الأول بالعربية (أو اسم الشركة كاملاً)",
      "fatherAr": "اسم الأب بالعربية",
      "grandAr": "اسم الجد بالعربية",
      "familyAr": "اسم العائلة بالعربية",
      "firstEn": "First Name",
      "fatherEn": "Father Name",
      "grandEn": "Grandfather Name",
      "familyEn": "Family Name",
      "idNumber": "رقم الهوية أو الإقامة أو السجل التجاري (أرقام فقط)",
      "birthDate": "تاريخ الميلاد (هجري أو ميلادي حسب الموجود)",
      "nationality": "الجنسية",
      "confidence": نسبة دقة الاستخراج من 0 إلى 100 (Number)
    }
    `;

    const contentArray = [{ type: "text", text: prompt }];
    imagesToSend.forEach((imgUrl) => {
      contentArray.push({
        type: "image_url",
        image_url: { url: imgUrl, detail: "high" },
      });
    });

    console.log("⏳ Waiting for OpenAI response...");
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: contentArray }],
      response_format: { type: "json_object" },
      temperature: 0.0,
    });

    const parsedData = JSON.parse(response.choices[0].message.content);
    console.log("✅ OpenAI Analysis Successful!");
    console.log("📋 Extracted Data:", parsedData);

    res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("🔥 [FATAL ERROR] AI Analysis Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل تحليل الوثيقة بالذكاء الاصطناعي",
      details: error.message,
    });
  }
};

// أضف هذه الدالة في clientController.js

const analyzeAddressDocument = async (req, res) => {
  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرسال أي وثيقة" });
    }

    const mimeType = imageBase64.substring(
      imageBase64.indexOf(":") + 1,
      imageBase64.indexOf(";"),
    );
    const base64Data = imageBase64.split(",")[1];
    const fileBuffer = Buffer.from(base64Data, "base64");

    let imagesToSend = [];

    // معالجة الـ PDF
    if (mimeType === "application/pdf") {
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const totalPages = pdfDoc.getPageCount();
      const pagesToProcess = Math.min(totalPages, 2); // عادة وثيقة العنوان صفحة واحدة

      const options = {
        density: 150,
        format: "jpeg",
        width: 1240,
        height: 1754,
      };
      const convert = fromBuffer(fileBuffer, options);

      for (let i = 1; i <= pagesToProcess; i++) {
        const image = await convert(i, { responseType: "base64" });
        imagesToSend.push(`data:image/jpeg;base64,${image.base64}`);
      }
    }
    // معالجة الصور
    else if (mimeType.startsWith("image/")) {
      imagesToSend.push(imageBase64);
    } else {
      return res
        .status(400)
        .json({ success: false, message: "نوع الملف غير مدعوم." });
    }

    const prompt = `
    أنت خبير في قراءة وثيقة "العنوان الوطني" السعودي (National Address) الصادرة من سبل (البريد السعودي).
    استخرج البيانات التالية بدقة متناهية وأعدها كـ JSON.

    القواعد:
    - رقم المبنى: يتكون من 4 أرقام.
    - الرقم الإضافي: يتكون من 4 أرقام.
    - الرمز البريدي: يتكون من 5 أرقام.
    - الرمز المختصر: يتكون من 8 خانات (مثال: RRAM3456).
    - إذا لم تجد المعلومة أرجع نصاً فارغاً "".

    التركيبة المطلوبة للـ JSON:
    {
      "city": "المدينة (مثال: الرياض)",
      "district": "الحي (مثال: العليا)",
      "street": "اسم الشارع",
      "buildingNo": "رقم المبنى",
      "unitNo": "رقم الوحدة (إن وجد)",
      "zipCode": "الرمز البريدي",
      "additionalNo": "الرقم الإضافي",
      "shortCodeAr": "الرمز المختصر باللغة العربية إن وجد",
      "shortCodeEn": "الرمز المختصر باللغة الإنجليزية إن وجد"
    }
    `;

    const contentArray = [{ type: "text", text: prompt }];
    imagesToSend.forEach((imgUrl) => {
      contentArray.push({
        type: "image_url",
        image_url: { url: imgUrl, detail: "high" },
      });
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: contentArray }],
      response_format: { type: "json_object" },
      temperature: 0.0,
    });

    const parsedData = JSON.parse(response.choices[0].message.content);
    console.log("✅ تم تحليل وثيقة العنوان بنجاح!", parsedData);

    res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("Address Analysis Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل تحليل وثيقة العنوان",
      details: error.message,
    });
  }
};

module.exports = {
  getAllClients,
  createClient,
  updateClient,
  deleteClient,
  getClientById,
  getSimpleClients,
  analyzeIdentityImage,
  analyzeAddressDocument,
};

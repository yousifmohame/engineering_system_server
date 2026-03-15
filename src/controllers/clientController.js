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

// ===============================================
// التحقق من وجود رقم الهوية مسبقاً
// GET /api/clients/check-id?idNumber=10XXXXXXX
// ===============================================
const checkClientId = async (req, res) => {
  try {
    const { idNumber } = req.query;
    if (!idNumber) return res.status(400).json({ message: "رقم الهوية مطلوب" });

    const existingClient = await prisma.client.findUnique({
      where: { idNumber },
    });

    if (existingClient) {
      // إرجاع اسم العميل المسجل لتنبيه المستخدم
      const clientName =
        existingClient.officialNameAr || existingClient.name?.ar || "عميل مسجل";
      return res.json({ exists: true, clientName });
    }

    return res.json({ exists: false });
  } catch (error) {
    console.error("Check ID Error:", error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// لا تنسَ تصديرها وإضافتها في clientRoutes.js
// router.get('/check-id', checkClientId);

// ==================================================
// جلب جميع العملاء (مُحدث ليتوافق مع ClientsLog)
// ==================================================
const getAllClients = async (req, res) => {
  try {
    const { search } = req.query; // 💡 تم إزالة الـ limit
    const where = {};

    // فلترة البحث من الباك إند (تعمل جنباً إلى جنب مع بحث الفرونت إند)
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
      // 💡 تم إزالة حقل take ليجلب العدد الكامل للعملاء
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            transactions: true,
            attachments: true,
          },
        },
      },
    });

    res.json(clients);
  } catch (error) {
    console.error("Get Clients Error:", error);
    res.status(500).json([]);
  }
};

// ===============================================
// 2. إنشاء عميل جديد (موحد وشامل لكل البيانات والصور)
// POST /api/clients
// ===============================================
const createClient = async (req, res) => {
  try {
    // 1. استخراج البيانات النصية من req.body (شاملة الورثة)
    let {
      mobile,
      email,
      idNumber,
      type,
      officialNameAr,
      name,
      contact,
      address,
      identification,
      isActive,
      category,
      nationality,
      occupation,
      company,
      taxNumber,
      rating,
      secretRating,
      notes,
      representative,
      heirs, // 👈 1. إضافة استخراج الورثة
    } = req.body;

    if (mobile === "غير متوفر") {
      mobile = `غير متوفر-${Date.now()}`;
    }

    // 2. تحويل البيانات المتداخلة من نص (String) إلى كائنات (Objects)
    const parsedName = name
      ? JSON.parse(name)
      : { ar: officialNameAr || "غير محدد" };
    const parsedContact = contact ? JSON.parse(contact) : { mobile, email };
    const parsedAddress = address ? JSON.parse(address) : {};
    const parsedIdentification = identification
      ? JSON.parse(identification)
      : { idNumber, type: "NationalID" };
    const parsedRepresentative = representative
      ? JSON.parse(representative)
      : null;
    const parsedHeirs = heirs ? JSON.parse(heirs) : null; // 👈 2. تحليل بيانات الورثة

    if (!mobile || !idNumber || !type) {
      return res
        .status(400)
        .json({ message: "الجوال، رقم الهوية، والنوع مطلوبات" });
    }

    const generatedClientCode = await generateNextClientCode();
    // تأكد من تحديث دالة حساب النسبة لتشمل الورثة إن أردت
    const completionPercentage = calculateCompletionPercentage({
      ...req.body,
      name: parsedName,
    });

    let uploaderId = req.user?.id;
    if (!uploaderId && req.files) {
      const defaultEmployee = await prisma.employee.findFirst();
      uploaderId = defaultEmployee?.id;
    }

    // ==========================================
    // 3. الفرز الذكي للملفات (الصورة الشخصية vs المرفقات العامة)
    // ==========================================
    let profilePicPath = null;
    let generalAttachments = [];

    // يعتمد هذا على طريقة إعداد Multer في الـ Routes (يفضل استخدام upload.any() للتعامل مع هذا)
    if (req.files) {
      // إذا كان Multer يرجع مصفوفة (upload.any)
      if (Array.isArray(req.files)) {
        req.files.forEach((file) => {
          if (file.fieldname === "profilePicture") {
            profilePicPath = `/uploads/clients/${file.filename}`; // 👈 عزل الصورة الشخصية
          } else if (file.fieldname === "files") {
            generalAttachments.push(file); // 👈 تجميع باقي الملفات
          }
        });
      }
      // إذا كان Multer يرجع كائن (upload.fields)
      else {
        if (req.files["profilePicture"]) {
          profilePicPath = `/uploads/clients/${req.files["profilePicture"][0].filename}`;
        }
        if (req.files["files"]) {
          generalAttachments = req.files["files"];
        }
      }
    }

    // تجهيز المرفقات العامة للـ Prisma
    let attachmentsData = undefined;
    if (generalAttachments.length > 0) {
      const attachmentsArray = generalAttachments.map((file, index) => {
        const metaType = req.body[`fileMeta_${index}_type`] || "عام";
        const metaName =
          req.body[`fileMeta_${index}_name`] || file.originalname;
        const metaPrivacy = req.body[`fileMeta_${index}_privacy`] || "internal";

        return {
          fileName: metaName,
          filePath: `/uploads/clients/${file.filename}`,
          fileType: file.mimetype,
          fileSize: file.size,
          uploadedById: uploaderId,
          notes: `تصنيف: ${metaType} - السرية: ${metaPrivacy}`,
        };
      });

      attachmentsData = { create: attachmentsArray };
    }
    // 💡 هذا هو الحل السحري لمنع مشكلة تكرار الإيميل الفارغ
    const finalEmail = email && email.trim() !== "" ? email.trim() : null;
    // ==========================================
    // 4. الحفظ في قاعدة البيانات
    // ==========================================
    const newClient = await prisma.client.create({
      data: {
        clientCode: generatedClientCode,
        mobile,
        email: finalEmail,
        idNumber,
        name: parsedName,
        contact: parsedContact,
        address: parsedAddress,
        identification: parsedIdentification, // (تحتوي الآن على العمر، ومكان الميلاد، والتاريخ الهجري والميلادي)
        representative: parsedRepresentative, // (يحتوي على بيانات الوكيل المحللة)
        heirs: parsedHeirs, // 👈 3. حفظ بيانات الورثة كـ JSON في الداتابيز
        profilePicture: profilePicPath, // 👈 4. حفظ مسار الصورة الشخصية/الشعار
        type,
        category,
        nationality,
        occupation,
        company,
        taxNumber,
        rating,
        secretRating: secretRating ? parseInt(secretRating) : null,
        notes,
        isActive: isActive === "true" || isActive === true,
        completionPercentage,
        grade: "ج",
        gradeScore: 0,

        // ربط المرفقات في حال وجودها
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
// ===============================================
// تحديث عميل
// ===============================================
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

    // إعطاء الأولوية للتقييم المرسل يدوياً، وإلا استخدم المحسوب آلياً
    const finalGrade =
      req.body.grade !== undefined ? req.body.grade : gradeInfo.grade;

    // 💡 الحل السحري: تنظيف الإيميل والجوال لمنع التضارب (Unique Constraint)
    const finalEmail =
      req.body.email && req.body.email.trim() !== ""
        ? req.body.email.trim()
        : null;

    // 4. تنفيذ التحديث
    const updatedClient = await prisma.client.update({
      where: { id: clientId },
      data: {
        mobile: req.body.mobile,
        email: finalEmail, // 👈 استخدام الإيميل المعالج هنا
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
        riskTier: req.body.riskTier,

        name: req.body.name ? req.body.name : undefined,
        contact: req.body.contact ? req.body.contact : undefined,
        address: req.body.address ? req.body.address : undefined,
        identification: req.body.identification
          ? req.body.identification
          : undefined,

        completionPercentage,
        grade: finalGrade,
        gradeScore: gradeInfo.score,
      },
      include: {
        transactions: { include: { payments: true } },
        contracts: true,
        quotations: true,
        attachments: true,
        ownerships: true,
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
    // 💡 اصطياد الخطأ بشكل ذكي لمعرفة الحقل المتضارب بالضبط
    if (error.code === "P2002") {
      const target = error.meta?.target || [];
      let fieldName = "بيانات معينة";

      if (target.includes("mobile")) fieldName = "رقم الجوال";
      else if (target.includes("idNumber")) fieldName = "رقم الهوية";
      else if (target.includes("email")) fieldName = "البريد الإلكتروني";

      return res.status(400).json({
        message: `فشل التحديث: ${fieldName} مستخدم بالفعل`,
        error: `عذراً، ${fieldName} الذي أدخلته مسجل مسبقاً لعميل آخر.`,
      });
    }
    console.error("Error updating client:", error);
    res
      .status(500)
      .json({ message: "فشل في تحديث العميل", error: error.message });
  }
};

// حذف عميل
// ===============================================
// حذف عميل
// DELETE /api/clients/:id
// ===============================================
const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    // محاولة الحذف
    await prisma.client.delete({
      where: { id: id },
    });

    res.status(200).json({ success: true, message: "تم حذف العميل بنجاح" });
  } catch (error) {
    console.error("Error deleting client:", error);

    // 👈 اصطياد خطأ ارتباط المفتاح الأجنبي (Foreign Key Constraint)
    // P2003 هو كود Prisma القياسي لهذا الخطأ، ونضيف فحص النص للاحتياط
    if (
      error.code === "P2003" ||
      (error.message && error.message.includes("violates RESTRICT")) ||
      (error.message && error.message.includes("Foreign key constraint"))
    ) {
      return res.status(400).json({
        success: false,
        message:
          "لا يمكن حذف هذا العميل لوجود ارتباطات نشطة به (مثل ملفات ملكية، أو معاملات). يرجى حذف الارتباطات أولاً أو إيقاف حساب العميل بدلاً من حذفه.",
      });
    }

    // أي خطأ آخر
    res.status(500).json({
      success: false,
      message: "حدث خطأ في السيرفر أثناء محاولة الحذف",
      error: error.message,
    });
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
    const where = {};

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
    });

    console.log("🚀 عدد العملاء الذين تم جلبهم للدروب داون:", clients.length);

    const simpleList = clients.map((client) => {
      const fullName = getFullName(client.name);

      return {
        id: client.id,
        name: `${fullName} (${client.clientCode})`,
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
  try {
    const { imageBase64, documentType } = req.body;

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

    // ==========================================
    // 1. معالجة الـ PDF (الأسلوب المؤسسي)
    // ==========================================
    if (mimeType === "application/pdf") {
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const totalPages = pdfDoc.getPageCount();

      // للهويات والسجلات التجارية، نكتفي بأول صفحتين لتوفير التكلفة والوقت
      const pagesToProcess = Math.min(totalPages, 2);

      console.log(
        `🚀 رصد وثيقة عميل PDF. جاري معالجة ${pagesToProcess} صفحة...`,
      );

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
    // ==========================================
    // 2. معالجة الصور المباشرة
    // ==========================================
    else if (mimeType.startsWith("image/")) {
      imagesToSend.push(imageBase64);
    } else {
      return res.status(400).json({
        success: false,
        message: "نوع الملف غير مدعوم. يرجى رفع PDF أو صورة.",
      });
    }

    // ==========================================
    // 3. البرومبت المتخصص لاستخراج بيانات العميل (محدث)
    // ==========================================
    // أضفنا تعليمات صريحة لاستخراج مكان الميلاد، التواريخ، وحساب العمر
    const prompt = `
    أنت خبير في قراءة الوثائق الرسمية السعودية.
    مهمتك قراءة الصورة المرفقة واستخراج البيانات وإعادتها كـ JSON صالح 100%.

    نوع الوثيقة المتوقع: ${documentType || "غير محدد"}

    القواعد:
    1. إذا كانت الوثيقة "سجل تجاري" أو "شركة": ضع اسم الشركة بالكامل في "firstAr" واترك باقي أجزاء الاسم فارغة.
    2. إذا كانت "هوية" أو "إقامة": قم بتفكيك الاسم إلى 4 أجزاء (أول، أب، جد، عائلة).
    3. 🚨 هام جداً (الأسماء الإنجليزية): إذا لم يكن الاسم الإنجليزي مكتوباً في الوثيقة، **يجب عليك كتابته وترجمته حرفياً (Transliteration)** من العربية إلى الإنجليزية بناءً على النطق الصحيح (مثال: محمد -> Mohammed، الغامدي -> Alghamdi). لا تترك حقول firstEn, fatherEn, grandEn, familyEn فارغة أبداً إذا كان الاسم العربي موجوداً.
    4. ابحث عن تاريخ الميلاد. الهوية السعودية تحتوي عادة على الهجري والميلادي.
    5. قم بحساب العمر بالسنوات بناءً على تاريخ الميلاد (أرجع رقم).
    6. إذا لم تجد المعلومة أرجع نصاً فارغاً "". بالنسبة للعمر أرجع null إذا فشلت.

    التركيبة المطلوبة للـ JSON:
    {
      "firstAr": "الاسم الأول بالعربية (أو اسم الشركة كاملاً)",
      "fatherAr": "اسم الأب بالعربية",
      "grandAr": "اسم الجد بالعربية",
      "familyAr": "اسم العائلة بالعربية",
      "firstEn": "First Name (Mandatory)",
      "fatherEn": "Father Name (Mandatory)",
      "grandEn": "Grandfather Name (Mandatory)",
      "familyEn": "Family Name (Mandatory)",
      "idNumber": "رقم الهوية أو الإقامة أو السجل (أرقام فقط)",
      "birthDate": "تاريخ الميلاد الأساسي المكتوب",
      "birthDateHijri": "تاريخ الميلاد بالهجري (مثال: 1405/06/15)",
      "birthDateGregorian": "تاريخ الميلاد بالميلادي بصيغة YYYY-MM-DD",
      "placeOfBirth": "مكان الميلاد",
      "age": عمر الشخص بالسنوات (Number),
      "nationality": "الجنسية",
      "confidence": نسبة دقة الاستخراج (Number)
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
      temperature: 0.0, // صفر لضمان الدقة وعدم التأليف
    });

    const parsedData = JSON.parse(response.choices[0].message.content);

    res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("AI Analysis Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل تحليل الوثيقة بالذكاء الاصطناعي",
      details: error.message,
    });
  }
};

// ==========================================
// استخراج بيانات الوكيل/المفوض والوكالة بالذكاء الاصطناعي
// POST /api/clients/analyze-representative
// ===============================================
const analyzeRepresentative = async (req, res) => {
  try {
    const { imageBase64, docType } = req.body; // docType: "وكالة" أو "هوية"

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

    // معالجة PDF (أول صفحتين كحد أقصى)
    if (mimeType === "application/pdf") {
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const pagesToProcess = Math.min(pdfDoc.getPageCount(), 2);
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
    } else if (mimeType.startsWith("image/")) {
      imagesToSend.push(imageBase64);
    } else {
      return res
        .status(400)
        .json({ success: false, message: "نوع الملف غير مدعوم." });
    }

    // بناء التلقين (Prompt) ذكي بناءً على نوع المستند
    let prompt = "";

    if (docType === "وكالة") {
      prompt = `
      أنت خبير قانوني في قراءة الوكالات الشرعية لوزارة العدل السعودية وخطابات التفويض.
      استخرج البيانات التالية من الوثيقة المرفقة وأعدها كـ JSON صالح 100%:
      1. ابحث عن "رقم الوكالة" أو "رقم التفويض".
      2. ابحث عن "تاريخ الانتهاء". إذا وجدته بالميلادي، حوله لصيغة "YYYY-MM-DD". إذا كان هجري فقط، حوله للميلادي التقريبي بصيغة "YYYY-MM-DD".
      3. ابحث في جدول الأطراف عن الشخص الذي صفته "وكيل". استخرج اسمه و رقم هويته.
      4. لخص "النطاق" و "البنود" في جملة واحدة مختصرة وضعها في powersScope.
      
      التركيبة المطلوبة:
      {
        "authNumber": "رقم الوكالة أو التفويض",
        "authExpiry": "تاريخ الانتهاء بصيغة YYYY-MM-DD (مهم جداً للبرمجة)",
        "agentName": "اسم الوكيل",
        "agentIdNumber": "رقم هوية الوكيل",
        "powersScope": "ملخص نطاق الوكالة والبنود",
        "confidence": نسبة الدقة من 0 إلى 100
      }
      `;
    } else {
      prompt = `
      أنت خبير في قراءة الهوية الوطنية السعودية أو الإقامة.
      استخرج بيانات الوكيل (الاسم ورقم الهوية وتاريخ الانتهاء) وأعدها كـ JSON صالح 100%:
      
      التركيبة المطلوبة:
      {
        "agentName": "الاسم الكامل",
        "agentIdNumber": "رقم الهوية",
        "idExpiry": "تاريخ انتهاء الهوية بصيغة YYYY-MM-DD (إذا لم يوجد اتركها فارغة)",
        "confidence": نسبة الدقة
      }
      `;
    }

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
    res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("Rep Analysis Error:", error);
    res.status(500).json({ success: false, message: "فشل تحليل مستند الممثل" });
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

// ===============================================
// جلب الإحصائيات لداشبورد العملاء
// GET /api/clients/stats
// ===============================================
const getClientStats = async (req, res) => {
  try {
    // جلب جميع العملاء (مع بيانات التقييم إذا احتجت لاحقاً)
    const allClients = await prisma.client.findMany();

    // حساب الإحصائيات
    const stats = {
      totalClients: allClients.length,
      defaulters: 0, // يمكنك ربطها لاحقاً بجدول الدفعات (Payments) أو الحسابات المالية
      missingDocs: 0,
    };

    allClients.forEach((client) => {
      // إذا كان العميل لا يمتلك رقم هوية أو جوال، نعتبر وثائقه ناقصة كمثال
      if (!client.idNumber || !client.mobile) {
        stats.missingDocs++;
      }

      // يمكنك إضافة منطق المتعثرين الماليين هنا (مثلاً إذا كان رصيده بالسالب)
    });

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error("Client Stats Error:", error);
    res.status(500).json({ success: false, message: "خطأ في جلب الإحصائيات" });
  }
};

// ===============================================
// رفع وثيقة جديدة لعميل موجود
// POST /api/clients/:id/documents
// ===============================================
const uploadClientDocument = async (req, res) => {
  try {
    const { id: clientId } = req.params;
    const { name, notes } = req.body;
    const file = req.file;

    // 1. التحقق من وجود العميل
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      return res
        .status(404)
        .json({ success: false, message: "العميل غير موجود" });
    }

    // 2. التحقق من رفع الملف فعلياً
    if (!file) {
      return res
        .status(400)
        .json({ success: false, message: "يرجى إرفاق ملف صالح" });
    }

    // (حماية إضافية): جلب موظف لربط الملف به في حال لم يوجد req.user
    let uploaderId = req.user?.id;
    if (!uploaderId) {
      const defaultEmployee = await prisma.employee.findFirst();
      if (defaultEmployee) {
        uploaderId = defaultEmployee.id;
      } else {
        return res
          .status(400)
          .json({ message: "يجب وجود موظف واحد على الأقل لرفع المرفقات" });
      }
    }

    // 3. إنشاء المرفق في قاعدة البيانات
    const newAttachment = await prisma.attachment.create({
      data: {
        fileName: name || file.originalname,
        filePath: `/uploads/clients/${file.filename}`, // المسار الذي سيتم حفظه فيه بواسطة Multer
        fileType: file.mimetype,
        fileSize: file.size,
        clientId: client.id,
        uploadedById: uploaderId,
        notes: notes || null,
      },
    });

    res.status(201).json({
      success: true,
      message: "تم رفع الوثيقة بنجاح",
      data: newAttachment,
    });
  } catch (error) {
    console.error("Upload Document Error:", error);
    res.status(500).json({ success: false, message: "فشل رفع الوثيقة" });
  }
};

module.exports = {
  getAllClients,
  createClient,
  updateClient,
  deleteClient,
  getClientById,
  getSimpleClients,
  checkClientId,
  analyzeIdentityImage,
  analyzeAddressDocument,
  getClientStats,
  uploadClientDocument,
  analyzeRepresentative,
};

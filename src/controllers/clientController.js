const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
// ==================================================
// 1. الدوال المساعدة (Helpers)
// ==================================================

// دالة مساعدة لحساب الاسم الكامل
const getFullName = (name) => {
  if (!name) return '';
  return `${name.firstName} ${name.fatherName} ${name.grandFatherName} ${name.familyName}`;
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
  if (client.identification?.idNumber && client.identification?.idType) completedFields++;
  if (client.occupation) completedFields++;
  if (client.notes) completedFields++;

  return (completedFields / totalFields) * 100;
};

// معايير التقييم (من ملفك الأصلي)
const gradingCriteria = {
  totalFeesWeight: 0.30,
  projectTypesWeight: 0.20,
  transactionTypesWeight: 0.15,
  completionRateWeight: 0.20,
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
  const transactionTypesScore = Math.min(100, (uniqueTransactionTypes.size / 8) * 100);
  totalScore += transactionTypesScore * gradingCriteria.transactionTypesWeight;

  const completionRate = totalTransactions > 0 ? (completedTransactions / totalTransactions) * 100 : 0;
  totalScore += completionRate * gradingCriteria.completionRateWeight;

  totalScore += (secretRating / 100) * gradingCriteria.secretRatingWeight;
  
  // إضافة نسبة اكتمال الملف كجزء من التقييم (يمكن تعديل الوزن)
  // totalScore += (completionPercentage / 100) * (gradingCriteria.completionRateWeight / 2); // مثال

  const score = Math.round(Math.min(100, totalScore)); // تأكيد أن النتيجة لا تتجاوز 100
  let grade = 'ج';
  if (score >= gradeThresholds.gradeA.min) {
    grade = 'أ';
  } else if (score >= gradeThresholds.gradeB.min) {
    grade = 'ب';
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
      clientCode: 'desc',
    },
  });

  let nextNumber = 1;

  if (lastClient) {
    try {
      const lastNumberStr = lastClient.clientCode.split('-')[2];
      const lastNumber = parseInt(lastNumberStr, 10);
      nextNumber = lastNumber + 1;
    } catch (e) {
      console.error("Failed to parse last client code, defaulting to 1", e);
      nextNumber = 1;
    }
  }

  const paddedNumber = String(nextNumber).padStart(3, '0');
  return `${prefix}${paddedNumber}`; // CLT-2025-001
};


// ==================================================
// 2. دوال الـ API (Controllers)
// ==================================================

// جلب جميع العملاء
const getAllClients = async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      include: {
        transactions: {
          include: {
            payments: true,
          },
        },
        contracts: true,
        quotations: true,
        attachments: true,
        activityLogs: {
          include: {
            performedBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            date: 'desc'
          }
        },
        _count: { // جلب العدد
          select: {
            transactions: true,
            contracts: true,
            quotations: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ message: 'فشل في جلب العملاء', error: error.message });
  }
};

// إنشاء عميل جديد
const createClient = async (req, res) => {
  try {
    const {
      // ❌ 'clientCode' تم إزالته، سيتم توليده
      mobile,
      email,
      idNumber,
      name,
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
    } = req.body;

    // ✅ الفحص المحدث
    if (!mobile || !idNumber || !name || !type) { // ✅ تم إضافة 'type' للفحص
      return res.status(400).json({ message: 'الجوال، رقم الهوية، الاسم، والنوع مطلوبات' });
    }

    // ✅ خطوة 1: توليد الكود
    const generatedClientCode = await generateNextClientCode();

    // خطوة 2: حساب النسبة والدرجة (باستخدام الدوال المحلية)
    const completionPercentage = calculateCompletionPercentage(req.body);
    const gradeInfo = calculateClientGrade(req.body, completionPercentage);

    // خطوة 3: إنشاء العميل
    const newClient = await prisma.client.create({
      data: {
        clientCode: generatedClientCode, // ✅ استخدام الكود المولّد
        mobile,
        email,
        idNumber,
        name,
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
        isActive: isActive ?? true,
        completionPercentage,
        grade: gradeInfo.grade,
        gradeScore: gradeInfo.score,
        // createdBy: req.user.id, // (يمكنك تفعيل هذا السطر)
      },
      include: { // إرجاع نفس البيانات التي يطلبها getAllClients
        transactions: { include: { payments: true } },
        contracts: true,
        quotations: true,
        attachments: true,
        activityLogs: { include: { performedBy: { select: { id: true, name: true } } } },
         _count: {
          select: {
            transactions: true,
            contracts: true,
            quotations: true
          }
        }
      }
    });

    res.status(201).json(newClient);

    // خطوة 4: تسجيل النشاط
    if (newClient) {
      try {
        await prisma.activityLog.create({
          data: {
            action: "إنشاء عميل",
            description: `تم إنشاء العميل الجديد "${getFullName(newClient.name)}" برقم كود ${newClient.clientCode}.`,
            category: "عميل",
            clientId: newClient.id,
            performedById: req.user.id, // [cite: yousifmohame/engineering_system_backend/engineering_system_backend-53e19ee7b707157328102ba0b47eae73c3f7f3c8/middleware/authMiddleware.js]
          },
        });
      } catch (logError) {
        console.error("Failed to create activity log:", logError);
      }
    }
  } catch (error) {
    if (error.code === 'P2002') { 
      return res.status(400).json({ 
        message: 'فشل الإنشاء: تضارب في البيانات', 
        error: `البيانات (مثل الجوال أو الإيميل أو رقم الهوية) مستخدمة مسبقاً.`,
        details: error.meta.target
      });
    }
    console.error("Error creating client:", error);
    res.status(500).json({ message: 'فشل في إنشاء العميل', error: error.message });
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
        transactions: true // نحتاج المعاملات لحساب الدرجة بدقة
      }
    });

    if (!existingClient) {
      return res.status(404).json({ message: 'لم يتم العثور على العميل' });
    }

    // 2. دمج البيانات الجديدة مع البيانات القديمة
    // (نستخدم البيانات الجديدة إن وجدت، وإلا نستخدم القديمة)
    const mergedData = {
      ...existingClient,
      ...req.body, // البيانات القادمة من الطلب تطغى على القديمة
      // التأكد من دمج حقول الـ JSON بشكل صحيح
      name: req.body.name || existingClient.name,
      contact: req.body.contact ? { ...existingClient.contact, ...req.body.contact } : existingClient.contact,
      address: req.body.address ? { ...existingClient.address, ...req.body.address } : existingClient.address,
      identification: req.body.identification ? { ...existingClient.identification, ...req.body.identification } : existingClient.identification,
    };

    // 3. إعادة حساب النسبة والدرجة بناءً على البيانات المدمجة الكاملة
    const completionPercentage = calculateCompletionPercentage(mergedData);
    const gradeInfo = calculateClientGrade(mergedData, completionPercentage);

    // 4. تنفيذ التحديث في قاعدة البيانات
    const updatedClient = await prisma.client.update({
      where: { id: clientId },
      data: {
        // الحقول المباشرة (تحديثها فقط إذا تم إرسالها)
        mobile: req.body.mobile,
        email: req.body.email,
        idNumber: req.body.idNumber,
        type: req.body.type,
        category: req.body.category,
        nationality: req.body.nationality,
        occupation: req.body.occupation,
        company: req.body.company,
        taxNumber: req.body.taxNumber,
        rating: req.body.rating, // يمكن تحديثه مباشرة
        secretRating: req.body.secretRating, // يمكن تحديثه مباشرة
        notes: req.body.notes,
        isActive: req.body.isActive,
        
        // حقول الـ JSON
        name: req.body.name ? req.body.name : undefined, 
        contact: req.body.contact ? req.body.contact : undefined,
        address: req.body.address ? req.body.address : undefined,
        identification: req.body.identification ? req.body.identification : undefined,

        // الحقول المحسوبة (يتم تحديثها دائماً)
        completionPercentage,
        grade: gradeInfo.grade,
        gradeScore: gradeInfo.score,
      },
      include: {
        transactions: { include: { payments: true } },
        contracts: true,
        quotations: true,
        attachments: true,
        activityLogs: {
          include: { performedBy: { select: { id: true, name: true } } },
          orderBy: { date: 'desc' }
        },
        _count: {
          select: { transactions: true, contracts: true, quotations: true }
        }
      },
    });

    res.json(updatedClient);

    // تسجيل النشاط (Activity Log)
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

  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ 
        message: 'فشل التحديث: تضارب في البيانات', 
        error: `البيانات (مثل الجوال أو الإيميل) مستخدمة مسبقاً.` 
      });
    }
    console.error("Error updating client:", error);
    res.status(500).json({ message: 'فشل في تحديث العميل', error: error.message });
  }
};

// حذف عميل
const deleteClient = async (req, res) => {
  const { id: clientId } = req.params;
  try {
    // اختياري: تسجيل النشاط قبل الحذف
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (client) {
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

    // حذف العميل (سيؤدي إلى حذف سجلات النشاط المرتبطة به بسبب onDelete: Cascade)
    await prisma.client.delete({
      where: { id: clientId },
    });
    
    res.status(200).json({ message: 'تم حذف العميل بنجاح' });
  } catch (error) {
    console.error("Error deleting client:", error);
    res.status(500).json({ message: 'فشل في حذف العميل', error: error.message });
  }
};

// جلب عميل واحد (من ملفك الأصلي)
const getClientById = async (req, res) => {
  const { id: clientId } = req.params;
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { // إرجاع نفس البيانات
        transactions: { include: { payments: true } },
        contracts: true,
        quotations: true,
        attachments: true,
        activityLogs: { include: { performedBy: { select: { id: true, name: true } } } },
         _count: {
          select: {
            transactions: true,
            contracts: true,
            quotations: true
          }
        }
      }
    });
    if (client) {
      res.json(client);
    } else {
      res.status(404).json({ message: 'لم يتم العثور على العميل' });
    }
  } catch (error) {
    res.status(500).json({ message: 'فشل في جلب العميل', error: error.message });
  }
};

// ==================================================
// ✅ 3. (جديد) دالة لجلب قائمة عملاء خفيفة (لشاشة 286)
// ==================================================
const getSimpleClients = async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      select: {
        id: true,
        name: true, // (Json)
        clientCode: true,
      },
      where: {
        isActive: true // جلب العملاء النشطين فقط
      },
      // --- ✅✅✅ هذا هو الإصلاح ✅✅✅ ---
      // (لا يمكن الفرز بحقل 'name' لأنه Json)
      // (سنقوم بالفرز بالكود بدلاً منه)
      orderBy: {
        clientCode: 'asc'
      },
      // ------------------------------------
    });

    // تحويل الاسم إلى نص مقروء
    const simpleList = clients.map(client => {
      const fullName = `${client.name?.firstName || ''} ${client.name?.familyName || ''}`.trim();
      const displayName = `${fullName} (${client.clientCode})`
      return {
        id: client.id,
        name: displayName
      }
    });
    res.json(simpleList);
  } catch (error) {
    res.status(500).json({ message: 'فشل في جلب قائمة العملاء المبسطة', error: error.message });
  }
};


module.exports = {
  getAllClients,
  createClient,
  updateClient,
  deleteClient,
  getClientById,
  getSimpleClients, // ✅ قم بإضافة الدالة الجديدة هنا
};
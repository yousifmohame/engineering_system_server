const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const { GoogleGenAI } = require("@google/genai");

const prisma = new PrismaClient();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ============================================================================
// 1. إعدادات و Prompt الذكاء الاصطناعي (مفصل واحترافي)
// ============================================================================

const SYSTEM_PROMPT = `
أنت مهندس استشاري وخبير قانوني عقاري في المملكة العربية السعودية، تعمل كنظام استخراج بيانات (Data Extractor) عالي الدقة.
مهمتك هي تحليل المستندات المرفقة للمشروع (رخص بناء، صكوك ملكية، كروكيات مساحية، تقارير، ومخططات) واستخراج البيانات المعمارية والقانونية المطلوبة بدقة متناهية.

القواعد الأساسية الصارمة:
1. استخرج البيانات بناءً على الهيكل المطلوب أدناه فقط.
2. إذا لم تكن المعلومة موجودة في المستندات، قم بإرجاع القيمة null للنصوص و 0 للأرقام (لا تخمن أبداً).
3. الأرقام: حول أي رقم هندي (١،٢،٣) إلى إنجليزي (1,2,3).
4. المساحات والأطوال: استخرج الرقم فقط (Float) (بدون نصوص مثل "م" أو "م2").
5. التواريخ: استخرجها كما هي مكتوبة، وإذا استطعت تحويلها لصيغة YYYY-MM-DD يكون أفضل.
6. في الجداول (الارتدادات، المساحات، الحدود)، تأكد من استخراج البيانات كمصفوفة كائنات (Array of Objects).

يجب أن يكون الناتج حصرياً بصيغة JSON متوافق تماماً مع هذا الهيكل:
{
  "title": "اسم المشروع أو وصفه العام المستنتج",
  "projectType": "سكني أو تجاري أو متعدد الاستخدامات أو صناعي",
  "transactionType": "إصدار رخصة، أو تعديل مكونات، أو إضافة ملحق، أو فرز...",
  "ownerType": "اعتباري (إذا كان شركة/مؤسسة) أو طبيعي (إذا كان أفراد)",
  "contactMobile": "أي رقم جوال مسجل للمالك",
  "poBox": "صندوق البريد أو الرمز البريدي إن وجد",
  "licenseNumber": "رقم رخصة البناء",
  "licenseIssueDate": "تاريخ إصدار الرخصة",
  "licenseExpiryDate": "تاريخ انتهاء الرخصة",
  "deedNumber": "رقم صك الملكية",
  "deedDate": "تاريخ الصك",
  "city": "المدينة (غالباً الرياض)",
  "planNumber": "رقم المخطط المعتمد",
  "plots": ["رقم القطعة الأولى", "رقم القطعة الثانية"],
  "mainStreet": "اسم الشارع الرئيسي وعرضه",
  "totalArea": 0,
  "coverageRatio": 0,
  "far": 0,
  "floorsAbove": 0,
  "floorsBelow": 0,
  "parkingRequired": 0,
  "parkingAvailable": 0,
  "boundaries": [
    { "direction": "شمالاً", "desc": "وصف الجار أو الشارع", "length": 0 }
  ],
  "floorAreas": [
    { "floor": "اسم الدور", "area": 0 }
  ],
  "setbacks": [
    { "direction": "الجهة", "required": 0, "implemented": 0, "status": "مطابق أو مخالف" }
  ],
  "archiveNotes": "ملاحظات عامة واحترافية اكتشفتها (مثل وجود مخالفات بناء، بروزات، أو ملاحظات هامة للبلدية)",
  "aiConfidence": 0 // تقييمك لمدى وضوح واكتمال المستندات من 0 إلى 100
}
`;

// ============================================================================
// 2. خدمة تحليل الملفات الكبيرة في الخلفية (Background Job)
// ============================================================================
// ============================================================================
// 2. خدمة تحليل الملفات الكبيرة في الخلفية (Background Job)
// ============================================================================

const analyzeProjectFilesWithGemini = async (projectId, files) => {
  const uploadedGeminiFiles = [];

  try {
    console.log(`🚀 [Gemini] بدء تحليل المشروع: ${projectId}`);
    
    // 1. رفع الملفات إلى سيرفرات Gemini
    for (const file of files) {
      if (fs.existsSync(file.filePath)) {
        console.log(`📤 جاري رفع ${file.originalName} إلى Gemini...`);
        const uploadResult = await ai.files.upload({
          file: file.filePath,
          mimeType: file.fileType,
          displayName: file.originalName,
        });
        uploadedGeminiFiles.push(uploadResult);
      } else {
        console.warn(`⚠️ لم يتم العثور على الملف محلياً: ${file.filePath}`);
      }
    }

    if (uploadedGeminiFiles.length === 0) {
      throw new Error("لم يتم رفع أي ملفات صالحة للتحليل.");
    }

    // 💡 الإصلاح هنا: تحويل الملفات المرفوعة إلى الهيكل الذي يفهمه Gemini حصرياً
    const fileParts = uploadedGeminiFiles.map(file => ({
      fileData: {
        fileUri: file.uri,
        mimeType: file.mimeType
      }
    }));

    // 2. استدعاء الموديل 
    console.log(`🧠 جاري تحليل ${uploadedGeminiFiles.length} ملفات ضخمة...`);
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro", // أو gemini-3-flash-preview إذا كنت تفضله
      contents: [
        "يرجى تحليل جميع هذه المستندات واستخراج البيانات الهندسية والقانونية المطلوبة بصيغة JSON.",
        ...fileParts // 👈 تمرير الملفات بالهيكل الصحيح هنا
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1, 
        responseMimeType: "application/json",
      },
    });

    // 3. تنظيف ومعالجة المخرجات
    const responseText = response.text;
    
    // فلتر لتنظيف الأرقام العربية الهندية 
    let cleanedContent = responseText.replace(/[٠-٩]/g, (d) =>
      "٠١٢٣٤٥٦٧٨٩".indexOf(d),
    );

    const extractedData = JSON.parse(cleanedContent);
    console.log(`✅ [Gemini] تم التحليل بنجاح للمشروع: ${projectId}`);

    // 4. حفظ البيانات في قاعدة البيانات
    await prisma.archivedProject.update({
      where: { id: projectId },
      data: {
        title: extractedData.title || "مشروع مؤرشف (بدون اسم)",
        projectType: extractedData.projectType || "غير محدد",
        transactionType: extractedData.transactionType,
        ownerType: extractedData.ownerType,
        contactMobile: extractedData.contactMobile,
        poBox: extractedData.poBox,
        licenseNumber: extractedData.licenseNumber,
        licenseIssueDate: extractedData.licenseIssueDate ? new Date(extractedData.licenseIssueDate) : null,
        licenseExpiryDate: extractedData.licenseExpiryDate ? new Date(extractedData.licenseExpiryDate) : null,
        deedNumber: extractedData.deedNumber,
        deedDate: extractedData.deedDate ? new Date(extractedData.deedDate) : null,
        city: extractedData.city || "الرياض",
        planNumber: extractedData.planNumber,
        plots: extractedData.plots || [],
        mainStreet: extractedData.mainStreet,
        
        boundaries: extractedData.boundaries || [],
        totalArea: extractedData.totalArea,
        coverageRatio: extractedData.coverageRatio,
        far: extractedData.far,
        floorsAbove: extractedData.floorsAbove,
        floorsBelow: extractedData.floorsBelow,
        parkingRequired: extractedData.parkingRequired,
        parkingAvailable: extractedData.parkingAvailable,
        floorAreas: extractedData.floorAreas || [],
        setbacks: extractedData.setbacks || [],
        
        archiveNotes: extractedData.archiveNotes,
        aiConfidence: extractedData.aiConfidence || 0,
        aiStatus: "completed"
      }
    });

  } catch (error) {
    console.error(`🔥 [Gemini Error] فشل التحليل للمشروع ${projectId}:`, error);
    await prisma.archivedProject.update({
      where: { id: projectId },
      data: { aiStatus: "failed", archiveNotes: `فشل التحليل: ${error.message}` }
    });
  } finally {
    // 5. التنظيف الإلزامي لملفات سيرفرات Gemini
    for (const file of uploadedGeminiFiles) {
      try {
        await ai.files.delete({ name: file.name });
        console.log(`🧹 تم حذف الملف من سيرفرات Gemini: ${file.name}`);
      } catch (cleanupErr) {
        console.error(`⚠️ فشل حذف الملف ${file.name} من Gemini:`, cleanupErr);
      }
    }
  }
};

// ============================================================================
// 3. مسارات واجهة برمجة التطبيقات (API Controllers)
// ============================================================================

// أ. تهيئة الأرشيف (الخطوة 1)
exports.initiateProjectArchive = async (req, res) => {
  try {
    const files = req.files;
    const employeeId = req.user?.id;

    // 1. التحقق من وجود ملفات مرفوعة
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: "لم يتم إرفاق ملفات" });
    }

    // 2. توليد كود الأرشفة الموحد
    const currentYear = new Date().getFullYear();
    const count = await prisma.archivedProject.count();
    const archiveCode = `ARC-${currentYear}-${String(count + 1).padStart(3, "0")}`;

    // 3. تجهيز بيانات الملفات لقاعدة البيانات (بدون filePath لتجنب خطأ Prisma)
    const processedFilesForDB = files.map((file) => ({
      fileName: file.filename, 
      originalName: file.originalname, 
      fileUrl: `/uploads/archived_projects/${file.filename}`, // رابط العرض للواجهة
      fileType: file.mimetype, 
      fileSize: file.size, 
    }));

    // 4. إنشاء السجل المبدئي للمشروع وملفاته
    const archivedProject = await prisma.archivedProject.create({
      data: {
        archiveCode,
        title: "جاري تحليل المشروع...",
        projectType: "قيد التحليل",
        aiStatus: "pending",
        archivedById: employeeId,
        files: {
          create: processedFilesForDB,
        },
      },
      include: { files: true },
    });

    // 5. دمج المسار المحلي (filePath) مع الملفات لإرسالها لـ Gemini
    // لأن Gemini يحتاج المسار المحلي في السيرفر لرفع الملفات إلى GoogleAIFileManager
    const filesForGemini = archivedProject.files.map((dbFile, index) => ({
      ...dbFile,
      filePath: files[index].path // المسار الفعلي من Multer (مثال: uploads/archived_projects/123.pdf)
    }));

    // 6. إطلاق عملية التحليل في الخلفية (بدون await)
    if (typeof analyzeProjectFilesWithGemini === "function") {
      analyzeProjectFilesWithGemini(archivedProject.id, filesForGemini)
        .catch(err => console.error(`[Gemini Error] Project ${archivedProject.id}:`, err));
    }

    // 7. استجابة فورية للواجهة للانتقال لشاشة الانتظار
    return res.status(201).json({
      success: true,
      message: "تم استلام الملفات بنجاح. الذكاء الاصطناعي يقوم الآن بتحليلها في الخلفية.",
      data: {
        projectId: archivedProject.id,
        archiveCode: archivedProject.archiveCode,
      },
    });
    
  } catch (error) {
    console.error("Error initiating project archive:", error);
    return res.status(500).json({ success: false, message: "حدث خطأ أثناء تهيئة الأرشيف" });
  }
};

// ب. جلب بيانات المشروع (الخطوة 3)
exports.getArchivedProjectDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const project = await prisma.archivedProject.findUnique({
      where: { id },
      include: {
        client: { select: { name: true, idNumber: true } },
        district: { select: { name: true } },
        archivedBy: { select: { name: true } },
        files: true,
      },
    });

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "المشروع المرجعي غير موجود" });
    }

    return res.status(200).json({ success: true, data: project });
  } catch (error) {
    console.error("Error fetching archived project:", error);
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ في جلب البيانات" });
  }
};

// ج. تحديث المشروع واعتماده
exports.updateArchivedProject = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // تنظيف البيانات من الكائنات الفرعية غير القابلة للتحديث المباشر
    delete updateData.client;
    delete updateData.district;
    delete updateData.files;
    delete updateData.archivedBy;

    const updatedProject = await prisma.archivedProject.update({
      where: { id },
      data: {
        ...updateData,
        aiStatus: "approved", // بمجرد التحديث من المستخدم، يتم الاعتماد
      },
    });

    return res.status(200).json({ success: true, data: updatedProject });
  } catch (error) {
    console.error("Error updating archived project:", error);
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء حفظ التعديلات" });
  }
};

// د. جلب كل المشاريع المؤرشفة
exports.getAllArchivedProjects = async (req, res) => {
  try {
    const projects = await prisma.archivedProject.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true } },
        _count: { select: { files: true } },
      },
    });
    return res.status(200).json({ success: true, data: projects });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء جلب الأرشيف" });
  }
};

exports.deleteArchivedProject = async (req, res) => {
  try {
    const { id } = req.params;
    
    // سيقوم Prisma بمسح الملفات المرتبطة تلقائياً إذا كنت قد وضعت onDelete: Cascade في الـ schema
    await prisma.archivedProject.delete({
      where: { id }
    });

    return res.status(200).json({ success: true, message: 'تم حذف المشروع بنجاح' });
  } catch (error) {
    console.error("Error deleting archived project:", error);
    return res.status(500).json({ success: false, message: 'حدث خطأ أثناء الحذف' });
  }
};
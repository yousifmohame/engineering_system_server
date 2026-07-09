const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");
// 💡 1. استيراد الحزمة الرسمية الجديدة
const { GoogleGenAI } = require("@google/genai");
// 💡 2. تهيئة الذكاء الاصطناعي بالطريقة الجديدة
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const createBundleInBackground = async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "الرجاء إرفاق صورة للتحليل" });

    const userId = req.user?.id || "النظام";
    const year = new Date().getFullYear();
    const count = await prisma.engineeringBundle.count();
    const bundleCode = `ENG-REF-${year}-${String(count + 1).padStart(4, "0")}`;

    // 1. إنشاء الحزمة بحالة "PROCESSING" (قيد المعالجة)
    const bundle = await prisma.engineeringBundle.create({
      data: {
        bundleCode,
        status: "PROCESSING",
        source: "AI_BACKGROUND",
        createdBy: userId,
      },
    });

    // 2. إرجاع الرد للمستخدم فوراً لإغلاق النافذة
    res.status(202).json({
      success: true,
      message: "تم استلام الملف، جاري التحليل في الخلفية...",
      bundleId: bundle.id,
    });

    // 3. المعالجة في الخلفية (لا نستخدم await هنا لكي لا ننتظر)
    processAIAndUpdateBundle(bundle.id, req.file.path, req.file.mimetype).catch(
      console.error,
    );
  } catch (error) {
    console.error("Background Create Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 الدالة المساعدة للمعالجة في الخلفية
const processAIAndUpdateBundle = async (bundleId, files) => { // نمرر files من createBundleInBackground
  try {
    const documentParts = files.map(file => {
      const fileBuffer = fs.readFileSync(file.path);
      return {
        inlineData: { data: fileBuffer.toString("base64"), mimeType: file.mimetype },
      };
    });

    const prompt = `
      أنت مهندس سعودي خبير في مراجعة الرخص البلدية والمخططات.
      مهمتك استخراج البيانات الوصفية بدقة من المستند المرفق.
      
      تعليمات صارمة جداً:
      1. الأرقام: قم بتحويل أي رقم هندي (١،٢،٣) إلى رقم إنجليزي (1,2,3).
      2. لا تخمن أي معلومة. إذا كانت المعلومة غير موجودة، أرجع null للنصوص أو 0 للأرقام.
      3. يجب أن يكون المخرج حصرياً بصيغة JSON المطابقة للتركيبة التالية بدون أي إضافات:

      {
        "projectName": "اسم المشروع أو المالك",
        "mainCategory": "سكني أو تجاري أو إداري أو تعليمي",
        "subCategory": "فيلا أو عمارة أو مستودع",
        "transactionType": "إصدار أو تجديد أو تعديل",
        "usageType": "الاستخدام المذكور",
        "city": "المدينة",
        "districtName": "اسم الحي بدقة بدون كلمة حي",
        "planNumber": "رقم المخطط",
        "plotNumbers": ["رقم القطعة"],
        "totalLandArea": 0,
        "floorsAbove": 0,
        "isExisting": false,
        "streetsData": [
          { "direction": "شمال", "width": 0, "name": "" },
          { "direction": "جنوب", "width": 0, "name": "" },
          { "direction": "شرق", "width": 0, "name": "" },
          { "direction": "غرب", "width": 0, "name": "" }
        ],
        "aiConfidence": 0.95
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-1.5-pro",
      contents: [prompt, ...documentParts],
      config: { temperature: 0.0, responseMimeType: "application/json" },
    });

    let cleanedContent = response.text.replace(/[٠-٩]/g, (d) =>
      "٠١٢٣٤٥٦٧٨٩".indexOf(d),
    );
    const aiData = JSON.parse(cleanedContent);

    // تحديث قاعدة البيانات
    await prisma.engineeringBundle.update({
      where: { id: bundleId },
      data: {
        projectName: aiData.projectName,
        mainCategory: aiData.mainCategory,
        subCategory: aiData.subCategory,
        city: aiData.city || "الرياض",
        districtName: aiData.districtName,
        planNumber: aiData.planNumber,
        floorsAbove: aiData.floorsAbove,
        totalLandArea: aiData.totalLandArea,
        status: "NEEDS_DATA", // يحتاج بيانات (لأن المستخدم لم يرفع الـ CAD بعد)
        aiConfidence: aiData.aiConfidence || 0.9,
      },
    });
  } catch (error) {
    console.error(`AI Background Error for Bundle ${bundleId}:`, error);
    await prisma.engineeringBundle.update({
      where: { id: bundleId },
      data: { status: "FAILED", generalNotes: "فشل التحليل الذكي" },
    });
  } finally {
    // تنظيف الملف المؤقت
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
};

// ==========================================
// 1. إنشاء حزمة جديدة مع أو بدون ملفات
// ==========================================
const createBundle = async (req, res) => {
  try {
    const data = req.body;
    const userId = req.user?.id || "النظام";

    // توليد كود الحزمة (مثال: ENG-REF-2026-XXXX)
    const year = new Date().getFullYear();
    const count = await prisma.engineeringBundle.count();
    const bundleCode = `ENG-REF-${year}-${String(count + 1).padStart(4, "0")}`;

    // معالجة الشوارع إذا تم إرسالها كنص JSON
    let streetsData = [];
    if (data.streetsData) {
      try {
        streetsData = JSON.parse(data.streetsData);
      } catch (e) {}
    }

    // إنشاء الحزمة
    const bundle = await prisma.engineeringBundle.create({
      data: {
        bundleCode,
        projectName: data.projectName,
        source: data.source || "EXTERNAL",
        status: data.status || "NEW",
        mainCategory: data.mainCategory,
        subCategory: data.subCategory,
        transactionType: data.transactionType,
        usageType: data.usageType,
        city: data.city || "الرياض",
        districtName: data.districtName,
        districtId: data.districtId,
        planNumber: data.planNumber,
        plotNumbers: data.plotNumbers ? JSON.parse(data.plotNumbers) : [],
        totalLandArea: data.totalLandArea
          ? parseFloat(data.totalLandArea)
          : null,
        floorsAbove: data.floorsAbove ? parseInt(data.floorsAbove) : null,
        basements: data.basements ? parseInt(data.basements) : null,
        streetsData: streetsData,
        generalNotes: data.generalNotes,
        createdBy: userId,
      },
    });

    // إضافة الملفات إن وجدت
    if (req.files && req.files.length > 0) {
      const filesData = req.files.map((file, index) => {
        const ext =
          path.extname(file.originalname).substring(1).toUpperCase() || "PDF";
        return {
          fileCode: `${bundleCode}-${ext}-${String(index + 1).padStart(2, "0")}`,
          bundleId: bundle.id,
          originalName: file.originalname,
          internalName: file.filename,
          fileUrl: `/uploads/engineering/${file.filename}`,
          extension: ext,
          mimeType: file.mimetype,
          fileSize: file.size,
          uploadedBy: userId,
        };
      });

      await prisma.engineeringFile.createMany({ data: filesData });
    }

    res
      .status(201)
      .json({ success: true, message: "تم إنشاء الحزمة بنجاح", data: bundle });
  } catch (error) {
    console.error("Create Bundle Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. جلب الحزم مع الفلترة والبحث
// ==========================================
const getBundles = async (req, res) => {
  try {
    const { search, category, district, status } = req.query;

    const where = {};
    if (search) {
      where.OR = [
        { bundleCode: { contains: search } },
        { projectName: { contains: search } },
        { districtName: { contains: search } },
      ];
    }
    if (category) where.mainCategory = category;
    if (district) where.districtName = district;
    if (status) where.status = status;

    const bundles = await prisma.engineeringBundle.findMany({
      where,
      include: { files: true },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: bundles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. رفع ملفات لحزمة موجودة
// ==========================================
const uploadFilesToBundle = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || "النظام";

    const bundle = await prisma.engineeringBundle.findUnique({
      where: { id },
      include: { files: true },
    });
    if (!bundle)
      return res
        .status(404)
        .json({ success: false, message: "الحزمة غير موجودة" });

    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم استلام أي ملفات" });
    }

    const currentFileCount = bundle.files.length;

    const filesData = req.files.map((file, index) => {
      const ext =
        path.extname(file.originalname).substring(1).toUpperCase() || "PDF";
      return {
        fileCode: `${bundle.bundleCode}-${ext}-${String(currentFileCount + index + 1).padStart(2, "0")}`,
        bundleId: bundle.id,
        originalName: file.originalname,
        internalName: file.filename,
        fileUrl: `/uploads/engineering/${file.filename}`,
        extension: ext,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedBy: userId,
      };
    });

    await prisma.engineeringFile.createMany({ data: filesData });

    res.status(201).json({ success: true, message: "تم إضافة الملفات بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 4. استخراج البيانات بالذكاء الاصطناعي (AI)
// ==========================================
const extractDataWithAI = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "الرجاء إرفاق ملف واحد على الأقل" });

    // 💡 تحويل جميع الملفات المرفوعة إلى Parts ليفهمها Gemini
    const documentParts = req.files.map((file) => {
      const fileBuffer = fs.readFileSync(file.path);
      return {
        inlineData: {
          data: fileBuffer.toString("base64"),
          mimeType: file.mimetype,
        },
      };
    });

    const prompt = `
      أنت مهندس سعودي خبير في مراجعة الرخص البلدية والمخططات.
      مهمتك استخراج البيانات الوصفية بدقة من المستند المرفق.
      
      تعليمات صارمة جداً:
      1. الأرقام: قم بتحويل أي رقم هندي (١،٢،٣) إلى رقم إنجليزي (1,2,3).
      2. لا تخمن أي معلومة. إذا كانت المعلومة غير موجودة، أرجع null للنصوص أو 0 للأرقام.
      3. يجب أن يكون المخرج حصرياً بصيغة JSON المطابقة للتركيبة التالية بدون أي إضافات:

      {
        "projectName": "اسم المشروع أو المالك",
        "mainCategory": "سكني أو تجاري أو إداري أو تعليمي",
        "subCategory": "فيلا أو عمارة أو مستودع",
        "transactionType": "إصدار أو تجديد أو تعديل",
        "usageType": "الاستخدام المذكور",
        "city": "المدينة",
        "districtName": "اسم الحي بدقة بدون كلمة حي",
        "planNumber": "رقم المخطط",
        "plotNumbers": ["رقم القطعة"],
        "totalLandArea": 0,
        "floorsAbove": 0,
        "isExisting": false,
        "streetsData": [
          { "direction": "شمال", "width": 0, "name": "" },
          { "direction": "جنوب", "width": 0, "name": "" },
          { "direction": "شرق", "width": 0, "name": "" },
          { "direction": "غرب", "width": 0, "name": "" }
        ],
        "aiConfidence": 0.95
      }
    `;

    // 💡 مصفوفة النماذج الاحتياطية لضمان عدم توقف الخدمة
    const fallbackModels = [
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ];

    let response = null;

    // محاولة الاتصال بالنماذج تباعاً
    for (const modelName of fallbackModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: [prompt, ...documentParts],
          config: {
            temperature: 0.0,
            responseMimeType: "application/json", // 💡 الإجبار على صيغة JSON النظيفة
          },
        });
        break; // الخروج من الحلقة عند نجاح الاتصال
      } catch (error) {
        console.warn(
          `فشل الاتصال بالموديل ${modelName}، جاري تجربة الموديل التالي...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!response) throw new Error("فشل الاتصال بجميع نماذج الذكاء الاصطناعي.");

    // 💡 تنظيف الأرقام العربية/الهندية وضمان سلامة الـ JSON
    let cleanedContent = response.text.replace(/[٠-٩]/g, (d) =>
      "٠١٢٣٤٥٦٧٨٩".indexOf(d),
    );

    const parsedData = JSON.parse(cleanedContent);

    // تنظيف الملف المؤقت
    req.files.forEach((file) => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });

    res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("AI Extraction Error:", error);
    // تأكد من تنظيف الملف المؤقت حتى في حالة الفشل
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: "فشل استخراج البيانات",
      details: error.message,
    });
  }
};

// ==========================================
// 5. محرك اكتشاف التشابه (Similarity Engine)
// ==========================================
const findSimilarBundles = async (req, res) => {
  try {
    const {
      districtName,
      mainCategory,
      subCategory,
      floorsAbove,
      streetsData,
    } = req.body;

    const allBundles = await prisma.engineeringBundle.findMany({
      include: { files: true },
      where: { status: { not: "REJECTED" } },
    });

    const results = [];

    let targetMaxWidth = 0;
    if (streetsData && Array.isArray(streetsData)) {
      targetMaxWidth = Math.max(
        ...streetsData.map((s) => parseFloat(s.width) || 0),
      );
    }

    allBundles.forEach((bundle) => {
      let score = 0;
      let reasons = [];

      // 1. التطابق في الحي (35%)
      if (
        districtName &&
        bundle.districtName &&
        bundle.districtName.includes(districtName)
      ) {
        score += 35;
        reasons.push("نفس الحي");
      }

      // 2. التطابق في التصنيف (25%)
      if (mainCategory && bundle.mainCategory === mainCategory) {
        score += 15;
        reasons.push("نفس التصنيف الرئيسي");
      }
      if (subCategory && bundle.subCategory === subCategory) {
        score += 10;
        reasons.push("نفس التصنيف الفرعي");
      }

      // 3. التطابق في عدد الأدوار (20%)
      if (floorsAbove && bundle.floorsAbove) {
        if (floorsAbove === bundle.floorsAbove) {
          score += 20;
          reasons.push("نفس عدد الأدوار");
        } else if (Math.abs(floorsAbove - bundle.floorsAbove) <= 1) {
          score += 10;
          reasons.push("عدد أدوار مقارب");
        }
      }

      // 4. التطابق في عرض الشارع الرئيسي (20%)
      let bundleMaxWidth = 0;
      if (bundle.streetsData) {
        let parsedStreets =
          typeof bundle.streetsData === "string"
            ? JSON.parse(bundle.streetsData)
            : bundle.streetsData;
        bundleMaxWidth = Math.max(
          ...parsedStreets.map((s) => parseFloat(s.width) || 0),
        );
      }

      if (targetMaxWidth > 0 && bundleMaxWidth > 0) {
        if (targetMaxWidth === bundleMaxWidth) {
          score += 20;
          reasons.push(`شارع رئيسي مطابق (${targetMaxWidth}م)`);
        }
      }

      if (score >= 40) {
        results.push({
          bundle,
          similarityScore: score,
          matchReasons: reasons,
        });
      }
    });

    results.sort((a, b) => b.similarityScore - a.similarityScore);

    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteFile = async (req, res) => {
  try {
    await prisma.engineeringFile.delete({ where: { id: req.params.fileId } });
    res.json({ success: true, message: "تم حذف الملف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// ==========================================
// جلب حزمة هندسية واحدة بالتفصيل (لنافذة التفاصيل)
// ==========================================
const getBundleById = async (req, res) => {
  try {
    const { id } = req.params;
    const bundle = await prisma.engineeringBundle.findUnique({
      where: { id },
      include: { files: true }, // جلب الملفات المرتبطة
    });

    if (!bundle)
      return res
        .status(404)
        .json({ success: false, message: "الحزمة غير موجودة" });

    res.json({ success: true, data: bundle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 💡 تحديث حزمة هندسية (تعديل البيانات)
// ==========================================
const updateBundle = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    // معالجة الحقول التي تأتي من الفرونت إند كـ JSON Strings
    let parsedPlotNumbers = [];
    let parsedStreetsData = [];

    if (data.plotNumbers) {
      try {
        parsedPlotNumbers = JSON.parse(data.plotNumbers);
      } catch (e) {}
    }
    if (data.streetsData) {
      try {
        parsedStreetsData = JSON.parse(data.streetsData);
      } catch (e) {}
    }

    // تجهيز البيانات للتحديث
    const updateData = {
      projectName: data.projectName,
      mainCategory: data.mainCategory,
      subCategory: data.subCategory,
      transactionType: data.transactionType,
      usageType: data.usageType,
      city: data.city,
      districtName: data.districtName,
      planNumber: data.planNumber,
      plotNumbers: parsedPlotNumbers,
      totalLandArea: data.totalLandArea ? parseFloat(data.totalLandArea) : null,
      floorsAbove: data.floorsAbove ? parseInt(data.floorsAbove) : null,
      basements: data.basements ? parseInt(data.basements) : null,
      isExisting: data.isExisting === "true" || data.isExisting === true,
      streetsData: parsedStreetsData,
      generalNotes: data.generalNotes,

      // إذا كانت الحزمة "قيد المعالجة" أو "تحتاج بيانات"، نجعلها "مكتملة" بمجرد التعديل اليدوي
      status: data.status || "COMPLETED",
    };

    const updatedBundle = await prisma.engineeringBundle.update({
      where: { id },
      data: updateData,
    });

    res.json({
      success: true,
      message: "تم تحديث البيانات بنجاح",
      data: updatedBundle,
    });
  } catch (error) {
    console.error("Update Bundle Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// حذف حزمة هندسية (بجميع ملفاتها)
// ==========================================
const deleteBundle = async (req, res) => {
  try {
    const { id } = req.params;

    // 💡 الحذف المتتالي (Cascade Delete) مدعوم في Schema،
    // فبمجرد حذف الحزمة سيتم حذف سجلات الملفات المرتبطة بها في الداتا بيز
    await prisma.engineeringBundle.delete({
      where: { id },
    });

    res.json({ success: true, message: "تم حذف الحزمة بنجاح" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "لا يمكن حذف هذه الحزمة، قد تكون مرتبطة بمعاملات أخرى.",
    });
  }
};

module.exports = {
  createBundleInBackground,
  createBundle,
  getBundles,
  getBundleById,
  uploadFilesToBundle,
  extractDataWithAI,
  findSimilarBundles,
  deleteBundle,
  deleteFile,
  updateBundle,
};

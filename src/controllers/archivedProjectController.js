const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

// استيراد الدوال المساعدة
const { optimizeFile } = require("../utils/fileOptimizer");
const { createSystemNotification } = require("./notificationController");

const prisma = new PrismaClient();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ============================================================================
// 1. إعدادات و Prompt الذكاء الاصطناعي
// ============================================================================
const SYSTEM_PROMPT = `
أنت مهندس استشاري وخبير قانوني عقاري في المملكة العربية السعودية، تعمل كنظام استخراج بيانات (Data Extractor) عالي الدقة.
مهمتك هي تحليل المستندات المرفقة للمشروع (رخص بناء، صكوك ملكية، كروكيات مساحية، تقارير، ومخططات) واستخراج البيانات المعمارية والقانونية المطلوبة بدقة متناهية.

القواعد الأساسية الصارمة:
1. استخرج البيانات بناءً على الهيكل المطلوب أدناه فقط.
2. إذا لم تكن المعلومة موجودة في المستندات، قم بإرجاع القيمة null للنصوص و 0 للأرقام.
3. الأرقام: حول أي رقم هندي (١،٢،٣) إلى إنجليزي (1,2,3).
4. المساحات والأطوال: استخرج الرقم فقط (Float).
5. تعدد الأسماء: إذا وجدت أكثر من مالك أو أكثر من مكتب هندسي، ضعهم جميعاً في المصفوفة (Array) ولا تحذف أحداً.

يجب أن يكون الناتج حصرياً بصيغة JSON متوافق تماماً مع هذا الهيكل:
{
  "title": "اسم المشروع أو وصفه العام المستنتج",
  "projectType": "سكني أو تجاري أو متعدد الاستخدامات أو صناعي",
  "transactionType": "إصدار رخصة، أو تعديل مكونات، أو إضافة ملحق، أو فرز...",
  "ownerNames": ["اسم المالك الأول", "اسم المالك الثاني"],
  "ownerType": "اعتباري (إذا كان شركة/مؤسسة) أو طبيعي (إذا كان أفراد)",
  "contactMobile": "أي رقم جوال مسجل للمالك",
  "poBox": "صندوق البريد أو الرمز البريدي إن وجد",
  "requestNumber": "رقم الطلب (إن وجد)",
  "requestYear": "سنة الطلب (إن وجدت)",
  "serviceNumber": "رقم الخدمة (إن وجد)",
  "serviceYear": "سنة الخدمة (إن وجدت)",
  "licenseNumber": "رقم رخصة البناء",
  "licenseHijriYear": "سنة إصدار الرخصة بالهجري (مثال: 1445) كـ String",
  "licenseIssueDate": "تاريخ إصدار الرخصة (YYYY-MM-DD)",
  "licenseExpiryDate": "تاريخ انتهاء الرخصة (YYYY-MM-DD)",
  "deedNumber": "رقم صك الملكية",
  "deedDate": "تاريخ الصك (YYYY-MM-DD)",
  "city": "المدينة (غالباً الرياض)",
  "sectorName": "القطاع الإداري الذي يقع فيه الحي (مثال: شمال، جنوب، شرق، غرب، وسط)",
  "districtName": "اسم الحي الذي يقع فيه المشروع",
  "planNumber": "رقم المخطط المعتمد",
  "plots": ["رقم القطعة الأولى", "رقم القطعة الثانية"],
  "mainStreet": "اسم الشارع الرئيسي وعرضه",
  "designerOfficeNames": ["المكتب المصمم الأول", "المكتب المصمم الثاني"],
  "supervisorOfficeNames": ["المكتب المشرف الأول"],
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
  "archiveNotes": "ملاحظات عامة واحترافية اكتشفتها",
  "aiConfidence": 0
}
`;

// ============================================================================
// 2. خدمة تحليل الملفات الكبيرة في الخلفية (Background Job)
// ============================================================================
const processFilesWithGemini = async (projectId, originalFiles, employeeId) => {
  const uploadedGeminiFiles = [];

  try {
    console.log(`🚀 [Background Job] بدء معالجة المشروع: ${projectId}`);

    // --- 1. رفع الملفات إلى Gemini ---
    for (const file of originalFiles) {
      if (fs.existsSync(file.filePath)) {
        console.log(`📤 جاري رفع ${file.originalName} إلى Gemini...`);
        const uploadResult = await ai.files.upload({
          file: file.filePath,
          mimeType: file.fileType,
          displayName: file.originalName,
        });
        uploadedGeminiFiles.push(uploadResult);
      }
    }

    let extractedData = {};
    if (uploadedGeminiFiles.length > 0) {
      const fileParts = uploadedGeminiFiles.map((file) => ({
        fileData: { fileUri: file.uri, mimeType: file.mimeType },
      }));

      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: [
          "يرجى تحليل جميع هذه المستندات واستخراج البيانات بصيغة JSON فقط.",
          ...fileParts,
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      });

      let responseText = response.text || "";
      responseText = responseText
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      const cleanedContent = responseText.replace(/[٠-٩]/g, (d) =>
        "٠١٢٣٤٥٦٧٨٩".indexOf(d),
      );
      extractedData = JSON.parse(cleanedContent);
    }

    // --- 2. أ) معالجة وتصحيح الأسماء وأنواع الملاك تلقائياً ---
    const finalOwnerName =
      Array.isArray(extractedData.ownerNames) &&
      extractedData.ownerNames.length > 0
        ? extractedData.ownerNames.join(" - ")
        : extractedData.ownerName || "غير محدد";

    // تحديد نوع المالك ذكياً من خلال اسمه
    const companyKeywords = [
      "شركة",
      "مؤسسة",
      "مكتب",
      "بنك",
      "وزارة",
      "هيئة",
      "صندوق",
      "جمعية",
      "جامعة",
      "أوقاف",
    ];
    const isCompany = companyKeywords.some((kw) => finalOwnerName.includes(kw));
    const finalOwnerType = isCompany ? "اعتباري (شركة)" : "طبيعي (أفراد)";

    const finalDesignerOffice =
      Array.isArray(extractedData.designerOfficeNames) &&
      extractedData.designerOfficeNames.length > 0
        ? extractedData.designerOfficeNames.join(" - ")
        : null;

    const finalSupervisorOffice =
      Array.isArray(extractedData.supervisorOfficeNames) &&
      extractedData.supervisorOfficeNames.length > 0
        ? extractedData.supervisorOfficeNames.join(" - ")
        : null;

    // --- 2. ب) معالجة حالة دمج رقم الرخصة مع السنة الهجرية (مثال: 2045/1435) ---
    if (
      extractedData.licenseNumber &&
      typeof extractedData.licenseNumber === "string"
    ) {
      // نبحث عن شرطة مائلة أو شرطة عادية محاطة بمسافات أو بدونها
      const parts = extractedData.licenseNumber.split(/\s*[\/\-]\s*/);

      if (parts.length === 2) {
        // التحقق من أيهما هو السنة (يبدأ بـ 14 ويتكون من 4 أرقام)
        if (parts[1].trim().startsWith("14") && parts[1].trim().length === 4) {
          extractedData.licenseNumber = parts[0].trim();
          extractedData.licenseHijriYear = parts[1].trim();
        } else if (
          parts[0].trim().startsWith("14") &&
          parts[0].trim().length === 4
        ) {
          extractedData.licenseNumber = parts[1].trim();
          extractedData.licenseHijriYear = parts[0].trim();
        }
      }
    }

    // --- 3. رادار التكرار الذكي (Duplicate Detection Logic) ---
    let duplicateWarning = "";

    // أ) فحص التطابق برقم الرخصة
    if (
      extractedData.licenseNumber &&
      String(extractedData.licenseNumber).trim() !== ""
    ) {
      const existingByLicense = await prisma.archivedProject.findFirst({
        where: {
          id: { not: projectId },
          licenseNumber: String(extractedData.licenseNumber).trim(),
        },
      });
      if (existingByLicense) {
        duplicateWarning += `⚠️ تنبيه تكرار قوي: تم العثور على مشروع مسجل مسبقاً برمز (${existingByLicense.archiveCode}) يحمل نفس رقم رخصة البناء!\n\n`;
      }
    }

    // ب) فحص التطابق برقم المخطط وتقاطع القطع
    if (
      extractedData.planNumber &&
      Array.isArray(extractedData.plots) &&
      extractedData.plots.length > 0
    ) {
      const projectsWithSamePlan = await prisma.archivedProject.findMany({
        where: {
          id: { not: projectId },
          planNumber: String(extractedData.planNumber).trim(),
        },
      });

      const extractedPlotsStr = extractedData.plots.map((p) =>
        String(p).trim(),
      );

      for (const proj of projectsWithSamePlan) {
        const dbPlots = Array.isArray(proj.plots)
          ? proj.plots.map((p) => String(p).trim())
          : [];

        const hasOverlap = extractedPlotsStr.some((plot) =>
          dbPlots.includes(plot),
        );

        if (hasOverlap) {
          duplicateWarning += `⚠️ تنبيه تكرار موقع: تم العثور على مشروع سابق برمز (${proj.archiveCode}) يقع في نفس المخطط ويتقاطع في أرقام القطع. قد يكون هذا المشروع مرفوعاً مسبقاً!\n\n`;
          break;
        }
      }
    }

    const finalArchiveNotes =
      duplicateWarning + (extractedData.archiveNotes || "");

    // --- 4. تحديث بيانات المشروع النهائية في قاعدة البيانات ---
    const updatedProject = await prisma.archivedProject.update({
      where: { id: projectId },
      data: {
        title: extractedData.title || "مشروع مؤرشف (مستخرج آلياً)",
        projectType: extractedData.projectType || "غير محدد",
        transactionType: extractedData.transactionType,

        ownerName: finalOwnerName,
        designerOfficeName: finalDesignerOffice,
        supervisorOfficeName: finalSupervisorOffice,

        // هنا نستخدم النوع الذي استنتجناه نحن بدلاً من الذكاء الاصطناعي لضمان الدقة
        ownerType: finalOwnerType,

        sectorName: extractedData.sectorName,
        districtName: extractedData.districtName,
        contactMobile: extractedData.contactMobile,
        poBox: extractedData.poBox,
        requestNumber: extractedData.requestNumber ? String(extractedData.requestNumber) : null,
        requestYear: extractedData.requestYear ? String(extractedData.requestYear) : null,
        serviceNumber: extractedData.serviceNumber ? String(extractedData.serviceNumber) : null,
        serviceYear: extractedData.serviceYear ? String(extractedData.serviceYear) : null,

        licenseNumber: extractedData.licenseNumber,
        licenseHijriYear: extractedData.licenseHijriYear
          ? String(extractedData.licenseHijriYear)
          : null,
        licenseIssueDate: extractedData.licenseIssueDate
          ? new Date(extractedData.licenseIssueDate)
          : null,
        licenseExpiryDate: extractedData.licenseExpiryDate
          ? new Date(extractedData.licenseExpiryDate)
          : null,

        deedNumber: extractedData.deedNumber,
        deedDate: extractedData.deedDate
          ? new Date(extractedData.deedDate)
          : null,
        city: extractedData.city,
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

        archiveNotes: finalArchiveNotes,
        aiConfidence: extractedData.aiConfidence || 0,
        aiStatus: "completed",
      },
    });

    // --- 5. التسجيل التلقائي للرخصة في جدول الرخص ---
    if (
      extractedData.licenseNumber &&
      extractedData.licenseNumber.trim() !== ""
    ) {
      try {
        const existingPermit = await prisma.permit.findFirst({
          where: {
            permitNumber: extractedData.licenseNumber,
            hijriYear: extractedData.licenseHijriYear
              ? String(extractedData.licenseHijriYear)
              : undefined,
          },
        });

        if (!existingPermit) {
          await prisma.permit.create({
            data: {
              permitNumber: extractedData.licenseNumber,
              hijriYear: extractedData.licenseHijriYear
                ? String(extractedData.licenseHijriYear)
                : null,
              issueDate: extractedData.licenseIssueDate
                ? new Date(extractedData.licenseIssueDate)
                : null,
              expiryDate: extractedData.licenseExpiryDate
                ? new Date(extractedData.licenseExpiryDate)
                : null,
              ownerName: finalOwnerName,
            },
          });
          console.log(
            `✅ تم تسجيل الرخصة ${extractedData.licenseNumber} تلقائياً.`,
          );
        }
      } catch (permitError) {
        console.error(
          "🔥 خطأ أثناء التسجيل التلقائي للرخصة:",
          permitError.message,
        );
      }
    }

    if (employeeId) {
      await createSystemNotification(
        employeeId,
        "اكتمل التحليل بذكاء 🧠",
        `تم تحليل المشروع. ${duplicateWarning ? "⚠️ توجد تنبيهات تكرار يرجى مراجعتها!" : "البيانات جاهزة للاعتماد."}`,
        duplicateWarning ? "warning" : "success",
      );
    }
  } catch (error) {
    console.error(`🔥 [Background Job Error] فشل معالجة المشروع:`, error);
    await prisma.archivedProject.update({
      where: { id: projectId },
      data: {
        aiStatus: "failed",
        archiveNotes: `فشل التحليل: ${error.message}`,
      },
    });
  } finally {
    // التنظيف الإلزامي لملفات سيرفرات Gemini
    for (const file of uploadedGeminiFiles) {
      try {
        await ai.files.delete({ name: file.name });
      } catch (e) {}
    }
  }
};

// ============================================================================
// 3. مسارات واجهة برمجة التطبيقات (API Controllers)
// ============================================================================

exports.initiateProjectArchive = async (req, res) => {
  try {
    const files = req.files;
    const employeeId = req.user?.id;
    // 💡 التقاط مستوى الضغط المرسل من الواجهة
    const compressionLevel = req.body.compressionLevel || "medium";

    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرفاق ملفات" });
    }

    // ========================================================
    // تقليل حجم الملفات (Optimization) بناءً على خيار المستخدم
    // ========================================================
    if (typeof optimizeFile === "function" && compressionLevel !== "none") {
      console.log(`🗜️ جاري تقليل حجم الملفات (مستوى: ${compressionLevel})...`);
      for (let file of files) {
        // نمرر مستوى الضغط לדالة التحسين
        await optimizeFile(file.path, file.mimetype, compressionLevel);
        file.size = fs.statSync(file.path).size;
      }
      console.log("✅ تمت عملية تقليل أحجام الملفات بنجاح.");
    }

    const currentYear = new Date().getFullYear();
    const lastProject = await prisma.archivedProject.findFirst({
      where: { archiveCode: { startsWith: `ARC-${currentYear}-` } },
      orderBy: { createdAt: "desc" },
    });

    let nextNumber = 1;
    if (lastProject && lastProject.archiveCode) {
      const parts = lastProject.archiveCode.split("-");
      if (parts.length === 3) nextNumber = parseInt(parts[2], 10) + 1;
    }
    const archiveCode = `ARC-${currentYear}-${String(nextNumber).padStart(3, "0")}`;

    const processedFilesForDB = files.map((file) => ({
      fileName: file.filename,
      originalName: file.originalname,
      fileUrl: `/uploads/archived_projects/${file.filename}`,
      fileType: file.mimetype,
      fileSize: file.size,
    }));

    const archivedProject = await prisma.archivedProject.create({
      data: {
        archiveCode,
        title: "جاري تحليل المشروع...",
        projectType: "قيد التحليل",
        aiStatus: "pending",
        archivedById: employeeId,
        files: { create: processedFilesForDB },
      },
      include: { files: true },
    });

    const originalFilesContext = archivedProject.files.map((dbFile, index) => ({
      ...dbFile,
      filePath: files[index].path,
    }));

    // إطلاق معالجة الذكاء الاصطناعي
    processFilesWithGemini(
      archivedProject.id,
      originalFilesContext,
      employeeId,
    ).catch(console.error);

    return res.status(201).json({
      success: true,
      message:
        "تم استلام الملفات وتقليص حجمها. النظام يقوم حالياً بتحليلها بالذكاء الاصطناعي ومطابقتها لمنع التكرار.",
      data: {
        projectId: archivedProject.id,
        archiveCode: archivedProject.archiveCode,
      },
    });
  } catch (error) {
    console.error("Error initiating project archive:", error);
    if (error.code === "P2002") {
      return res
        .status(409)
        .json({ success: false, message: "حدث تعارض في كود الأرشفة." });
    }
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء تهيئة الأرشيف" });
  }
};

exports.createManualArchive = async (req, res) => {
  try {
    const employeeId = req.user?.id;

    const currentYear = new Date().getFullYear();
    const lastProject = await prisma.archivedProject.findFirst({
      where: { archiveCode: { startsWith: `ARC-${currentYear}-` } },
      orderBy: { createdAt: "desc" },
    });

    let nextNumber = 1;
    if (lastProject && lastProject.archiveCode) {
      const parts = lastProject.archiveCode.split("-");
      if (parts.length === 3) nextNumber = parseInt(parts[2], 10) + 1;
    }
    const archiveCode = `ARC-${currentYear}-${String(nextNumber).padStart(3, "0")}`;

    const archivedProject = await prisma.archivedProject.create({
      data: {
        archiveCode,
        title: "مشروع جديد (إدخال يدوي)",
        projectType: "غير محدد",
        aiStatus: "approved",
        aiConfidence: 0,
        archivedById: employeeId,
        approvedById: employeeId,
      },
    });

    if (employeeId) {
      await createSystemNotification(
        employeeId,
        "تم فتح سجل جديد 📝",
        `تم إنشاء السجل المبدئي للمشروع برقم (${archiveCode}). يرجى استكمال إدخال البيانات وحفظها.`,
        "info",
      );
    }

    return res.status(201).json({
      success: true,
      message: "تم إنشاء المشروع اليدوي بنجاح",
      data: { projectId: archivedProject.id },
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "فشل إنشاء المشروع اليدوي" });
  }
};

exports.getArchivedProjectDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const project = await prisma.archivedProject.findUnique({
      where: { id },
      include: {
        client: { select: { name: true, idNumber: true } },
        district: { select: { id: true, name: true, sectorId: true } },
        archivedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        files: true,
      },
    });

    if (!project)
      return res
        .status(404)
        .json({ success: false, message: "المشروع غير موجود" });
    return res.status(200).json({ success: true, data: project });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "خطأ في جلب البيانات" });
  }
};

exports.updateArchivedProject = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const employeeId = req.user?.id;

    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    const objectsToRemove = [
      "client",
      "district",
      "designerOffice",
      "supervisorOffice",
      "archivedBy",
      "approvedBy",
      "files",
    ];
    objectsToRemove.forEach((obj) => delete updateData[obj]);

    const relations = [
      { field: "clientId", relation: "client" },
      { field: "districtId", relation: "district" },
      { field: "designerOfficeId", relation: "designerOffice" },
      { field: "supervisorOfficeId", relation: "supervisorOffice" },
    ];

    relations.forEach(({ field, relation }) => {
      if (updateData[field] !== undefined) {
        const idValue = updateData[field];
        if (idValue && idValue.trim() !== "") {
          updateData[relation] = { connect: { id: idValue } };
        } else {
          updateData[relation] = { disconnect: true };
        }
        delete updateData[field];
      }
    });

    delete updateData.archivedById;
    delete updateData.approvedById;

    const updatedProject = await prisma.archivedProject.update({
      where: { id },
      data: {
        ...updateData,
        aiStatus: "approved",
        approvedBy: employeeId ? { connect: { id: employeeId } } : undefined,
      },
    });

    if (employeeId) {
      await createSystemNotification(
        employeeId,
        "تم الاعتماد بنجاح ✅",
        `تم حفظ بيانات المشروع النهائي.`,
        "success",
      );
    }

    return res.status(200).json({ success: true, data: updatedProject });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء حفظ التعديلات" });
  }
};

exports.reanalyzeProject = async (req, res) => {
  try {
    const { id } = req.params;
    const employeeId = req.user?.id;

    // 1. جلب المشروع مع ملفاته
    const project = await prisma.archivedProject.findUnique({
      where: { id },
      include: { files: true }
    });

    if (!project) {
      return res.status(404).json({ success: false, message: "المشروع غير موجود." });
    }
    
    if (!project.files || project.files.length === 0) {
      return res.status(400).json({ success: false, message: "لا توجد ملفات مرفقة بهذا المشروع لإعادة تحليلها." });
    }

    // 2. تحويل الروابط (fileUrl) إلى مسارات فيزيائية حقيقية (filePath) لكي يستطيع Gemini قراءتها
    const originalFilesContext = project.files.map(file => {
       const filename = path.basename(file.fileUrl); // استخراج اسم الملف من الرابط
       return {
         ...file,
         filePath: path.join(__dirname, "../../uploads/archived_projects", filename)
       };
    });

    // 3. تحديث حالة المشروع إلى "قيد المعالجة"
    await prisma.archivedProject.update({
      where: { id },
      data: { aiStatus: "pending" }
    });

    // 4. تشغيل التحليل في الخلفية (نفس الدالة التي تعمل عند الإنشاء)
    processFilesWithGemini(id, originalFilesContext, employeeId).catch(console.error);

    return res.status(200).json({ success: true, message: "جاري إعادة التحليل..." });
    
  } catch (error) {
    console.error("Error reanalyzing project:", error);
    return res.status(500).json({ success: false, message: "خطأ في تهيئة إعادة التحليل" });
  }
};

exports.mergeProjects = async (req, res) => {
  try {
    const { currentProjectId } = req.params;
    const { targetArchiveCode } = req.body;
    const employeeId = req.user?.id;

    // 1. جلب المشروع القديم المستهدف
    const targetProject = await prisma.archivedProject.findFirst({
      where: { archiveCode: targetArchiveCode }
    });

    if (!targetProject) {
      return res.status(404).json({ success: false, message: "لم يتم العثور على المشروع القديم المستهدف." });
    }

    // 2. جلب المشروع الجديد (الذي سنأخذ منه الملفات ثم نحذفه)
    const currentProject = await prisma.archivedProject.findUnique({
      where: { id: currentProjectId },
      include: { files: true }
    });

    if (!currentProject) {
      return res.status(404).json({ success: false, message: "المشروع الحالي غير موجود." });
    }

    // 3. نقل الملفات في قاعدة البيانات: تغيير معرف المشروع المربوطة به إلى القديم
    if (currentProject.files && currentProject.files.length > 0) {
      await prisma.archivedProjectFile.updateMany({
        where: { archivedProjectId: currentProjectId },
        data: { archivedProjectId: targetProject.id }
      });
    }

    // 4. حذف المشروع الجديد (الفارغ الآن من الملفات)
    // هذا سيجعل رقمه متاحاً للعملية القادمة تلقائياً (لا يوجد Gap)
    await prisma.archivedProject.delete({
      where: { id: currentProjectId }
    });

    // 5. جلب الملفات المجمعة للمشروع القديم لإعادة تحليلها
    const updatedTargetProject = await prisma.archivedProject.findUnique({
      where: { id: targetProject.id },
      include: { files: true }
    });

    const originalFilesContext = updatedTargetProject.files.map(file => {
      const filename = path.basename(file.fileUrl);
      return {
        ...file,
        filePath: path.join(__dirname, "../../uploads/archived_projects", filename)
      };
    });

    // 6. تغيير حالة القديم وتمريره للذكاء الاصطناعي
    await prisma.archivedProject.update({
      where: { id: targetProject.id },
      data: { aiStatus: "pending", archiveNotes: "تم دمج ملفات جديدة. جاري إعادة التحليل..." }
    });

    // تشغيل دالة التحليل في الخلفية (نفس دالة إعادة التحليل)
    if (typeof processFilesWithGemini === "function") {
       processFilesWithGemini(targetProject.id, originalFilesContext, employeeId).catch(console.error);
    }

    return res.status(200).json({ 
      success: true, 
      message: "تم دمج الملفات بنجاح وحذف السجل المكرر. جاري إعادة التحليل للمشروع الأقدم.",
      data: { targetProjectId: targetProject.id } // إرجاع ID القديم ليفتحه الفرونت إند
    });

  } catch (error) {
    console.error("Error merging projects:", error);
    return res.status(500).json({ success: false, message: "حدث خطأ أثناء عملية الدمج." });
  }
};

exports.getAllArchivedProjects = async (req, res) => {
  try {
    const projects = await prisma.archivedProject.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true } },
        archivedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        _count: { select: { files: true } },
      },
    });
    return res.status(200).json({ success: true, data: projects });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "خطأ أثناء جلب الأرشيف" });
  }
};

exports.deleteArchivedProject = async (req, res) => {
  try {
    const { id } = req.params;

    // البحث عن الملفات لحذفها فيزيائياً
    const projectFiles = await prisma.archivedProjectFile.findMany({
      where: { archivedProjectId: id },
    });

    for (const file of projectFiles) {
      try {
        const physicalPath = path.join(__dirname, "../../", file.fileUrl);
        if (fs.existsSync(physicalPath)) fs.unlinkSync(physicalPath);
      } catch (e) {}
    }

    await prisma.archivedProject.delete({ where: { id } });
    return res
      .status(200)
      .json({ success: true, message: "تم حذف المشروع بنجاح" });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء الحذف" });
  }
};

// ============================================================================
// 4. مسارات إدارة المرفقات (الملفات الفردية)
// ============================================================================

exports.uploadArchiveFile = async (req, res) => {
  try {
    const { projectId } = req.params;
    const file = req.file;
    // التقاط مستوى الضغط إن وجد
    const compressionLevel = req.body.compressionLevel || "medium";

    if (!file)
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرفاق أي ملف." });

    if (typeof optimizeFile === "function" && compressionLevel !== "none") {
      await optimizeFile(file.path, file.mimetype, compressionLevel);
      file.size = fs.statSync(file.path).size;
    }

    const newFile = await prisma.archivedProjectFile.create({
      data: {
        archivedProjectId: projectId,
        fileName: file.filename,
        originalName: file.originalname,
        fileUrl: `/uploads/archived_projects/${file.filename}`,
        fileType: file.mimetype,
        fileSize: file.size,
      },
    });

    return res.status(201).json({ success: true, data: newFile });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "خطأ أثناء رفع الملف." });
  }
};

exports.renameArchiveFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { originalName } = req.body;

    if (!originalName) return res.status(400).json({ success: false });

    const updatedFile = await prisma.archivedProjectFile.update({
      where: { id: fileId },
      data: { originalName: originalName.trim() },
    });

    return res.status(200).json({ success: true, data: updatedFile });
  } catch (error) {
    return res.status(500).json({ success: false });
  }
};

exports.deleteArchiveFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileRecord = await prisma.archivedProjectFile.findUnique({
      where: { id: fileId },
    });

    if (!fileRecord) return res.status(404).json({ success: false });

    await prisma.archivedProjectFile.delete({ where: { id: fileId } });

    try {
      const physicalPath = path.join(__dirname, "../../", fileRecord.fileUrl);
      if (fs.existsSync(physicalPath)) fs.unlinkSync(physicalPath);
    } catch (e) {}

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false });
  }
};

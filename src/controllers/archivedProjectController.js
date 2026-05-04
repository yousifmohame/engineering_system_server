const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const { GoogleGenAI } = require("@google/genai");

// 👈 1. استيراد دالة الإشعارات (تأكد من صحة المسار حسب هيكل مشروعك)
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
2. إذا لم تكن المعلومة موجودة في المستندات، قم بإرجاع القيمة null للنصوص و 0 للأرقام (لا تخمن أبداً).
3. الأرقام: حول أي رقم هندي (١،٢،٣) إلى إنجليزي (1,2,3).
4. المساحات والأطوال: استخرج الرقم فقط (Float).

يجب أن يكون الناتج حصرياً بصيغة JSON متوافق تماماً مع هذا الهيكل:
{
  "title": "اسم المشروع أو وصفه العام المستنتج",
  "projectType": "سكني أو تجاري أو متعدد الاستخدامات أو صناعي",
  "transactionType": "إصدار رخصة، أو تعديل مكونات، أو إضافة ملحق، أو فرز...",
  "ownerName": "اسم المالك (رباعي إذا كان فرداً، أو اسم الشركة)",
  "ownerType": "اعتباري (إذا كان شركة/مؤسسة) أو طبيعي (إذا كان أفراد)",
  "contactMobile": "أي رقم جوال مسجل للمالك",
  "poBox": "صندوق البريد أو الرمز البريدي إن وجد",
  "licenseNumber": "رقم رخصة البناء",
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
  "designerOfficeName": "اسم المكتب الهندسي المصمم",
  "supervisorOfficeName": "اسم المكتب الهندسي المشرف",
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
// 💡 تمت إضافة employeeId لكي نعرف من نرسل له الإشعار
const analyzeProjectFilesWithGemini = async (projectId, files, employeeId) => {
  const uploadedGeminiFiles = [];

  try {
    console.log(`🚀 [Gemini] بدء التحليل للمشروع: ${projectId}`);

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
      }
    }

    if (uploadedGeminiFiles.length === 0) {
      throw new Error("لم يتم رفع أي ملفات صالحة للتحليل.");
    }

    const fileParts = uploadedGeminiFiles.map((file) => ({
      fileData: { fileUri: file.uri, mimeType: file.mimeType },
    }));

    // 2. استدعاء الموديل
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [
        "يرجى تحليل جميع هذه المستندات واستخراج البيانات الهندسية والقانونية المطلوبة بصيغة JSON.",
        ...fileParts,
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    // 3. تنظيف ومعالجة المخرجات
    let responseText = response.text || "";
    responseText = responseText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const cleanedContent = responseText.replace(/[٠-٩]/g, (d) =>
      "٠١٢٣٤٥٦٧٨٩".indexOf(d),
    );
    const extractedData = JSON.parse(cleanedContent);

    // 4. حفظ البيانات في قاعدة البيانات
    const updatedProject = await prisma.archivedProject.update({
      where: { id: projectId },
      data: {
        title: extractedData.title || "مشروع مؤرشف (مستخرج آلياً)",
        projectType: extractedData.projectType || "غير محدد",
        transactionType: extractedData.transactionType,
        ownerName: extractedData.ownerName,
        ownerType: extractedData.ownerType,
        sectorName: extractedData.sectorName,
        districtName: extractedData.districtName,
        designerOfficeName: extractedData.designerOfficeName,
        supervisorOfficeName: extractedData.supervisorOfficeName,
        contactMobile: extractedData.contactMobile,
        poBox: extractedData.poBox,
        licenseNumber: extractedData.licenseNumber,
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
        archiveNotes: extractedData.archiveNotes,
        aiConfidence: extractedData.aiConfidence || 0,
        aiStatus: "completed",
      },
    });

    console.log(`✅ [Gemini] تم استخراج البيانات بنجاح للمشروع: ${projectId}`);

    // 🔔 إرسال إشعار للموظف بنجاح التحليل
    if (employeeId) {
      await createSystemNotification(
        employeeId,
        "اكتمل التحليل الذكي 🧠",
        `تم تحليل المستندات واستخراج البيانات بنجاح لمشروع "${updatedProject.title}". يرجى الدخول لمراجعتها واعتمادها.`,
        "success",
      );
    }
  } catch (error) {
    console.error(`🔥 [Gemini Error] فشل التحليل للمشروع ${projectId}:`, error);
    await prisma.archivedProject.update({
      where: { id: projectId },
      data: {
        aiStatus: "failed",
        archiveNotes: `فشل التحليل: ${error.message}`,
      },
    });

    // 🔔 إرسال إشعار للموظف بفشل التحليل
    if (employeeId) {
      await createSystemNotification(
        employeeId,
        "فشل تحليل المستندات ⚠️",
        `لم يتمكن الذكاء الاصطناعي من قراءة مستندات المشروع الأخير. يرجى إدخال البيانات يدوياً.`,
        "error",
      );
    }
  } finally {
    // 5. التنظيف الإلزامي
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

    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرفاق ملفات" });
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

    const filesForGemini = archivedProject.files.map((dbFile, index) => ({
      ...dbFile,
      filePath: files[index].path,
    }));

    // تمرير employeeId لدالة الخلفية
    if (typeof analyzeProjectFilesWithGemini === "function") {
      analyzeProjectFilesWithGemini(
        archivedProject.id,
        filesForGemini,
        employeeId,
      ).catch(console.error);
    }

    return res.status(201).json({
      success: true,
      message:
        "تم استلام الملفات بنجاح. الذكاء الاصطناعي يقوم الآن بتحليلها في الخلفية.",
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
        .json({
          success: false,
          message: "حدث تعارض في كود الأرشفة، يرجى المحاولة مرة أخرى.",
        });
    }
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء تهيئة الأرشيف" });
  }
};

exports.createManualArchive = async (req, res) => {
  try {
    const employeeId = req.user?.id; // أمان: الاعتماد على التوكن فقط

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
        approvedById: employeeId, // المعتمد هو نفسه المنشئ في الحالة اليدوية
      },
    });

    // 🔔 إشعار بإنشاء السجل اليدوي
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
    console.error("Error creating manual archive:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل إنشاء المشروع اليدوي" });
  }
};

// ج. جلب بيانات المشروع
exports.getArchivedProjectDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const project = await prisma.archivedProject.findUnique({
      where: { id },
      include: {
        client: { select: { name: true, idNumber: true } },
        district: { select: { id: true, name: true, sectorId: true } },
        archivedBy: { select: { name: true } },
        // 👈 التعديل هنا: جلب اسم الموظف المعتمد
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
    console.error("Error fetching archived project:", error);
    return res
      .status(500)
      .json({ success: false, message: "خطأ في جلب البيانات" });
  }
};

// د. تحديث المشروع واعتماده النهائي
exports.updateArchivedProject = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const employeeId = req.user?.id; // الموظف الذي يقوم بالاعتماد الآن

    // 1. تنظيف الحقول المحمية
    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    // 2. تنظيف الكائنات الفرعية (Nested Objects)
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

    // 3. تحويل الـ IDs المسطحة إلى صيغة الربط الآمنة
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

    // حذف هذه الحقول إن جاءت من الواجهة لحمايتها
    delete updateData.archivedById;
    delete updateData.approvedById;

    // 4. التحديث الفعلي مع توثيق الموظف المعتمد
    const updatedProject = await prisma.archivedProject.update({
      where: { id },
      data: {
        ...updateData,
        aiStatus: "approved",
        approvedBy: employeeId ? { connect: { id: employeeId } } : undefined,
      },
    });

    // 🔔 إشعار بالاعتماد النهائي
    if (employeeId) {
      await createSystemNotification(
        employeeId,
        "تم الاعتماد بنجاح ✅",
        `تم حفظ واعتماد بيانات المشروع "${updatedProject.title}" بشكل نهائي في الأرشيف.`,
        "success",
      );
    }

    return res.status(200).json({ success: true, data: updatedProject });
  } catch (error) {
    console.error("Error updating archived project:", error);
    if (error.code === "P2003") {
      return res
        .status(400)
        .json({
          success: false,
          message: "فشل الحفظ: أحد المعرفات المرتبطة غير صالح.",
        });
    }
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, message: "فشل الحفظ: المشروع غير موجود." });
    }
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء حفظ التعديلات" });
  }
};

// هـ. جلب كل المشاريع المؤرشفة
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
    console.error("Error fetching projects:", error);
    return res
      .status(500)
      .json({ success: false, message: "خطأ أثناء جلب الأرشيف" });
  }
};

exports.deleteArchivedProject = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.archivedProject.delete({ where: { id } });
    return res
      .status(200)
      .json({ success: true, message: "تم حذف المشروع بنجاح" });
  } catch (error) {
    console.error("Error deleting archived project:", error);
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء الحذف" });
  }
};

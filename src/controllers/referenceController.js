const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");

const { aiQueue } = require('../queue/aiQueue');


const addLog = async (referenceId, action, req) => {
  const userName = req.body?.userName || req.user?.name || "مستخدم غير معروف";
  const userEmail = req.body?.userEmail || req.user?.email || "";
  await prisma.referenceLog.create({
    data: { referenceId, action, userName, userEmail },
  });
};

// ==========================================
// 💡 الرفع السريع والتحليل من النافذة الجديدة (ModalUploadReferenceAi)
// ==========================================
exports.analyzeReferenceAsync = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "لم يتم إرسال أي مستند." });
    }

    // 1. نقل الملف للمجلد الدائم
    const tempPath = req.file.path;
    const targetDir = path.join(__dirname, '../../uploads/references');
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    
    const fileName = `ref_${Date.now()}_${req.file.originalname}`;
    const targetPath = path.join(targetDir, fileName);
    fs.copyFileSync(tempPath, targetPath);
    
    const savedAttachmentUrl = `/uploads/references/${fileName}`;

    // 2. إنشاء مهمة في جدول AiJob
    const aiJob = await prisma.aiJob.create({
      data: {
        jobType: 'ANALYZE_REFERENCE',
        status: 'PENDING',
        targetType: 'REFERENCE_DOCUMENT',
        requestedBy: req.user?.id || null
      }
    });
    
    
    // 3. إضافة المهمة للطابور
    await aiQueue.add('analyze_reference_job', {
      dbJobId: aiJob.id,
      jobType: 'ANALYZE_REFERENCE',
      filePathsArray: [targetPath], // نمرر المسار الدائم
      mimeTypesArray: [req.file.mimetype],
      savedAttachmentUrl: savedAttachmentUrl,
      employeeId: req.user?.id,
      fixedCategory: req.body.fixedCategory
    });

    // حذف الملف المؤقت لأنه نُسخ
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

    // 4. الرد فوراً برقم المهمة
    res.status(202).json({ 
      success: true, 
      message: "تم الاستلام وجاري التحليل في الخلفية.",
      jobId: aiJob.id 
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getReferences = async (req, res) => {
  try {
    const references = await prisma.referenceDocument.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: references });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createReference = async (req, res) => {
  try {
    const {
      title,
      source,
      category,
      type,
      city,
      sector,
      txType,
      txMainCategory,
      txSubCategory,
      issueDate,
      expiryDate,
      autoAnalyze,
    } = req.body;

    const buildingTypes = req.body.buildingTypes
      ? JSON.parse(req.body.buildingTypes)
      : [];
    const districts = req.body.districts ? JSON.parse(req.body.districts) : [];

    const landAreaFrom = req.body.landAreaFrom
      ? parseFloat(req.body.landAreaFrom)
      : null;
    const landAreaTo = req.body.landAreaTo
      ? parseFloat(req.body.landAreaTo)
      : null;
    const floorsFrom = req.body.floorsFrom
      ? parseInt(req.body.floorsFrom)
      : null;
    const floorsTo = req.body.floorsTo ? parseInt(req.body.floorsTo) : null;
    const streetWidthFrom = req.body.streetWidthFrom
      ? parseInt(req.body.streetWidthFrom)
      : null;
    const streetWidthTo = req.body.streetWidthTo
      ? parseInt(req.body.streetWidthTo)
      : null;

    // 🚀 دعم الملفات المتعددة
    let fileUrls = [];
    let absoluteFilePaths = [];
    let mimeTypes = [];

    // التعامل مع رفع عدة ملفات عبر req.files أو ملف واحد عبر req.file
    const uploadedFiles =
      req.files && req.files.length > 0
        ? req.files
        : req.file
          ? [req.file]
          : [];

    uploadedFiles.forEach((file) => {
      fileUrls.push(`/uploads/references/${file.filename}`);
      absoluteFilePaths.push(
        path.join(
          __dirname,
          "..",
          "..",
          "uploads",
          "references",
          file.filename,
        ),
      );
      mimeTypes.push(file.mimetype);
    });

    const fileUrlString = fileUrls.length > 0 ? fileUrls.join(",") : null;

    const newRef = await prisma.referenceDocument.create({
      data: {
        title,
        source,
        category,
        type,
        city,
        sector,
        txType,
        txMainCategory,
        txSubCategory,
        buildingTypes,
        districts,
        landAreaFrom,
        landAreaTo,
        floorsFrom,
        floorsTo,
        streetWidthFrom,
        streetWidthTo,
        issueDate: issueDate ? new Date(issueDate) : null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        fileUrl: fileUrlString,
        analysisStatus:
          autoAnalyze === "true" && absoluteFilePaths.length > 0
            ? "قيد التحليل"
            : "غير محلل",
      },
    });

    // إطلاق التحليل المباشر للملفات المتعددة
    if (autoAnalyze === "true" && absoluteFilePaths.length > 0) {
      analyzeReferenceBackground(
        newRef.id,
        absoluteFilePaths,
        mimeTypes,
        "full",
      );
    }

    req.body.userName = req.user?.name;
    await addLog(newRef.id, "إضافة مرجع جديد للمكتبة", req);

    res.status(201).json({ success: true, data: newRef });
  } catch (error) {
    console.error("Create Reference Error:", error);
    res.status(500).json({ success: false, message: "فشل حفظ المرجع" });
  }
};

exports.updateManualNotes = async (req, res) => {
  try {
    const { id } = req.params;
    const { manualNotes } = req.body;
    await prisma.referenceDocument.update({
      where: { id },
      data: { manualNotes },
    });
    await addLog(id, "تم تحديث توجيهات وملاحظات الإدارة", req);
    res.json({ success: true, message: "تم الحفظ بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteReference = async (req, res) => {
  try {
    const { id } = req.params;
    const ref = await prisma.referenceDocument.findUnique({ where: { id } });

    if (ref && ref.fileUrl) {
      // التعامل مع حذف الملفات المتعددة المرتبطة بالمرجع
      const urls = ref.fileUrl.split(",");
      urls.forEach((url) => {
        const filename = url.split("/").pop();
        const filePath = path.join(
          __dirname,
          "..",
          "..",
          "uploads",
          "references",
          filename,
        );
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });
    }

    await prisma.referenceDocument.delete({ where: { id } });
    res.json({ success: true, message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getReferenceLogs = async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await prisma.referenceLog.findMany({
      where: { referenceId: id },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// دالة مساعدة للحصول على المسار الصحيح للملف
const getAbsoluteFilePath = (fileUrl) => {
  const filename = fileUrl.split("/").pop();
  const path1 = path.join(__dirname, "..", "..", "uploads", filename);
  const path2 = path.join(
    __dirname,
    "..",
    "..",
    "uploads",
    "references",
    filename,
  );

  if (fs.existsSync(path2)) return path2;
  if (fs.existsSync(path1)) return path1;
  return null;
};

exports.reanalyzeReference = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body;
    const doc = await prisma.referenceDocument.findUnique({ where: { id } });
    if (!doc || !doc.fileUrl)
      return res
        .status(400)
        .json({ success: false, message: "الملف غير موجود للتحليل" });

    await addLog(
      id,
      type === "quick"
        ? "طلب تلخيص سريع للمستند"
        : "طلب إعادة التحليل الذكي الشامل",
      req,
    );

    await prisma.referenceDocument.update({
      where: { id },
      data: { analysisStatus: "قيد التحليل" },
    });

    // 🚀 تجهيز مصفوفة الملفات للتحليل
    const fileUrls = doc.fileUrl.split(",");
    const absoluteFilePaths = [];
    const mimeTypes = [];

    for (const url of fileUrls) {
      const filepath = getAbsoluteFilePath(url);
      if (filepath) {
        absoluteFilePaths.push(filepath);
        const ext = path.extname(filepath).toLowerCase();
        let mType = "application/pdf";
        if (ext === ".png") mType = "image/png";
        else if (ext === ".jpg" || ext === ".jpeg") mType = "image/jpeg";
        else if (ext === ".webp") mType = "image/webp";
        mimeTypes.push(mType);
      }
    }

    if (absoluteFilePaths.length === 0) {
      return res.status(404).json({
        success: false,
        message: "الملفات الفيزيائية غير موجودة على السيرفر",
      });
    }

    // استدعاء دالة التحليل مع تمرير المصفوفات
    analyzeReferenceBackground(id, absoluteFilePaths, mimeTypes, type);

    res.json({ success: true, message: "بدأت عملية التحليل في الخلفية" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateReference = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, source, category, type, city, sector,
      txType, txMainCategory, txSubCategory, issueDate, expiryDate, autoAnalyze
    } = req.body;

    const buildingTypes = req.body.buildingTypes ? JSON.parse(req.body.buildingTypes) : [];
    const districts = req.body.districts ? JSON.parse(req.body.districts) : [];
    
    const landAreaFrom = req.body.landAreaFrom ? parseFloat(req.body.landAreaFrom) : null;
    const landAreaTo = req.body.landAreaTo ? parseFloat(req.body.landAreaTo) : null;
    const floorsFrom = req.body.floorsFrom ? parseInt(req.body.floorsFrom) : null;
    const floorsTo = req.body.floorsTo ? parseInt(req.body.floorsTo) : null;
    const streetWidthFrom = req.body.streetWidthFrom ? parseInt(req.body.streetWidthFrom) : null;
    const streetWidthTo = req.body.streetWidthTo ? parseInt(req.body.streetWidthTo) : null;

    const updateData = {
      title, source, category, type, city, sector, txType, txMainCategory, txSubCategory,
      buildingTypes, districts, landAreaFrom, landAreaTo, floorsFrom, floorsTo, streetWidthFrom, streetWidthTo,
      issueDate: issueDate ? new Date(issueDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
    };

    // إذا تم رفع ملفات جديدة، سنقوم بتحديث المسارات وتهيئة التحليل الجديد إذا طُلب
    let absoluteFilePaths = [];
    let mimeTypes = [];
    const uploadedFiles = req.files && req.files.length > 0 ? req.files : req.file ? [req.file] : [];

    if (uploadedFiles.length > 0) {
      let fileUrls = [];
      uploadedFiles.forEach(file => {
        fileUrls.push(`/uploads/references/${file.filename}`);
        absoluteFilePaths.push(path.join(__dirname, "..", "..", "uploads", "references", file.filename));
        mimeTypes.push(file.mimetype);
      });
      updateData.fileUrl = fileUrls.join(",");
      
      if (autoAnalyze === "true") {
        updateData.analysisStatus = "قيد التحليل";
      }
    }

    const updatedRef = await prisma.referenceDocument.update({
      where: { id },
      data: updateData,
    });

    // تشغيل التحليل في الخلفية للملفات الجديدة
    if (uploadedFiles.length > 0 && autoAnalyze === "true") {
        analyzeReferenceBackground(updatedRef.id, absoluteFilePaths, mimeTypes, "full");
    }

    req.body.userName = req.user?.name;
    await addLog(id, "تعديل بيانات المرجع الأساسية", req);

    res.json({ success: true, data: updatedRef });
  } catch (error) {
    console.error("Update Reference Error:", error);
    res.status(500).json({ success: false, message: "فشل تحديث المرجع" });
  }
};

// تحديث حالة المرجع (نشط / مجمد) مع تسجيل السبب
exports.updateReferenceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, freezeReason } = req.body;

    const updatedRef = await prisma.referenceDocument.update({
      where: { id },
      data: { 
        status,
        // يمكنك إضافة حقل freezeReason في Schema إذا أردت، 
        // أو نكتفي بتسجيله في السجل (Log) كما سنفعل الآن
      },
    });

    // تسجيل العملية في السجل
    const actionText = status === "مجمد" 
      ? `تجميد المرجع. السبب: ${freezeReason}` 
      : "إعادة تنشيط المرجع";

    req.body.userName = req.user?.name || "مدير النظام";
    await addLog(id, actionText, req);

    res.json({ success: true, data: updatedRef });
  } catch (error) {
    console.error("Update Status Error:", error);
    res.status(500).json({ success: false, message: "فشل تحديث حالة المرجع" });
  }
};

exports.reanalyzeReference = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body;
    const doc = await prisma.referenceDocument.findUnique({ where: { id } });
    if (!doc || !doc.fileUrl) return res.status(400).json({ success: false, message: "الملف غير موجود للتحليل" });

    await addLog(id, type === "quick" ? "طلب تلخيص سريع للمستند" : "طلب إعادة التحليل الذكي الشامل", req);

    await prisma.referenceDocument.update({
      where: { id },
      data: { analysisStatus: "قيد التحليل" },
    });

    const fileUrls = doc.fileUrl.split(",");
    const absoluteFilePaths = [];
    const mimeTypes = [];

    for (const url of fileUrls) {
      const filepath = getAbsoluteFilePath(url);
      if (filepath) {
        absoluteFilePaths.push(filepath);
        const ext = path.extname(filepath).toLowerCase();
        let mType = "application/pdf";
        if (ext === ".png") mType = "image/png";
        else if (ext === ".jpg" || ext === ".jpeg") mType = "image/jpeg";
        else if (ext === ".webp") mType = "image/webp";
        mimeTypes.push(mType);
      }
    }

    if (absoluteFilePaths.length === 0) return res.status(404).json({ success: false, message: "الملفات غير موجودة" });

    // 💡 إنشاء مهمة وإضافتها للطابور بدلاً من انتظار التنفيذ
    const aiJob = await prisma.aiJob.create({
      data: { jobType: 'ANALYZE_REFERENCE', status: 'PENDING', targetId: id }
    });

    await aiQueue.add('analyze_reference_job', {
      dbJobId: aiJob.id,
      jobType: 'ANALYZE_REFERENCE',
      filePathsArray: absoluteFilePaths,
      mimeTypesArray: mimeTypes,
      existingDocumentId: id, // لتحديث السجل بدلاً من إنشاء جديد
      analysisType: type,
      employeeId: req.user?.id
    });

    res.json({ success: true, message: "بدأت عملية إعادة التحليل في الخلفية" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
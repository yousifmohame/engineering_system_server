const { PrismaClient } = require("@prisma/client");
const fs = require("fs").promises; // استخدام النسخة غير الموقفة للسيرفر (Async)
const path = require("path");

// استيراد الطوابير (Queues)
const { aiQueue } = require("../queue/aiQueue");
const { optimizationQueue } = require("../queue/optimizationQueue");
const { createSystemNotification } = require("./notificationController");

const prisma = new PrismaClient();

// ============================================================================
// 🛠️ دوال مساعدة (Helper Functions)
// ============================================================================

/**
 * دالة لمسح الملفات الفيزيائية في حال فشل العملية أو الحذف النهائي
 * @param {Array|String} filesPath - مسار الملف أو مصفوفة من مسارات الملفات
 */
const cleanupPhysicalFiles = async (filesPath) => {
  const paths = Array.isArray(filesPath) ? filesPath : [filesPath];
  for (const filePath of paths) {
    if (!filePath) continue;
    try {
      // التعامل مع المسارات سواء كانت كاملة أو نسبية
      const absolutePath =
        filePath.startsWith("/") || filePath.includes(":\\")
          ? filePath
          : path.join(__dirname, "../../", filePath);

      await fs.unlink(absolutePath);
      console.log(`[File System] 🗑️ تم حذف الملف: ${absolutePath}`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        // تجاهل الخطأ إذا كان الملف غير موجود أصلاً
        console.error(
          `[File System] ⚠️ فشل حذف الملف: ${filePath}`,
          error.message,
        );
      }
    }
  }
};

/**
 * دالة لتوليد كود الأرشيف التسلسلي بشكل آمن
 */
const generateArchiveCode = async () => {
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
  return `ARC-${currentYear}-${String(nextNumber).padStart(3, "0")}`;
};

// ============================================================================
// 🚀 الدوال الرئيسية للكنترولر
// ============================================================================

// 1. إنشاء أرشفة جديدة (مع الحماية من الملفات اليتيمة)
exports.initiateProjectArchive = async (req, res) => {
  const uploadedFiles = req.files || [];

  try {
    const employeeId = req.user?.id;
    const compressionLevel = req.body?.compressionLevel || "medium";

    if (uploadedFiles.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرفاق أي ملفات." });
    }

    const archiveCode = await generateArchiveCode();

    const processedFilesForDB = uploadedFiles.map((file) => ({
      fileName: file.filename,
      originalName: file.originalname,
      fileUrl: `/uploads/archived_projects/${file.filename}`,
      fileType: file.mimetype,
      fileSize: file.size,
    }));

    // حفظ المشروع وملفاته في خطوة واحدة
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

    // إضافة الملفات لطابور الضغط
    const optimizationPromises = archivedProject.files.map((dbFile) => {
      const fileInfo = uploadedFiles.find(
        (f) => f.filename === dbFile.fileName,
      );
      if (fileInfo) {
        return optimizationQueue.add("optimize_file", {
          fileId: dbFile.id,
          filePath: fileInfo.path,
          mimeType: fileInfo.mimetype,
          compressionLevel,
        });
      }
    });
    await Promise.all(optimizationPromises);

    // إنشاء سجل المهمة الذكية
    const aiJob = await prisma.aiJob.create({
      data: {
        jobType: "ANALYZE_ARCHIVE",
        targetId: archivedProject.id,
        targetType: "ARCHIVED_PROJECT",
        requestedBy: employeeId,
        status: "PENDING",
      },
    });

    // إرسال المهمة للذكاء الاصطناعي مع إعدادات إعادة المحاولة التلقائية (Exponential Backoff)
    await aiQueue.add(
      "analyze_archive",
      {
        projectId: archivedProject.id,
        employeeId,
        compressionLevel,
        dbJobId: aiJob.id,
        jobType: "ANALYZE_ARCHIVE",
      },
      {
        delay: 5000,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    );

    return res.status(201).json({
      success: true,
      message: "تم استلام الملفات وبدء عملية المعالجة والتحليل الذكي.",
      data: {
        projectId: archivedProject.id,
        archiveCode: archivedProject.archiveCode,
        jobId: aiJob.id,
      },
    });
  } catch (error) {
    console.error("🔥 Error initiating project archive:", error);

    // 🧹 تنظيف الملفات الفيزيائية التي تم رفعها لتجنب تسرب التخزين
    if (uploadedFiles.length > 0) {
      await cleanupPhysicalFiles(uploadedFiles.map((f) => f.path));
    }

    if (error.code === "P2002") {
      return res
        .status(409)
        .json({
          success: false,
          message: "حدث تعارض في النظام، يرجى المحاولة مرة أخرى.",
        });
    }
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ داخلي أثناء تهيئة الأرشيف." });
  }
};

// 2. إعادة تحليل مشروع
exports.reanalyzeProject = async (req, res) => {
  try {
    const { id } = req.params;
    const employeeId = req.user?.id;
    const compressionLevel = req.body?.compressionLevel || "medium";

    const project = await prisma.archivedProject.findUnique({
      where: { id },
      include: { files: true },
    });

    if (!project)
      return res
        .status(404)
        .json({ success: false, message: "المشروع المطلوب غير موجود." });
    if (!project.files || project.files.length === 0)
      return res
        .status(400)
        .json({
          success: false,
          message: "المشروع لا يحتوي على ملفات قابلة للتحليل.",
        });

    // التحقق مما إذا كان المشروع قيد التحليل بالفعل لتجنب تكرار المهام
    if (project.aiStatus === "pending" || project.aiStatus === "processing") {
      return res
        .status(429)
        .json({
          success: false,
          message: "المشروع قيد التحليل بالفعل، يرجى الانتظار.",
        });
    }

    await prisma.archivedProject.update({
      where: { id },
      data: { aiStatus: "pending", aiConfidence: null },
    });

    const aiJob = await prisma.aiJob.create({
      data: {
        jobType: "REANALYZE_ARCHIVE",
        targetId: project.id,
        targetType: "ARCHIVED_PROJECT",
        requestedBy: employeeId,
        status: "PENDING",
      },
    });

    await aiQueue.add(
      "reanalyze_archive",
      {
        projectId: project.id,
        employeeId,
        compressionLevel,
        dbJobId: aiJob.id,
        jobType: "REANALYZE_ARCHIVE",
      },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
    );

    return res
      .status(200)
      .json({
        success: true,
        message: "تم إدراج المشروع في طابور إعادة التحليل بنجاح.",
      });
  } catch (error) {
    console.error("🔥 Error reanalyzing project:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: "تعذر بدء عملية إعادة التحليل بسبب خطأ في السيرفر.",
      });
  }
};

// 3. دمج المشاريع (آمن بالكامل باستخدام Prisma Transaction)
exports.mergeProjects = async (req, res) => {
  try {
    const { currentProjectId } = req.params;
    const { targetArchiveCode } = req.body;
    const employeeId = req.user?.id;
    const compressionLevel = req.body?.compressionLevel || "medium";

    if (!targetArchiveCode) {
      return res
        .status(400)
        .json({
          success: false,
          message: "يرجى تحديد كود المشروع المستهدف للدمج.",
        });
    }

    const currentProject = await prisma.archivedProject.findUnique({
      where: { id: currentProjectId },
      include: { files: true },
    });

    if (!currentProject)
      return res
        .status(404)
        .json({ success: false, message: "المشروع الحالي غير موجود." });

    const targetProject = await prisma.archivedProject.findFirst({
      where: { archiveCode: targetArchiveCode },
    });

    if (!targetProject)
      return res
        .status(404)
        .json({ success: false, message: "المشروع المستهدف غير موجود." });
    if (currentProjectId === targetProject.id)
      return res
        .status(400)
        .json({ success: false, message: "لا يمكن دمج المشروع مع نفسه." });

    // 🛡️ استخدام Transaction لضمان سلامة البيانات أثناء النقل والحذف
    await prisma.$transaction(async (tx) => {
      // نقل الملفات
      if (currentProject.files && currentProject.files.length > 0) {
        await tx.archivedProjectFile.updateMany({
          where: { archivedProjectId: currentProjectId },
          data: { archivedProjectId: targetProject.id },
        });
      }

      // حذف المشروع القديم
      await tx.archivedProject.delete({ where: { id: currentProjectId } });

      // تحديث حالة المشروع الهدف
      await tx.archivedProject.update({
        where: { id: targetProject.id },
        data: {
          aiStatus: "pending",
          archiveNotes: "تم دمج ملفات جديدة. في انتظار إعادة التحليل الشامل...",
        },
      });
    });

    // تسجيل مهمة الذكاء الاصطناعي خارج الـ Transaction
    const aiJob = await prisma.aiJob.create({
      data: {
        jobType: "MERGE_AND_ANALYZE",
        targetId: targetProject.id,
        targetType: "ARCHIVED_PROJECT",
        requestedBy: employeeId,
        status: "PENDING",
      },
    });

    await aiQueue.add(
      "merge_analyze",
      {
        projectId: targetProject.id,
        employeeId,
        compressionLevel,
        dbJobId: aiJob.id,
        jobType: "MERGE_AND_ANALYZE",
      },
      { attempts: 3 },
    );

    return res.status(200).json({
      success: true,
      message:
        "تم نقل الملفات، دمج السجلات، وإرسال المشروع لإعادة التحليل بنجاح.",
      data: { targetProjectId: targetProject.id },
    });
  } catch (error) {
    console.error("🔥 Error merging projects:", error);
    return res
      .status(500)
      .json({ success: false, message: "فشلت عملية الدمج والتحديث." });
  }
};

// 4. رفع ملفات إضافية (مع الحماية)
exports.uploadArchiveFile = async (req, res) => {
  const uploadedFiles = req.files || (req.file ? [req.file] : []);

  try {
    const { projectId } = req.params;
    const employeeId = req.user?.id;
    const compressionLevel = req.body?.compressionLevel || "medium";
    const shouldReanalyze = req.body?.reanalyze === "true";

    if (uploadedFiles.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم استلام أي ملفات." });
    }

    const projectExists = await prisma.archivedProject.findUnique({
      where: { id: projectId },
    });
    if (!projectExists) {
      throw new Error("PROJECT_NOT_FOUND");
    }

    const savedFiles = [];

    // استخدام Transaction لضمان إدخال جميع الملفات بشكل آمن
    await prisma.$transaction(async (tx) => {
      for (const file of uploadedFiles) {
        const newFile = await tx.archivedProjectFile.create({
          data: {
            archivedProjectId: projectId,
            fileName: file.filename,
            originalName: file.originalname,
            fileUrl: `/uploads/archived_projects/${file.filename}`,
            fileType: file.mimetype,
            fileSize: file.size,
          },
        });
        savedFiles.push({ ...newFile, path: file.path }); // نحتفظ بالمسار الفيزيائي للاستخدام في الطابور
      }
    });

    // إضافة الملفات لطابور الضغط
    savedFiles.forEach((file) => {
      optimizationQueue.add("optimize_file", {
        fileId: file.id,
        filePath: file.path,
        mimeType: file.fileType,
        compressionLevel,
      });
    });

    // التعامل مع طلب إعادة التحليل
    if (shouldReanalyze) {
      await prisma.archivedProject.update({
        where: { id: projectId },
        data: { aiStatus: "pending" },
      });

      const aiJob = await prisma.aiJob.create({
        data: {
          jobType: "UPLOAD_AND_ANALYZE",
          targetId: projectId,
          targetType: "ARCHIVED_PROJECT",
          requestedBy: employeeId,
          status: "PENDING",
        },
      });

      await aiQueue.add(
        "upload_analyze",
        {
          projectId,
          employeeId,
          compressionLevel,
          dbJobId: aiJob.id,
          jobType: "UPLOAD_AND_ANALYZE",
        },
        { delay: 5000, attempts: 3 },
      );
    }

    // تنظيف البيانات المرسلة للواجهة من المسارات الحساسة
    const safeData = savedFiles.map(({ path, ...safeFile }) => safeFile);

    return res.status(201).json({
      success: true,
      message: "تم رفع الملفات وجدولتها للضغط بنجاح.",
      data: safeData,
    });
  } catch (error) {
    console.error("🔥 Error uploading extra files:", error);

    if (uploadedFiles.length > 0) {
      await cleanupPhysicalFiles(uploadedFiles.map((f) => f.path));
    }

    if (error.message === "PROJECT_NOT_FOUND") {
      return res
        .status(404)
        .json({ success: false, message: "المشروع غير موجود." });
    }
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ غير متوقع أثناء الرفع." });
  }
};

// 5. الوظائف الإدارية

exports.createManualArchive = async (req, res) => {
  try {
    const employeeId = req.user?.id;
    const archiveCode = await generateArchiveCode();

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
      message: "تم إنشاء السجل اليدوي بنجاح.",
      data: { projectId: archivedProject.id },
    });
  } catch (error) {
    console.error("🔥 Error creating manual archive:", error);
    return res
      .status(500)
      .json({
        success: false,
        message: "فشل إنشاء السجل اليدوي، حاول مجدداً.",
      });
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
        designerOffice: { select: { nameAr: true } },
        supervisorOffice: { select: { nameAr: true } },
        archivedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        files: true,
      },
    });

    if (!project)
      return res
        .status(404)
        .json({ success: false, message: "المشروع غير موجود." });
    return res.status(200).json({ success: true, data: project });
  } catch (error) {
    console.error("🔥 Error fetching details:", error);
    return res
      .status(500)
      .json({ success: false, message: "تعذر جلب بيانات المشروع." });
  }
};

exports.updateArchivedProject = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const employeeId = req.user?.id;

    // حماية البيانات: منع التحديث المباشر للمتغيرات المحمية
    const protectedFields = [
      "id",
      "createdAt",
      "updatedAt",
      "archivedById",
      "approvedById",
      "client",
      "district",
      "designerOffice",
      "supervisorOffice",
      "archivedBy",
      "approvedBy",
      "files",
      "plan"
    ];
    protectedFields.forEach((field) => delete updateData[field]);

    // معالجة العلاقات الخارجية بأمان
    const relations = [
      { field: "clientId", relation: "client" },
      { field: "districtId", relation: "district" },
      { field: "designerOfficeId", relation: "designerOffice" },
      { field: "supervisorOfficeId", relation: "supervisorOffice" },
      { field: "planId", relation: "plan" },
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
        "تم حفظ واعتماد بيانات المشروع النهائي.",
        "success",
      );
    }

    return res
      .status(200)
      .json({ success: true, message: "تم الحفظ بنجاح", data: updatedProject });
  } catch (error) {
    console.error("🔥 Error updating project:", error);
    return res
      .status(500)
      .json({ success: false, message: "فشلت عملية حفظ التعديلات." });
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
    console.error("🔥 Error fetching all projects:", error);
    return res
      .status(500)
      .json({ success: false, message: "تعذر تحميل قائمة المشاريع." });
  }
};

exports.deleteArchivedProject = async (req, res) => {
  try {
    const { id } = req.params;

    // جلب مسارات الملفات قبل حذف السجل من قاعدة البيانات
    const projectFiles = await prisma.archivedProjectFile.findMany({
      where: { archivedProjectId: id },
      select: { fileUrl: true },
    });

    // حذف السجل بأمان
    await prisma.archivedProject.delete({ where: { id } });

    // تنظيف الملفات الفيزيائية بشكل غير متزامن
    if (projectFiles.length > 0) {
      const fileUrls = projectFiles.map((f) => f.fileUrl);
      cleanupPhysicalFiles(fileUrls); // تعمل في الخلفية بدون await لتسريع الاستجابة
    }

    return res
      .status(200)
      .json({ success: true, message: "تم الحذف النهائي للمشروع وملحقاته." });
  } catch (error) {
    console.error("🔥 Error deleting project:", error);
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, message: "المشروع غير موجود بالفعل." });
    }
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء محاولة الحذف." });
  }
};

exports.renameArchiveFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { originalName } = req.body;

    if (!originalName || originalName.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "اسم الملف غير صالح." });
    }

    const updatedFile = await prisma.archivedProjectFile.update({
      where: { id: fileId },
      data: { originalName: originalName.trim() },
    });

    return res
      .status(200)
      .json({
        success: true,
        message: "تم إعادة التسمية بنجاح.",
        data: updatedFile,
      });
  } catch (error) {
    console.error("🔥 Error renaming file:", error);
    return res
      .status(500)
      .json({ success: false, message: "فشلت عملية إعادة التسمية." });
  }
};

exports.deleteArchiveFile = async (req, res) => {
  try {
    const { fileId } = req.params;

    const fileRecord = await prisma.archivedProjectFile.findUnique({
      where: { id: fileId },
    });

    if (!fileRecord)
      return res
        .status(404)
        .json({ success: false, message: "الملف غير موجود." });

    await prisma.archivedProjectFile.delete({ where: { id: fileId } });

    // مسح الملف الفيزيائي بالخلفية
    cleanupPhysicalFiles(fileRecord.fileUrl);

    return res
      .status(200)
      .json({ success: true, message: "تم مسح الملف بنجاح." });
  } catch (error) {
    console.error("🔥 Error deleting specific file:", error);
    return res.status(500).json({ success: false, message: "فشل حذف الملف." });
  }
};

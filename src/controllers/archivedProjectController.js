const { PrismaClient } = require("@prisma/client");
const fs = require("fs").promises;
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
 */
const cleanupPhysicalFiles = async (filesPath) => {
  const paths = Array.isArray(filesPath) ? filesPath : [filesPath];
  for (const filePath of paths) {
    if (!filePath) continue;
    try {
      const absolutePath =
        filePath.startsWith("/") || filePath.includes(":\\")
          ? filePath
          : path.join(__dirname, "../../", filePath);

      await fs.unlink(absolutePath);
      console.log(`[File System] 🗑️ تم حذف الملف: ${absolutePath}`);
    } catch (error) {
      if (error.code !== "ENOENT") {
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

    // حفظ المشروع وملفاته
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

    // إرسال المهمة للذكاء الاصطناعي
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

// 3. دمج المشاريع
exports.mergeProjects = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetArchiveCode } = req.body;
    const employeeId = req.user?.id;
    const compressionLevel = req.body?.compressionLevel || "medium";

    if (!targetArchiveCode)
      return res
        .status(400)
        .json({
          success: false,
          message: "يرجى تحديد كود المشروع المستهدف للدمج.",
        });

    const currentProject = await prisma.archivedProject.findUnique({
      where: { id },
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

    if (id === targetProject.id)
      return res
        .status(400)
        .json({ success: false, message: "لا يمكن دمج المشروع مع نفسه." });

    await prisma.$transaction(async (tx) => {
      if (currentProject.files && currentProject.files.length > 0) {
        await tx.archivedProjectFile.updateMany({
          where: { archivedProjectId: id },
          data: { archivedProjectId: targetProject.id },
        });
      }
      await tx.archivedProject.delete({ where: { id } });
      await tx.archivedProject.update({
        where: { id: targetProject.id },
        data: {
          aiStatus: "pending",
          archiveNotes: "تم دمج ملفات جديدة. في انتظار إعادة التحليل الشامل...",
        },
      });
    });

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

    return res
      .status(200)
      .json({
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

// 4. رفع ملفات إضافية
exports.uploadArchiveFile = async (req, res) => {
  const uploadedFiles = req.files || (req.file ? [req.file] : []);

  try {
    const { projectId } = req.params;
    const employeeId = req.user?.id;
    const compressionLevel = req.body?.compressionLevel || "medium";
    const shouldReanalyze = req.body?.reanalyze === "true";

    if (uploadedFiles.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "لم يتم استلام أي ملفات." });

    const projectExists = await prisma.archivedProject.findUnique({
      where: { id: projectId },
    });
    if (!projectExists) throw new Error("PROJECT_NOT_FOUND");

    const savedFiles = [];

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
        savedFiles.push({ ...newFile, path: file.path });
      }
    });

    savedFiles.forEach((file) => {
      optimizationQueue.add("optimize_file", {
        fileId: file.id,
        filePath: file.path,
        mimeType: file.fileType,
        compressionLevel,
      });
    });

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

    const safeData = savedFiles.map(({ path, ...safeFile }) => safeFile);
    return res
      .status(201)
      .json({
        success: true,
        message: "تم رفع الملفات وجدولتها للضغط بنجاح.",
        data: safeData,
      });
  } catch (error) {
    console.error("🔥 Error uploading extra files:", error);
    if (uploadedFiles.length > 0)
      await cleanupPhysicalFiles(uploadedFiles.map((f) => f.path));
    if (error.message === "PROJECT_NOT_FOUND")
      return res
        .status(404)
        .json({ success: false, message: "المشروع غير موجود." });
    return res
      .status(500)
      .json({ success: false, message: "حدث خطأ غير متوقع أثناء الرفع." });
  }
};

// 5. الوظائف الإدارية والتحديث الشامل

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

    return res
      .status(201)
      .json({
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
        // 🚀 التعديل هنا: جلب بيانات القطعة عبر العلاقة (plot) بدلاً من الجدول الوسيط مباشرة
        projectPlots: {
          select: { 
            plot: {
              select: {
                plotNumber: true,
                plotCode: true // جلبنا كود القطعة أيضاً ليفيدك في الواجهة لاحقاً
              }
            }
          }
        },
        plan: { select: { planNumber: true } },
      },
    });

    if (!project) return res.status(404).json({ success: false, message: "المشروع غير موجود." });
    
    return res.status(200).json({ success: true, data: project });
  } catch (error) {
    console.error("🔥 Error fetching details:", error);
    return res.status(500).json({ success: false, message: "تعذر جلب بيانات المشروع." });
  }
};

// ============================================================================
// 🚀 تحديث المشروع (مضاد للأخطاء - Bulletproof)
// ============================================================================
exports.updateArchivedProject = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const employeeId = req.user?.id;

    // 1. حماية البيانات: منع التحديث المباشر للمتغيرات المحمية
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
      "plan",
    ];
    protectedFields.forEach((field) => delete updateData[field]);

    // 2. 🛡️ التصفية الذكية للتواريخ (لتجنب خطأ ISO-8601)
    const dateFields = ["licenseIssueDate", "licenseExpiryDate", "deedDate"];
    dateFields.forEach((field) => {
      if (updateData[field]) {
        const parsedDate = new Date(updateData[field]);
        if (!isNaN(parsedDate.getTime())) {
          updateData[field] = parsedDate; // تحويله لكائن Date آمن للـ Prisma
        } else {
          updateData[field] = null; // إذا كان التاريخ فاسداً نرسله null
        }
      } else if (updateData[field] === "" || updateData[field] === "null") {
        updateData[field] = null;
      }
    });

    // 3. معالجة العلاقات الخارجية بأمان
    const relations = [
      { field: "clientId", relation: "client" },
      { field: "districtId", relation: "district" },
      { field: "designerOfficeId", relation: "designerOffice" },
      { field: "supervisorOfficeId", relation: "supervisorOffice" },
      { field: "planId", relation: "plan" },
    ];

    let currentPlanId = null;

    relations.forEach(({ field, relation }) => {
      if (updateData[field] !== undefined) {
        const idValue = updateData[field];
        if (idValue && idValue.trim() !== "") {
          updateData[relation] = { connect: { id: idValue } };
          if (field === "planId") currentPlanId = idValue; // نحتفظ برقم المخطط لاستخدامه في القطع
        } else {
          updateData[relation] = { disconnect: true };
        }
        delete updateData[field]; // نحذف الـ Id القديم لكي لا يتعارض مع علاقة connect
      }
    });

    // محاولة جلب planId إذا كان مرسلاً ضمن كائن الـ connect ولم نلتقطه
    if (!currentPlanId && updateData.plan?.connect?.id) {
      currentPlanId = updateData.plan.connect.id;
    }

    // 4. 🛡️ تنظيف وإصلاح القطع (ProjectPlots)
    // 4. 🛡️ تنظيف وإصلاح القطع وبناء الكيانات الحقيقية (Plots Entities)
    if (updateData.projectPlots) {
      delete updateData.projectPlots; // تدمير الكائن الفاسد القادم من الواجهة
    }

    if (updateData.plots && Array.isArray(updateData.plots)) {
      if (currentPlanId) {
        // فلترة الكلمات الوهمية
        const validPlots = updateData.plots.filter((p) =>
          p && !p.includes("بدون") && !p.includes("غير محدد") && !p.includes("لا يوجد")
        );

        if (validPlots.length > 0) {
          const plotIdsToConnect = [];

          // 🚀 السحر هنا: البحث أو الإنشاء لكل قطعة بشكل ذكي (Find or Create)
          for (const plotNum of validPlots) {
            const cleanPlotNum = String(plotNum).trim();
            
            // نبحث هل القطعة موجودة مسبقاً في هذا المخطط؟
            let plotRecord = await prisma.riyadhPlanPlot.findUnique({
              where: {
                plotNumber_planId: { plotNumber: cleanPlotNum, planId: currentPlanId }
              }
            });

            // إذا لم تكن موجودة، ننشئها ونولد لها "Code" مميز للبحث
            if (!plotRecord) {
              const autoCode = `PLT-${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 100)}`;
              plotRecord = await prisma.riyadhPlanPlot.create({
                data: {
                  plotNumber: cleanPlotNum,
                  plotCode: autoCode, // 👈 هنا الكود المميز الخاص بالقطعة (للبحث)
                  planId: currentPlanId
                }
              });
            }

            // نضيف ID القطعة الحقيقي للربط
            plotIdsToConnect.push({ plotId: plotRecord.id });
          }

          // بناء هيكل الربط النهائي للمشروع
          updateData.projectPlots = {
            deleteMany: {}, // مسح الروابط القديمة للمشروع
            create: plotIdsToConnect, // إنشاء الروابط للقطع الحقيقية
          };
        } else {
          updateData.projectPlots = { deleteMany: {} };
        }
      } else {
        updateData.projectPlots = { deleteMany: {} };
      }
    }

    // 5. 🚀 تنفيذ التحديث بأمان تام
    const updatedProject = await prisma.archivedProject.update({
      where: { id },
      data: updateData,
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
      .json({
        success: false,
        message: "فشلت عملية حفظ التعديلات.",
        error: error.message,
      });
  }
};

exports.getAllArchivedProjects = async (req, res) => {
  try {
    const projects = await prisma.archivedProject.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true } },
        district: { select: { name: true } },
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

    const projectFiles = await prisma.archivedProjectFile.findMany({
      where: { archivedProjectId: id },
      select: { fileUrl: true },
    });

    await prisma.archivedProject.delete({ where: { id } });

    if (projectFiles.length > 0) {
      const fileUrls = projectFiles.map((f) => f.fileUrl);
      cleanupPhysicalFiles(fileUrls);
    }

    return res
      .status(200)
      .json({ success: true, message: "تم الحذف النهائي للمشروع وملحقاته." });
  } catch (error) {
    console.error("🔥 Error deleting project:", error);
    if (error.code === "P2025")
      return res
        .status(404)
        .json({ success: false, message: "المشروع غير موجود بالفعل." });
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
    cleanupPhysicalFiles(fileRecord.fileUrl);

    return res
      .status(200)
      .json({ success: true, message: "تم مسح الملف بنجاح." });
  } catch (error) {
    console.error("🔥 Error deleting specific file:", error);
    return res.status(500).json({ success: false, message: "فشل حذف الملف." });
  }
};

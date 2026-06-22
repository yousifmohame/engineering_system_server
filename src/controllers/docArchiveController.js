const prisma = require("../utils/prisma");
const { aiQueue } = require("../queue/aiQueue");
const fs = require("fs");
const path = require("path");

// ==========================================
// 🧠 1. دالة الرفع الفعلي وإرسالها للطابور
// ==========================================
exports.uploadAndAnalyzeDoc = async (req, res) => {
  try {
    const {
      imageBase64,
      originalFileName,
      fileType,
      fileSize,
      uploadNotes,
      userId,
    } = req.body;

    if (!imageBase64) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرسال أي ملف للتحليل" });
    }

    // 1. 📂 استخراج وتحويل الـ Base64 إلى ملف حقيقي
    const mimeMatch = imageBase64.match(/^data:(.*?);base64,/);
    const mime = mimeMatch ? mimeMatch[1] : fileType || "application/pdf";
    const ext =
      mime === "application/pdf" ? "pdf" : mime.split("/")[1] || "png";

    const base64Data = imageBase64.replace(/^data:([A-Za-z-+\/]+);base64,/, "");

    // تجهيز مسار الحفظ في السيرفر
    const uploadDir = path.join(__dirname, "../../uploads/archives");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const fileName = `ARC_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, base64Data, "base64");

    const savedFileUrl = `/uploads/archives/${fileName}`;

    // 2. 💾 إنشاء السجل في الداتابيز مع الرابط الحقيقي
    const archiveDoc = await prisma.propertyDocumentArchive.create({
      data: {
        originalFileName: originalFileName || "وثيقة غير مسماة",
        fileUrl: savedFileUrl,
        fileType: mime,
        fileSize: parseFloat(fileSize) || 0,
        status: "UPLOADED",
        ...(userId && { uploadedBy: { connect: { id: userId } } }),
      },
    });

    // 3. 🤖 إنشاء سجل تتبع المهمة
    const newJobRecord = await prisma.aiJob.create({
      data: {
        jobType: "ANALYZE_DEED_ARCHIVE",
        status: "PENDING",
        progress: 0,
        targetId: archiveDoc.id,
        requestedBy: userId,
      },
    });

    // 4. 🚆 إضافة المهمة للطابور
    const job = await aiQueue.add(
      "analyze_deed_archive", // هذا مجرد اسم تعريفي للمهمة في الطابور
      {
        // 🚀 يجب تمرير jobType هنا لكي يتمكن الـ Worker من قراءتها في دالة switch
        jobType: "ANALYZE_DEED_ARCHIVE",
        dbJobId: newJobRecord.id,
        archiveDocId: archiveDoc.id,
        employeeId: userId,
      },
      { removeOnComplete: true, removeOnFail: false },
    );

    res.status(202).json({
      success: true,
      message: "تم حفظ الملف بنجاح وإرساله لمحرك التحليل.",
      data: {
        jobId: job.id,
        dbJobId: newJobRecord.id,
        archiveDocId: archiveDoc.id,
      },
    });
  } catch (error) {
    console.error("Upload & Queue Job Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل استلام وحفظ الملف",
      details: error.message,
    });
  }
};

// ==========================================
// 💾 2. حفظ الوثيقة يدوياً بعد مراجعة الموظف
// ==========================================
exports.saveArchivedDoc = async (req, res) => {
  try {
    const {
      fileUrl,
      originalFileName,
      fileType,
      fileSize,
      aiData,
      saveAction,
      selectedPropertyId,
      uploadedById,
    } = req.body;

    const userId = req.user?.id || req.user?.userId || uploadedById || null;

    const isDuplicateSuspect = await prisma.propertyDocumentArchive.findFirst({
      where: {
        OR: [
          { documentNumber: aiData.basic?.documentNumber || "N/A" },
          { propertyNumber: aiData.basic?.propertyNumber || "N/A" },
        ],
        documentNumber: { not: null, not: "" },
      },
    });

    let newDocStatus = aiData.aiConfidence < 80 ? "NEEDS_REVIEW" : "CONFIRMED";

    const propertiesToCreate = (aiData.properties || []).map((p) => ({
      city: p.city,
      district: p.district,
      planNumber: String(p.planNumber || ""),
      plotNumber: String(p.plotNumber || ""),
      area: parseFloat(p.area) || 0,
      usageType: p.usageType,
      propertyType: p.propertyType,
      boundariesData: p.boundaries ? JSON.stringify(p.boundaries) : null,
    }));

    const ownersToCreate = (aiData.owners || []).map((o) => ({
      ownerName: o.name || "غير محدد",
      identityNumber: o.identityNumber,
      ownershipPercentage: parseFloat(o.percentage) || 100,
      isMainOwner: o.isMain || false,
    }));

    const savedDoc = await prisma.$transaction(async (tx) => {
      const archiveDoc = await tx.propertyDocumentArchive.create({
        data: {
          originalFileName,
          fileUrl,
          fileType,
          fileSize: parseFloat(fileSize) || 0,
          ...(userId && { uploadedBy: { connect: { id: userId } } }),
          status: newDocStatus,

          docType: aiData.basic?.docType,
          docSource: aiData.basic?.docSource,
          documentNumber: aiData.basic?.documentNumber,
          propertyNumber: aiData.basic?.propertyNumber,
          issueDate: aiData.basic?.issueDate
            ? new Date(aiData.basic.issueDate)
            : null,
          versionNumber: aiData.basic?.versionNumber,
          operationType: aiData.basic?.operationType,

          hasRestrictions: aiData.restrictions?.hasRestrictions || "NONE",
          restrictedTo: aiData.restrictions?.restrictedTo,
          restrictionValue: parseFloat(aiData.restrictions?.value) || 0,
          restrictionText: aiData.restrictions?.text,

          aiConfidenceScore: parseFloat(aiData.aiConfidence) || 0,
          isDuplicateSuspect: !!isDuplicateSuspect,

          properties: { create: propertiesToCreate },
          owners: { create: ownersToCreate },

          ...(saveAction === "LINK_EXISTING" &&
            selectedPropertyId && {
              ownership: { connect: { id: selectedPropertyId } },
            }),
        },
      });

      if (userId) {
        await tx.archiveAuditLog.create({
          data: {
            document: { connect: { id: archiveDoc.id } },
            user: { connect: { id: userId } },
            action: "MANUAL_SAVE",
            details: `تم اعتماد وثيقة (${aiData.basic?.docType || "غير مصنف"}) وحفظها يدوياً بحالة ${newDocStatus}.`,
          },
        });
      }

      return archiveDoc;
    });

    res.status(201).json({
      success: true,
      message: "تم أرشفة الوثيقة بنجاح",
      data: savedDoc,
    });
  } catch (error) {
    console.error("Save Archive Doc Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل حفظ الوثيقة",
      error: error.message,
    });
  }
};

// ==========================================
// 🚀 دالة التحديث والاعتماد النهائي (بعد مراجعة الموظف)
// ==========================================
exports.updateArchivedDoc = async (req, res) => {
  try {
    const { id } = req.params; // ID الوثيقة الفيزيائية المبدئية
    const {
      aiDataArray, // 👈 تم التعديل لتستقبل مصفوفة
      saveAction,
      selectedPropertyId,
      uploadNotes,
      isFinalApproval,
      userId,
    } = req.body;

    const currentUserId = req.user?.id || req.user?.userId || userId || null;
    const newDocStatus = isFinalApproval ? "CONFIRMED" : "NEEDS_REVIEW";

    // 1. التأكد أن الملف الأصلي موجود
    const originalDoc = await prisma.propertyDocumentArchive.findUnique({
      where: { id },
    });

    if (!originalDoc) {
      return res
        .status(404)
        .json({ success: false, message: "السجل الأصلي غير موجود." });
    }

    if (!Array.isArray(aiDataArray) || aiDataArray.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرسال بيانات للاعتماد." });
    }

    // 2. استخدام Transaction لحفظ جميع الصكوك
    const savedDocs = await prisma.$transaction(async (tx) => {
      // داخل docArchiveController.js -> updateArchivedDoc
      // استبدل حلقة الـ for loop بهذا الكود الآمن:

      let createdDocs = [];

      for (let i = 0; i < aiDataArray.length; i++) {
        const deedData = aiDataArray[i];

        // 🛡️ حماية ضد العناصر الفارغة
        if (!deedData || typeof deedData !== "object") continue;

        // 🛡️ استخدام ?. للحماية من الـ null
        const propertiesToCreate = (deedData?.properties || []).map((p) => ({
          city: String(p?.city || ""),
          district: String(p?.district || ""),
          planNumber: String(p?.planNumber || ""),
          plotNumber: String(p?.plotNumber || ""),
          area: parseFloat(p?.area) || 0,
          areaText: String(p?.areaText || ""),
          usageType: String(p?.usageType || ""),
          propertyType: String(p?.propertyType || ""),
          boundariesData: p?.boundaries ? JSON.stringify(p.boundaries) : null,
        }));

        const ownersToCreate = (deedData?.owners || []).map((o) => ({
          ownerName: String(o?.name || "غير محدد"),
          identityNumber: String(o?.identityNumber || ""),
          ownershipPercentage: parseFloat(o?.percentage) || 100,
          nationality: String(o?.nationality || "سعودي"),
          isMainOwner: Boolean(o?.isMain),
        }));

        const docData = {
          status: newDocStatus,
          docType: deedData?.basic?.docType,
          docSource: deedData?.basic?.docSource,
          documentNumber: deedData?.basic?.documentNumber,
          propertyNumber: deedData?.basic?.propertyNumber,
          issueDate: deedData?.basic?.issueDate
            ? new Date(deedData.basic.issueDate)
            : null,
          versionNumber: deedData?.basic?.versionNumber,
          operationType: deedData?.basic?.operationType,
          previousDocNumber: deedData?.basic?.previousDocNumber,

          hasRestrictions: deedData?.restrictions?.hasRestrictions || "NONE",
          restrictedTo: deedData?.restrictions?.restrictedTo,
          restrictionValue: parseFloat(deedData?.restrictions?.value) || 0,
          restrictionText: deedData?.restrictions?.text,

          aiConfidenceScore: parseFloat(deedData?.aiConfidenceScore) || 100,
          aiNotes: deedData?.aiNotes || uploadNotes,

          properties: { create: propertiesToCreate },
          owners: { create: ownersToCreate },

          ...(saveAction === "LINK_EXISTING" &&
            selectedPropertyId && {
              ownership: { connect: { id: selectedPropertyId } },
            }),
        };

        if (i === 0) {
          // الصك الأول: نحدث السجل الأصلي
          await tx.archivePropertyDetail.deleteMany({
            where: { documentId: id },
          });
          await tx.archiveOwnerDetail.deleteMany({ where: { documentId: id } });

          const updated = await tx.propertyDocumentArchive.update({
            where: { id },
            data: docData,
          });
          createdDocs.push(updated);
        } else {
          // الصكوك الإضافية (إذا كان الملف يحتوي عدة صكوك): ننشئ سجلات جديدة بنفس رابط الملف
          const newDoc = await tx.propertyDocumentArchive.create({
            data: {
              ...docData,
              originalFileName: `${originalDoc.originalFileName} (صك ${i + 1})`,
              fileUrl: originalDoc.fileUrl,
              fileType: originalDoc.fileType,
              fileSize: originalDoc.fileSize,
              ...(currentUserId && {
                uploadedBy: { connect: { id: currentUserId } },
              }),
            },
          });
          createdDocs.push(newDoc);
        }
      }

      // 3. سجل التدقيق
      if (currentUserId) {
        await tx.archiveAuditLog.create({
          data: {
            documentId: id,
            userId: currentUserId,
            action: "MANUAL_APPROVAL",
            details: `تم اعتماد ${aiDataArray.length} صك/وثيقة من الملف المرفوع.`,
          },
        });
      }

      return createdDocs;
    });

    res.status(200).json({
      success: true,
      message: `تم اعتماد وحفظ ${savedDocs.length} وثيقة بنجاح.`,
      data: savedDocs,
    });
  } catch (error) {
    console.error("Update Archive Doc Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "فشل اعتماد الوثيقة",
        error: error.message,
      });
  }
};

// ==========================================
// 📊 3. جلب قائمة الأرشيف (الجدول الرئيسي)
// ==========================================
exports.getAllArchiveDocs = async (req, res) => {
  try {
    const { search, limit = 20, page = 1, status, docType, source } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (docType) where.docType = docType;
    if (source) where.docSource = source;

    if (search) {
      where.OR = [
        { documentNumber: { contains: search } },
        { propertyNumber: { contains: search } },
        { owners: { some: { ownerName: { contains: search } } } },
        { properties: { some: { plotNumber: { contains: search } } } },
        { properties: { some: { district: { contains: search } } } },
      ];
    }

    const [docs, total] = await Promise.all([
      prisma.propertyDocumentArchive.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { uploadDate: "desc" },
        include: {
          owners: { where: { isMainOwner: true }, take: 1 },
          properties: { take: 1 },
          ownership: { select: { code: true } },
        },
      }),
      prisma.propertyDocumentArchive.count({ where }),
    ]);

    const stats = await prisma.$transaction([
      prisma.propertyDocumentArchive.count(),
      prisma.propertyDocumentArchive.count({ where: { status: "CONFIRMED" } }),
      prisma.propertyDocumentArchive.count({
        where: { status: "NEEDS_REVIEW" },
      }),
      prisma.propertyDocumentArchive.count({
        where: { ownershipId: { not: null } },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: docs,
      stats: {
        total: stats[0],
        confirmed: stats[1],
        needsReview: stats[2],
        linked: stats[3],
      },
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("GetAllArchiveDocs Error:", error);
    res.status(500).json({ success: false, message: "فشل جلب الأرشيف" });
  }
};

// ==========================================
// 🔍 4. جلب تفاصيل وثيقة واحدة بكامل تفاصيلها
// ==========================================
exports.getArchiveDocById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await prisma.propertyDocumentArchive.findUnique({
      where: { id },
      include: {
        properties: true,
        owners: true,
        ownership: {
          select: { id: true, code: true, city: true, district: true },
        },
        client: { select: { id: true, name: true, clientCode: true } },
        auditLogs: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: { name: true } } },
        },
      },
    });

    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "الوثيقة غير موجودة" });
    }

    res.status(200).json({ success: true, data: doc });
  } catch (error) {
    console.error("Get Archive Doc Error:", error);
    res.status(500).json({ success: false, message: "فشل جلب الوثيقة" });
  }
};

// ==========================================
// 🗑️ 5. حذف أو أرشفة الوثيقة (Soft Delete)
// ==========================================
exports.deleteArchiveDoc = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.propertyDocumentArchive.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });
    res
      .status(200)
      .json({ success: true, message: "تم نقل الوثيقة للأرشيف الملغى بنجاح" });
  } catch (error) {
    console.error("Delete Archive Doc Error:", error);
    res.status(500).json({ success: false, message: "فشل حذف الوثيقة" });
  }
};

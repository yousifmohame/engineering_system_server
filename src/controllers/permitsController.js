const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const { aiQueue } = require('../queue/aiQueue');

// ==========================================
// 💡 تحليل رخص البناء بالذكاء الاصطناعي (Enterprise Version)
// ==========================================
const analyzePermitAI = async (req, res) => {
  try {
    let tempFilePath = null;
    let mimeType = null;

    // 1. التعامل مع استلام الملف سواء كان Multipart أو Base64
    if (req.file) {
      tempFilePath = req.file.path;
      mimeType = req.file.mimetype;
    } else if (req.body.imageBase64) {
      const { imageBase64 } = req.body;
      mimeType = imageBase64.substring(imageBase64.indexOf(":") + 1, imageBase64.indexOf(";"));
      const base64Data = imageBase64.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");
      
      // حفظ ملف مؤقت للـ Base64 لكي يستطيع الـ Worker قراءته
      const tempFileName = `temp_permit_${Date.now()}.jpg`;
      tempFilePath = path.join(__dirname, '../../uploads/temp', tempFileName); // تأكد من وجود مجلد temp
      fs.writeFileSync(tempFilePath, buffer);
    } else {
      return res.status(400).json({ success: false, message: "لم يتم إرسال أي وثيقة" });
    }

    // 2. إنشاء مهمة في جدول AiJob
    const aiJob = await prisma.aiJob.create({
      data: {
        jobType: 'ANALYZE_PERMIT',
        status: 'PENDING',
        targetType: 'PERMIT',
        requestedBy: req.user?.id || null // إذا كان لديك نظام مصادقة
      }
    });

    const fixedOffice = req.body.fixedOffice || null;
    // 3. إضافة المهمة إلى طابور BullMQ لتعمل في الخلفية
    await aiQueue.add('analyze_permit_job', {
      dbJobId: aiJob.id,
      jobType: 'ANALYZE_PERMIT',
      filePath: tempFilePath,
      mimeType: mimeType,
      employeeId: req.user?.id,
      fixedOffice: fixedOffice
    });

    // 4. الرد فوراً للواجهة الأمامية بأن المهمة قيد المعالجة
    res.status(202).json({
      success: true,
      message: "تم استلام الملف وجاري التحليل بذكاء في الخلفية.",
      jobId: aiJob.id // 👈 سنستخدم هذا في الفرونت إند لمتابعة شريط التحميل
    });

  } catch (error) {
    console.error("🔥 Error queuing permit analysis:", error);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء بدء التحليل", details: error.message });
  }
};

// جلب جميع الرخص
const getPermits = async (req, res) => {
  try {
    const permits = await prisma.permit.findMany({
      orderBy: { archiveDate: "desc" },
    });
    res.json({ success: true, data: permits });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// إضافة رخصة جديدة
const createPermit = async (req, res) => {
  try {
    const data = req.body;

    let attachmentUrl = null;
    if (req.file) {
      attachmentUrl = `/uploads/permits/${req.file.filename}`;
    }

    const parsedYear = parseInt(data.year);
    const safeYear = isNaN(parsedYear) ? new Date().getFullYear() : parsedYear;

    const parsedLandArea = parseFloat(data.landArea);
    const safeLandArea = isNaN(parsedLandArea) ? null : parsedLandArea;

    const newPermit = await prisma.permit.create({
      data: {
        permitNumber: data.permitNumber || "بدون رقم",
        year: safeYear,
        type: data.type || "غير محدد",
        form: data.form || "غير محدد",
        ownerName: data.ownerName || "بدون اسم",
        idNumber: data.idNumber || "",

        issueDate: data.issueDate || null,
        expiryDate: data.expiryDate || null,

        district: data.district || "",
        sector: data.sector || "",
        plotNumber: data.plotNumber || "",
        planNumber: data.planNumber || "",
        usage: data.usage || "",
        mainUsage: data.mainUsage || "غير محدد",
        subUsage: data.subUsage || "",
        detailedReport: data.detailedReport || null,
        landArea: safeLandArea,
        engineeringOffice: data.engineeringOffice || "",
        source: data.source || "يدوي",
        notes: data.notes || "",
        aiStatus: data.source === "رفع يدوي (AI)" ? "تم التحليل" : "غير مطبق",
        attachmentUrl: attachmentUrl,

        componentsData: data.componentsData || "[]",
        boundariesData: data.boundariesData || "[]",
      },
    });

    res.status(201).json({ success: true, data: newPermit });
  } catch (error) {
    console.error("Create Permit Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// تعديل بيانات الرخصة
const updatePermit = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updateData = {};

    if (data.permitNumber !== undefined)
      updateData.permitNumber = data.permitNumber;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.form !== undefined) updateData.form = data.form;
    if (data.ownerName !== undefined) updateData.ownerName = data.ownerName;
    if (data.idNumber !== undefined) updateData.idNumber = data.idNumber;

    if (data.issueDate !== undefined) updateData.issueDate = data.issueDate;
    if (data.expiryDate !== undefined) updateData.expiryDate = data.expiryDate;

    if (data.district !== undefined) updateData.district = data.district;
    if (data.sector !== undefined) updateData.sector = data.sector;
    if (data.plotNumber !== undefined) updateData.plotNumber = data.plotNumber;
    if (data.planNumber !== undefined) updateData.planNumber = data.planNumber;
    if (data.usage !== undefined) updateData.usage = data.usage;
    if (data.mainUsage !== undefined) updateData.mainUsage = data.mainUsage;
    if (data.subUsage !== undefined) updateData.subUsage = data.subUsage;
    if (data.detailedReport !== undefined)
      updateData.detailedReport = data.detailedReport;

    if (data.linkedTransactionId !== undefined)
      updateData.linkedTransactionId = data.linkedTransactionId;
    if (data.linkedOwnershipId !== undefined)
      updateData.linkedOwnershipId = data.linkedOwnershipId;
    if (data.linkedClientId !== undefined)
      updateData.linkedClientId = data.linkedClientId;
    if (data.linkedOfficeId !== undefined)
      updateData.linkedOfficeId = data.linkedOfficeId;
    if (data.engineeringOffice !== undefined)
      updateData.engineeringOffice = data.engineeringOffice;
    if (data.source !== undefined) updateData.source = data.source;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.aiStatus !== undefined) updateData.aiStatus = data.aiStatus;
    if (data.extraAttachments !== undefined)
      updateData.extraAttachments = data.extraAttachments;

    if (data.year !== undefined) {
      const parsedYear = parseInt(data.year);
      if (!isNaN(parsedYear)) updateData.year = parsedYear;
    }

    if (data.landArea !== undefined) {
      const parsedArea = parseFloat(data.landArea);
      updateData.landArea = isNaN(parsedArea) ? null : parsedArea;
    }

    if (data.componentsData !== undefined)
      updateData.componentsData = data.componentsData;
    if (data.boundariesData !== undefined)
      updateData.boundariesData = data.boundariesData;

    if (req.file) {
      updateData.attachmentUrl = `/uploads/permits/${req.file.filename}`;
    }

    const updatedPermit = await prisma.permit.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, data: updatedPermit });
  } catch (error) {
    console.error("Update Permit Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 💡 دالة الدمج الذكي (Smart Auto Merge)
// ==========================================
const autoMergePermit = async (req, res) => {
  try {
    const { id } = req.params;
    
    // 1. جلب الرخصة المكررة (المؤقتة)
    const duplicatePermit = await prisma.permit.findUnique({ where: { id } });
    if (!duplicatePermit) {
      return res.status(404).json({ success: false, message: "الرخصة المؤقتة غير موجودة." });
    }

    // 2. البحث عن السجل الأساسي الأقدم
    const originalPermit = await prisma.permit.findFirst({
      where: {
        OR: [
          { permitNumber: duplicatePermit.permitNumber },
          { idNumber: duplicatePermit.idNumber, planNumber: duplicatePermit.planNumber }
        ],
        NOT: { id: duplicatePermit.id }, // استثناء الرخصة المؤقتة نفسها
        aiStatus: { not: "مكرر - بانتظار الدمج" } // يجب أن يكون السجل الأساسي سليماً
      },
      // 👈 التعديل هنا: استخدام archiveDate بدلاً من createdAt
      orderBy: { archiveDate: 'asc' } 
    });

    if (!originalPermit) {
       // إذا لم يجد النظام سجلاً أساسياً لسبب ما، نعتبر هذه الرخصة أساسية
       await prisma.permit.update({ 
         where: { id }, 
         data: { aiStatus: "تم التحليل" } 
       });
       return res.json({ success: true, message: "تمت إزالة حالة التكرار واعتبارها رخصة أساسية." });
    }

    // 3. نقل البيانات الفارغة من المؤقتة إلى الأساسية
    await prisma.permit.update({
      where: { id: originalPermit.id },
      data: {
         ownerName: originalPermit.ownerName || duplicatePermit.ownerName,
         landArea: originalPermit.landArea || duplicatePermit.landArea,
         attachmentUrl: originalPermit.attachmentUrl || duplicatePermit.attachmentUrl,
         componentsData: originalPermit.componentsData?.length > 5 ? originalPermit.componentsData : duplicatePermit.componentsData,
         boundariesData: originalPermit.boundariesData?.length > 5 ? originalPermit.boundariesData : duplicatePermit.boundariesData,
         notes: (originalPermit.notes || "") + (duplicatePermit.notes ? ` | إضافة (AI): ${duplicatePermit.notes}` : ""),
         // تحديث حالة الذكاء الاصطناعي للسجل الأساسي
         aiStatus: "تم الدمج والتحديث",
         aiJobId: duplicatePermit.aiJobId
      }
    });

    // 4. حذف الرخصة المؤقتة لتنظيف قاعدة البيانات
    await prisma.permit.delete({ where: { id: duplicatePermit.id } });

    res.json({ success: true, message: "تم دمج البيانات ونقل المرفقات بنجاح! 🚀" });
    
  } catch (error) {
    console.error("Merge Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 💡 جلب الرخص المكررة (التي تنتظر الدمج)
// ==========================================
const getDuplicates = async (req, res) => {
  try {
    // 1. جلب كل الرخص التي صنفها الذكاء الاصطناعي كمكررة
    const pendingDuplicates = await prisma.permit.findMany({
      where: { aiStatus: "مكرر - بانتظار الدمج" },
      // 👈 التعديل الأول: استخدام archiveDate بدلاً من createdAt
      orderBy: { archiveDate: 'desc' }
    });

    const duplicateGroups = [];

    // 2. البحث عن الأصل لكل رخصة مكررة
    for (const dup of pendingDuplicates) {
      const original = await prisma.permit.findFirst({
        where: {
          OR: [
            { permitNumber: dup.permitNumber },
            { idNumber: dup.idNumber, planNumber: dup.planNumber }
          ],
          NOT: { id: dup.id },
          aiStatus: { not: "مكرر - بانتظار الدمج" }
        },
        // 👈 التعديل الثاني: استخدام archiveDate للبحث عن السجل الأقدم
        orderBy: { archiveDate: 'asc' }
      });

      if (original) {
        duplicateGroups.push({
          duplicateId: dup.id,
          reason: dup.permitNumber === original.permitNumber ? "تطابق في رقم الرخصة" : "تطابق في الهوية والمخطط",
          duplicatePermit: dup,
          originalPermit: original
        });
      }
    }

    res.json({ success: true, data: duplicateGroups });
  } catch (error) {
    console.error("Get Duplicates Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// حذف رخصة
const deletePermit = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.permit.delete({ where: { id } });
    res.json({ success: true, message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getPermits,
  createPermit,
  updatePermit,
  deletePermit,
  analyzePermitAI,
  autoMergePermit,
  getDuplicates
};

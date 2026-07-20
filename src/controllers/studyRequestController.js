const prisma = require("../utils/prisma");
const {
  generateRequestCode,
  evaluateReadiness,
  logTimelineEvent,
  logAudit,
} = require("../utils/studyHelpers");
const { GoogleGenAI } = require("@google/genai");
const { aiQueue } = require('../queue/aiQueue'); // 👈 1. استيراد الطابور لإرسال المهام إليه مجدداً
const path = require("path");
const fs = require("fs");
// ==========================================
// 1. الإنشاء السريع (Zero-Friction Intake - File 01 & 03)
// ==========================================
exports.createStudyRequest = async (req, res) => {
  try {
    const { title, originalRequestText, contactMobile, requestSource } =
      req.body;

    // 💡 حل مشكلة req.user للمرحلة التطويرية:
    let userId = req.user?.id;

    // إذا لم يكن هناك مستخدم مسجل الدخول حالياً، اجلب أول موظف من الداتابيز لتجربة النظام
    if (!userId) {
      const defaultEmployee = await prisma.employee.findFirst();
      if (!defaultEmployee) {
        return res
          .status(400)
          .json({
            success: false,
            message: "لا يوجد أي موظف مسجل في النظام لربط الطلب به!",
          });
      }
      userId = defaultEmployee.id;
    }

    // يكفي معلومة واحدة لإنشاء السجل
    if (!title && !originalRequestText && !contactMobile && !req.files) {
      return res
        .status(400)
        .json({
          success: false,
          message: "يجب إدخال معلومة واحدة على الأقل لإنشاء السجل.",
        });
    }

    const requestCode = await generateRequestCode();

    const newRequest = await prisma.studyRequest.create({
      data: {
        requestCode,
        title,
        originalRequestText,
        contactMobile,
        requestSource,
        createdById: userId,
        operationalStatus: "NEW",
      },
    });

    // تسجيل حدث الإنشاء
    await logTimelineEvent(
      newRequest.id,
      userId,
      "STATUS_CHANGE",
      "تم استقبال الطلب وإنشاء السجل",
      null,
      "green",
    );

    res
      .status(201)
      .json({ success: true, data: newRequest, message: "تم الالتقاط بنجاح!" });
  } catch (error) {
    console.error("Create Study Error:", error);
    res.status(500).json({ success: false, message: "فشل إنشاء سجل الدراسة." });
  }
};

// ==========================================
// 2. جلب البيانات للجدول المكثف (Data Grid - File 02)
// ==========================================
exports.getAllStudyRequests = async (req, res) => {
  try {
    const {
      search,
      status,
      readiness,
      page = 1,
      limit = 25,
      sortBy = "lastActivityAt",
      sortDir = "desc",
    } = req.query;

    const where = { isDeleted: false };

    // فلاتر سريعة
    if (status) where.operationalStatus = status;
    if (readiness) where.readinessLevel = readiness;

    // البحث العميق
    if (search) {
      where.OR = [
        { requestCode: { contains: search } },
        { title: { contains: search } },
        { contactMobile: { contains: search } },
        { client: { name: { path: ["ar"], string_contains: search } } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [records, total] = await Promise.all([
      prisma.studyRequest.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { [sortBy]: sortDir },
        include: {
          client: { select: { name: true, mobile: true } },
          assignedTo: { select: { name: true } },
        },
      }),
      prisma.studyRequest.count({ where }),
    ]);

    res.json({
      success: true,
      data: records,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Grid Fetch Error:", error);
    res.status(500).json({ success: false, message: "فشل جلب بيانات الدليل." });
  }
};

// ==========================================
// 3. جلب تفاصيل السجل الواسعة (Mega Modal - File 03)
// ==========================================
exports.getStudyRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const record = await prisma.studyRequest.findUnique({
      where: { id },
      include: {
        client: true,
        ownership: true,
        assignedTo: true,
        batches: { include: { attachments: true } },
        notes: {
          include: { author: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
        decisions: { orderBy: { createdAt: "desc" } },
        timelineEvents: { orderBy: { createdAt: "desc" } },
        aiAnalysisLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!record || record.isDeleted) {
      return res
        .status(404)
        .json({ success: false, message: "السجل غير موجود أو محذوف." });
    }

    res.json({ success: true, data: record });
  } catch (error) {
    console.error("Fetch Details Error:", error);
    res.status(500).json({ success: false, message: "فشل جلب تفاصيل السجل." });
  }
};

// ==========================================
// 4. التحديث التراكمي (Cumulative Update - File 03 & 10)
// ==========================================
exports.updateStudyRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body; // البيانات المرسلة

    // 💡 التعديل التطويري لـ userId
    let userId = req.user?.id;
    if (!userId) {
      const defaultEmployee = await prisma.employee.findFirst();
      userId = defaultEmployee?.id;
    }

    // جلب القديم للمقارنة
    const oldRecord = await prisma.studyRequest.findUnique({ where: { id } });
    if (oldRecord.isLocked) {
      return res
        .status(403)
        .json({
          success: false,
          message: "السجل مقفل (تم تحويله إلى معاملة).",
        });
    }

    // تقييم الجاهزية الذكي (Smart Indicators)
    const mergedData = { ...oldRecord, ...updateData };
    const { readiness, completeness, missing } = evaluateReadiness(mergedData);

    mergedData.readinessLevel = readiness;
    mergedData.completenessLevel = completeness;
    mergedData.missingDocs = missing;
    mergedData.lastActivityAt = new Date();

    const updatedRecord = await prisma.studyRequest.update({
      where: { id },
      data: mergedData,
    });

    // 🕵️ تسجيل التدقيق (Audit)
    if (userId) {
      await logAudit(
        id,
        userId,
        "UPDATE_RECORD",
        "Multiple Fields",
        oldRecord,
        updatedRecord,
      );
    }

    res.json({
      success: true,
      data: updatedRecord,
      message: "تم حفظ التعديلات وتقييم الجاهزية.",
    });
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ success: false, message: "فشل تحديث السجل." });
  }
};

// ==========================================
// 5. إضافة ملاحظة أو قرار (Notes & Decisions - File 04 & 10)
// ==========================================
exports.addDecision = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, type, details, reason, isInternalOnly } = req.body;

    // 💡 التعديل التطويري لـ userId
    let userId = req.user?.id;
    if (!userId) {
      const defaultEmployee = await prisma.employee.findFirst();
      userId = defaultEmployee?.id;
    }

    const decision = await prisma.studyDecision.create({
      data: {
        studyRequestId: id,
        title,
        type,
        details,
        reason,
        isInternalOnly,
        decidedById: userId,
        status: "APPROVED", // افتراضياً معتمد إلا لو طُبق نظام مسودات
      },
    });

    if (userId) {
      await logTimelineEvent(
        id,
        userId,
        "DECISION",
        `قرار: ${title}`,
        details,
        "purple",
      );
    }
    await prisma.studyRequest.update({
      where: { id },
      data: { lastActivityAt: new Date() },
    });

    res
      .status(201)
      .json({
        success: true,
        data: decision,
        message: "تم توثيق القرار بنجاح.",
      });
  } catch (error) {
    console.error("Decision Error:", error);
    res.status(500).json({ success: false, message: "فشل حفظ القرار." });
  }
};

// ==========================================
// 6. تحويل إلى معاملة رسمية (Conversion Gate - File 07)
// ==========================================
exports.convertToTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { overrideReason } = req.body; // في حال كسر الموانع بصلاحية

    // 💡 التعديل التطويري لـ userId
    let userId = req.user?.id;
    if (!userId) {
      const defaultEmployee = await prisma.employee.findFirst();
      userId = defaultEmployee?.id;
    }

    const record = await prisma.studyRequest.findUnique({ where: { id } });

    if (record.readinessLevel === "غير قابلة للتحويل" && !overrideReason) {
      return res.status(400).json({
        success: false,
        message:
          "الحالة غير جاهزة للتحويل. يرجى استكمال المتطلبات أو تقديم مبرر التجاوز (Override).",
      });
    }

    // بعد نجاح الإنشاء، نقوم بقفل السجل
    await prisma.studyRequest.update({
      where: { id },
      data: {
        isLocked: true,
        operationalStatus: "تم التحويل إلى معاملة",
      },
    });

    if (userId) {
      await logTimelineEvent(
        id,
        userId,
        "CONVERSION",
        "تم التحويل إلى معاملة رسمية",
        overrideReason,
        "teal",
      );
    }

    res.json({
      success: true,
      message: "تم تحويل الحالة وإقفال السجل المبدئي بنجاح.",
    });
  } catch (error) {
    console.error("Conversion Error:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء التحويل للمعاملة." });
  }
};
// ==========================================
// 🚀 رفع دفعة مستندات (Batch Upload - File 05)
// ==========================================
exports.uploadBatch = async (req, res) => {
  try {
    // 1. استلام البيانات من الـ FormData
    const { source, senderName, aiMode, uploadedById } = req.body;
    let studyRequestId = req.params.id;
    const metadata = JSON.parse(req.body.metadata || "[]");
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: "لم يتم استلام أي ملفات." });
    }

    // 2. إذا لم يكن هناك recordId، ننشئ حالة جديدة
    if (!studyRequestId || studyRequestId === 'undefined') {
      const requestCode = await generateRequestCode();
      const newRequest = await prisma.studyRequest.create({
        data: {
          requestCode,
          title: "طلب من مرفقات",
          operationalStatus: "NEW",
          createdById: uploadedById,
        }
      });
      studyRequestId = newRequest.id;
      await logTimelineEvent(studyRequestId, uploadedById, "STATUS_CHANGE", "تم إنشاء الحالة تلقائياً من عملية رفع", null, "green");
    }

    // 3. إنشاء سجل الدفعة (Upload Batch)
    const batchCount = await prisma.studyUploadBatch.count({ where: { studyRequestId } });
    const batch = await prisma.studyUploadBatch.create({
      data: {
        batchNumber: `B${String(batchCount + 1).padStart(2, '0')}`,
        source,
        senderName,
        totalFiles: files.length,
        successfulFiles: files.length,
        studyRequestId
      }
    });

    // 4. إنشاء سجلات المرفقات (Attachments) وربطها بالدفعة
    const attachmentPromises = files.map((file, index) => {
      const meta = metadata[index];
      
      return prisma.studyAttachment.create({
        data: {
          studyRequestId,
          batchId: batch.id,
          uploadedById,
          originalName: meta.originalName,
          displayName: meta.displayName,
          fileUrl: `/uploads/study-requests/${file.filename}`, // تأكد من المسار أنه يطابق الـ multer
          extension: meta.extension,
          mimeType: file.mimetype,
          fileSize: meta.size,
          documentType: meta.category,
          reviewStatus: "NEW"
        }
      });
    });

    await Promise.all(attachmentPromises);

    // 5. تحديث الخط الزمني وتاريخ آخر نشاط
    await prisma.studyRequest.update({ 
      where: { id: studyRequestId }, 
      data: { lastActivityAt: new Date() } 
    });

    await logTimelineEvent(
      studyRequestId, 
      uploadedById, 
      "DOCUMENT", 
      `تم رفع دفعة مستندات (${batch.batchNumber})`, 
      `تحتوي على ${files.length} ملفات.`, 
      "orange"
    );

    // ==============================================================
    // 🤖 6. الإضافة الجديدة: تحفيز طابور الذكاء الاصطناعي (AI Queue)
    // ==============================================================
    if (aiMode === "ANALYZE_AND_MERGE" || aiMode === "ANALYZE_ONLY") {
      
      // أ. إنشاء سجل في جدول مهام الذكاء الاصطناعي (AiJob) لتتبع العملية
      const newAiJob = await prisma.aiJob.create({
        data: {
          jobType: "PROCESS_STUDY_BATCH",
          status: "PENDING",
          targetId: studyRequestId,
          targetType: "STUDY_REQUEST",
          requestedBy: uploadedById
        }
      });

      // ب. إرسال المهمة إلى طابور BullMQ
      await aiQueue.add(
        "PROCESS_STUDY_BATCH", 
        {
          jobType: "PROCESS_STUDY_BATCH", // يجب أن يطابق الموجود في switch (jobType) داخل aiWorker.js
          dbJobId: newAiJob.id,           // مهم جداً للـ Worker لتحديث الـ Progress
          employeeId: uploadedById,       // لإرسال الإشعار للموظف عند الانتهاء
          studyRequestId: studyRequestId,
          batchId: batch.id,
          userId: uploadedById
        },
        { 
          removeOnComplete: true, // تنظيف الطابور من المهام الناجحة 
          removeOnFail: false     // إبقاء المهام الفاشلة للمراجعة
        }
      );
    }

    res.status(201).json({ success: true, message: "تم رفع الدفعة بنجاح، وجاري تحليلها.", batchId: batch.id });

  } catch (error) {
    console.error("Batch Upload Error:", error);
    res.status(500).json({ success: false, message: "فشل رفع الملفات وحفظ الدفعة." });
  }
};

// ==========================================
// 👁️ التحليل الفوري للمراجعة (Instant AI Analysis)
// ==========================================
exports.instantAiAnalysis = async (req, res) => {
  const uploadedGeminiFiles = [];
  let ai;

  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: "لم يتم استلام أي ملفات." });
    }

    // تهيئة Gemini
    const systemSettings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    const apiKey = systemSettings?.geminiApiKey ? decrypt(systemSettings.geminiApiKey) : process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("مفتاح الذكاء الاصطناعي غير متوفر.");
    
    ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 120000 } });

    // رفع الملفات لـ Gemini
    for (const file of files) {
      const filePath = path.join(__dirname, "../../uploads/study-requests", file.filename);
      if (fs.existsSync(filePath)) {
        const uploadResult = await ai.files.upload({
          file: filePath,
          mimeType: file.mimetype || "application/pdf",
          displayName: file.originalname,
        });
        // نربط اسم الملف الأصلي لكي يتعرف عليه الفرونت إند
        uploadedGeminiFiles.push({ geminiFile: uploadResult, originalName: file.originalname });
      }
    }

    // هندسة أوامر سريعة جداً (فقط للتصنيف لتكون سريعة للمستخدم)
    const SYSTEM_PROMPT = `
أنت خبير تصنيف مستندات هندسية وعقارية في السعودية.
قم بتحليل المستندات المرفقة وصنفها حصرياً ضمن هذه الفئات:
(صك ملكية، رخصة بناء، مخطط هندسي، هوية / سجل، غير مصنف).

أرجع النتيجة بصيغة JSON حصرياً بهذا الهيكل:
{
  "results": [
    {
      "fileName": "يجب أن يطابق اسم الملف المرفق تماماً",
      "suggestedCategory": "التصنيف",
      "confidence": 0.95
    }
  ]
}`;

    const fileParts = uploadedGeminiFiles.map(f => ({
      fileData: { fileUri: f.geminiFile.uri, mimeType: f.geminiFile.mimeType }
    }));

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", // استخدمنا flash لأنه أسرع للتحليل اللحظي
      contents: ["صنف هذه الملفات وأعطني الـ JSON", ...fileParts],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    let responseText = response.text || "";
    responseText = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
    const aiResult = JSON.parse(responseText);

    res.json({ success: true, data: aiResult.results });

  } catch (error) {
    console.error("Instant AI Error:", error);
    res.status(500).json({ success: false, message: "فشل التحليل الذكي الفوري." });
  } finally {
    // 🧹 تنظيف الملفات لأنها لم تُعتمد بعد
    if (req.files) {
      req.files.forEach(file => {
        const filePath = path.join(__dirname, "../../uploads/study-requests", file.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // مسح من السيرفر
      });
    }
    if (ai && uploadedGeminiFiles.length > 0) {
      for (const f of uploadedGeminiFiles) {
        try { await ai.files.delete({ name: f.geminiFile.name }); } catch (e) {} // مسح من Gemini
      }
    }
  }
};

// ==========================================
// 7. إعادة التحليل بالذكاء الاصطناعي (Re-Analyze - File 06)
// ==========================================
exports.reAnalyzeStudyRequest = async (req, res) => {
  try {
    const { id } = req.params;
    
    let userId = req.user?.id;
    if (!userId) {
      const defaultEmployee = await prisma.employee.findFirst();
      userId = defaultEmployee?.id;
    }

    // جلب أحدث دفعة مرفقات لإعادة تحليلها (أو يمكنك تعديل الـ Worker ليحلل كل المرفقات)
    const latestBatch = await prisma.studyUploadBatch.findFirst({
      where: { studyRequestId: id },
      orderBy: { createdAt: 'desc' }
    });

    if (!latestBatch) {
      return res.status(400).json({ success: false, message: "لا توجد مستندات مرفوعة لتحليلها." });
    }

    // أ. إنشاء سجل في جدول مهام الذكاء الاصطناعي (AiJob)
    const newAiJob = await prisma.aiJob.create({
      data: {
        jobType: "PROCESS_STUDY_BATCH",
        status: "PENDING",
        targetId: id,
        targetType: "STUDY_REQUEST",
        requestedBy: userId
      }
    });

    // ب. إرسال المهمة إلى طابور BullMQ
    await aiQueue.add(
      "PROCESS_STUDY_BATCH", 
      {
        jobType: "PROCESS_STUDY_BATCH",
        dbJobId: newAiJob.id,
        employeeId: userId,
        studyRequestId: id,
        batchId: latestBatch.id, // نرسل أحدث دفعة للتحليل
        userId: userId
      },
      { removeOnComplete: true }
    );

    await logTimelineEvent(id, userId, "AI_RUN", "طلب إعادة تحليل", "تم إرسال الطلب للذكاء الاصطناعي", "blue");

    res.json({ success: true, message: "تم إرسال الطلب للذكاء الاصطناعي، سيتم إشعارك عند الانتهاء." });
  } catch (error) {
    console.error("Re-Analyze Error:", error);
    res.status(500).json({ success: false, message: "فشل طلب إعادة التحليل." });
  }
};
// ==========================================
// 8. الحذف الآمن للحالة (Soft Delete)
// ==========================================
exports.deleteStudyRequest = async (req, res) => {
  try {
    const { id } = req.params;
    
    // نستخدم الحذف الآمن (Soft Delete) للحفاظ على سلامة البيانات
    await prisma.studyRequest.update({
      where: { id },
      data: { isDeleted: true }
    });

    res.json({ success: true, message: "تم حذف الحالة ونقلها للأرشيف المحذوف." });
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ success: false, message: "فشل حذف الحالة." });
  }
};
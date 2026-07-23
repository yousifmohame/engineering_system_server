const prisma = require("../utils/prisma");
const {
  generateRequestCode,
  evaluateReadiness,
  logTimelineEvent,
  logAudit,
} = require("../utils/studyHelpers");
const { GoogleGenAI } = require("@google/genai");
const { aiQueue } = require("../queue/aiQueue"); // 👈 1. استيراد الطابور لإرسال المهام إليه مجدداً
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
        return res.status(400).json({
          success: false,
          message: "لا يوجد أي موظف مسجل في النظام لربط الطلب به!",
        });
      }
      userId = defaultEmployee.id;
    }

    // يكفي معلومة واحدة لإنشاء السجل
    if (!title && !originalRequestText && !contactMobile && !req.files) {
      return res.status(400).json({
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

    if (status) where.operationalStatus = status;
    if (readiness) where.readinessLevel = readiness;

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
          createdBy: { select: { name: true } }, // 🚀 1. التعديل هنا: جلب اسم منشئ الطلب
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

        // 🚀 1. التعديل الأهم: جلب المرفقات مباشرة مع اسم الموظف الرافع
        attachments: {
          include: { uploadedBy: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },

        // 🚀 2. جلب المرفقات داخل الدفعات أيضاً مع اسم الموظف للاحتياط
        batches: {
          include: {
            attachments: {
              include: { uploadedBy: { select: { name: true } } },
            },
          },
        },

        notes: {
          include: { author: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
        decisions: {
          include: { decidedBy: { select: { name: true } } }, // جلب اسم متخذ القرار
          orderBy: { createdAt: "desc" },
        },
        timelineEvents: {
          include: { user: { select: { name: true } } }, // جلب اسم صانع الحدث
          orderBy: { createdAt: "desc" },
        },
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
      return res.status(403).json({
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

    res.status(201).json({
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
      return res
        .status(400)
        .json({ success: false, message: "لم يتم استلام أي ملفات." });
    }

    // 2. إذا لم يكن هناك recordId، ننشئ حالة جديدة
    if (!studyRequestId || studyRequestId === "undefined") {
      const requestCode = await generateRequestCode();
      const newRequest = await prisma.studyRequest.create({
        data: {
          requestCode,
          title: "طلب من مرفقات",
          operationalStatus: "NEW",
          createdById: uploadedById,
        },
      });
      studyRequestId = newRequest.id;
      await logTimelineEvent(
        studyRequestId,
        uploadedById,
        "STATUS_CHANGE",
        "تم إنشاء الحالة تلقائياً من عملية رفع",
        null,
        "green",
      );
    }

    // 3. إنشاء سجل الدفعة (Upload Batch)
    const batchCount = await prisma.studyUploadBatch.count({
      where: { studyRequestId },
    });
    const batch = await prisma.studyUploadBatch.create({
      data: {
        batchNumber: `B${String(batchCount + 1).padStart(2, "0")}`,
        source,
        senderName,
        totalFiles: files.length,
        successfulFiles: files.length,
        studyRequestId,
      },
    });

    // 4. إنشاء سجلات المرفقات (Attachments) وربطها بالدفعة
    const attachmentPromises = files.map((file, index) => {
      const meta = metadata[index];
      const notesStr = meta.extractedFields
        ? JSON.stringify(meta.extractedFields)
        : null; // 👈 التعديل هنا

      return prisma.studyAttachment.create({
        data: {
          studyRequestId,
          batchId: batch.id,
          uploadedById,
          originalName: meta.originalName,
          displayName: meta.displayName,
          fileUrl: `/uploads/study-requests/${file.filename}`,
          extension: meta.extension,
          mimeType: file.mimetype,
          fileSize: meta.size,
          documentType: meta.category,
          reviewStatus: "NEW",
          notes: notesStr, // 👈 حفظ الحقول المستخرجة في الملاحظات
          aiAnalysisStatus: meta.extractedFields ? "COMPLETED" : "PENDING",
        },
      });
    });

    await Promise.all(attachmentPromises);

    // 5. تحديث الخط الزمني وتاريخ آخر نشاط
    await prisma.studyRequest.update({
      where: { id: studyRequestId },
      data: { lastActivityAt: new Date() },
    });

    await logTimelineEvent(
      studyRequestId,
      uploadedById,
      "DOCUMENT",
      `تم رفع دفعة مستندات (${batch.batchNumber})`,
      `تحتوي على ${files.length} ملفات.`,
      "orange",
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
          requestedBy: uploadedById,
        },
      });

      // ب. إرسال المهمة إلى طابور BullMQ
      await aiQueue.add(
        "PROCESS_STUDY_BATCH",
        {
          jobType: "PROCESS_STUDY_BATCH", // يجب أن يطابق الموجود في switch (jobType) داخل aiWorker.js
          dbJobId: newAiJob.id, // مهم جداً للـ Worker لتحديث الـ Progress
          employeeId: uploadedById, // لإرسال الإشعار للموظف عند الانتهاء
          studyRequestId: studyRequestId,
          batchId: batch.id,
          userId: uploadedById,
        },
        {
          removeOnComplete: true, // تنظيف الطابور من المهام الناجحة
          removeOnFail: false, // إبقاء المهام الفاشلة للمراجعة
        },
      );
    }

    res.status(201).json({
      success: true,
      message: "تم رفع الدفعة بنجاح، وجاري تحليلها.",
      batchId: batch.id,
    });
  } catch (error) {
    console.error("Batch Upload Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل رفع الملفات وحفظ الدفعة." });
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
    if (!files || files.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "لم يتم استلام أي ملفات." });

    const systemSettings = await prisma.systemSettings.findUnique({
      where: { id: 1 },
    });
    const apiKey = systemSettings?.geminiApiKey
      ? decrypt(systemSettings.geminiApiKey)
      : process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("مفتاح الذكاء الاصطناعي غير متوفر.");

    ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 120000 } });

    for (const file of files) {
      const filePath = path.join(
        __dirname,
        "../../uploads/study-requests",
        file.filename,
      );
      if (fs.existsSync(filePath)) {
        const uploadResult = await ai.files.upload({
          file: filePath,
          mimeType: file.mimetype || "application/pdf",
          displayName: file.originalname,
        });
        uploadedGeminiFiles.push({
          geminiFile: uploadResult,
          originalName: file.originalname,
        });
      }
    }

    // 🚀 التعديل: هندسة أوامر صارمة لضمان إرجاع الحقول دائماً (حتى لو فارغة)
    const SYSTEM_PROMPT = `
أنت خبير تصنيف مستندات هندسية وعقارية في السعودية.
قم بتحليل المستندات المرفقة وصنفها واستخرج البيانات الأساسية منها للمراجعة السريعة.

أرجع النتيجة بصيغة JSON حصرياً بهذا الهيكل (استخدم null للقيم غير الموجودة):
{
  "results": [
    {
      "fileName": "يجب أن يطابق اسم الملف المرفق تماماً",
      "suggestedCategory": "تصنيف المستند (صك ملكية، رخصة بناء، هوية / سجل، مخطط هندسي، غير مصنف)",
      "confidence": 0.95,
      "extractedFields": {
        "ownerName": "اسم المالك أو الملاك",
        "deedNumber": "رقم الصك أو الوثيقة",
        "planNumber": "رقم المخطط",
        "plotNumber": "رقم القطعة",
        "district": "الحي",
        "totalArea": "المساحة بالأرقام فقط",
        "propertyUsage": "نوع الاستخدام"
      }
    }
  ]
}
تأكد من عدم كتابة أي نصوص خارج هيكل الـ JSON.`;

    const fileParts = uploadedGeminiFiles.map((f) => ({
      fileData: { fileUri: f.geminiFile.uri, mimeType: f.geminiFile.mimeType },
    }));

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: ["حلل هذه الملفات وأعطني الـ JSON", ...fileParts],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    // 🚀 التعديل: تنظيف الـ JSON وتحويل الأرقام العربية لتجنب الأخطاء
    let responseText = response.text || "";
    responseText = responseText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    responseText = responseText.replace(/[٠-٩]/g, (d) =>
      "٠١٢٣٤٥٦٧٨٩".indexOf(d),
    );
    const aiResult = JSON.parse(responseText);

    res.json({ success: true, data: aiResult.results });
  } catch (error) {
    console.error("Instant AI Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل التحليل الذكي الفوري." });
  } finally {
    if (req.files) {
      req.files.forEach((file) => {
        const filePath = path.join(
          __dirname,
          "../../uploads/study-requests",
          file.filename,
        );
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });
    }
    if (ai && uploadedGeminiFiles.length > 0) {
      for (const f of uploadedGeminiFiles) {
        try {
          await ai.files.delete({ name: f.geminiFile.name });
        } catch (e) {}
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

    // 🚀 الإصلاح 2: التأكد من وجود مرفقات بشكل عام في السجل
    const attachmentsCount = await prisma.studyAttachment.count({
      where: { studyRequestId: id },
    });
    if (attachmentsCount === 0) {
      return res.status(400).json({
        success: false,
        message: "لا توجد مستندات في السجل لإعادة تحليلها.",
      });
    }

    // 🚀 إنشاء "دفعة إعادة تحليل" جديدة لجمع كافة الملفات فيها
    const batchCount = await prisma.studyUploadBatch.count({
      where: { studyRequestId: id },
    });
    const reAnalyzeBatch = await prisma.studyUploadBatch.create({
      data: {
        batchNumber: `RE-B${String(batchCount + 1).padStart(2, "0")}`, // مثال: RE-B03
        source: "إعادة تقييم شاملة (AI)",
        senderName: "النظام",
        totalFiles: attachmentsCount,
        successfulFiles: attachmentsCount,
        studyRequestId: id,
      },
    });

    // 🚀 ربط جميع المرفقات الحالية بهذه الدفعة الجديدة ليقوم الـ Worker بقراءتها كلها معاً
    await prisma.studyAttachment.updateMany({
      where: { studyRequestId: id },
      data: {
        batchId: reAnalyzeBatch.id,
        aiAnalysisStatus: "PENDING", // إعادة تصفير الحالة
      },
    });

    // أ. إنشاء سجل في جدول مهام الذكاء الاصطناعي (AiJob)
    const newAiJob = await prisma.aiJob.create({
      data: {
        jobType: "PROCESS_STUDY_BATCH",
        status: "PENDING",
        targetId: id,
        targetType: "STUDY_REQUEST",
        requestedBy: userId,
      },
    });

    // ب. إرسال المهمة إلى طابور BullMQ مع الـ Batch الجديد الذي يحتوي كل الملفات
    await aiQueue.add(
      "PROCESS_STUDY_BATCH",
      {
        jobType: "PROCESS_STUDY_BATCH",
        dbJobId: newAiJob.id,
        employeeId: userId,
        studyRequestId: id,
        batchId: reAnalyzeBatch.id, // نرسل دفعة إعادة التحليل
        userId: userId,
      },
      { removeOnComplete: true },
    );

    await logTimelineEvent(
      id,
      userId,
      "AI_RUN",
      "طلب إعادة تحليل ذكي",
      "تم تجميع كافة المرفقات في دفعة جديدة وإرسالها للتحليل.",
      "blue",
    );

    res.json({
      success: true,
      message: "تم إرسال الطلب للذكاء الاصطناعي لمعالجة كافة الملفات.",
    });
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
      data: { isDeleted: true },
    });

    res.json({
      success: true,
      message: "تم حذف الحالة ونقلها للأرشيف المحذوف.",
    });
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ success: false, message: "فشل حذف الحالة." });
  }
};

// ==========================================
// 12. رفع مستندات إضافية مباشرة (بدون ذكاء اصطناعي)
// ==========================================
exports.uploadDirectAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    const files = req.files;
    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : [];

    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم استلام أي ملفات." });
    }

    // 💡 التعديل التطويري لـ userId
    let userId = req.user?.id;
    if (!userId) {
      const defaultEmployee = await prisma.employee.findFirst();
      userId = defaultEmployee?.id;
    }

    // إنشاء سجلات المرفقات مباشرة وربطها بالمعاملة (بدون إنشاء دفعة Batch)
    const attachmentPromises = files.map((file, index) => {
      const meta = metadata[index] || {};

      return prisma.studyAttachment.create({
        data: {
          studyRequestId: id,
          uploadedById: userId,
          originalName: meta.originalName || file.originalname,
          displayName:
            meta.displayName ||
            file.originalname.split(".").slice(0, -1).join("."),
          fileUrl: `/uploads/study-requests/${file.filename}`,
          extension:
            meta.extension || file.originalname.split(".").pop().toUpperCase(),
          mimeType: file.mimetype,
          fileSize: file.size,
          documentType: meta.category || "غير مصنف",
          reviewStatus: "NEW",
          // نضع حالة الذكاء الاصطناعي كـ "غير مطبق" لأننا رفعناها يدوياً
          aiAnalysisStatus: "NOT_APPLIED",
        },
      });
    });

    await Promise.all(attachmentPromises);

    // تحديث تاريخ آخر نشاط للمعاملة
    await prisma.studyRequest.update({
      where: { id },
      data: { lastActivityAt: new Date() },
    });

    // تسجيل الحدث في الخط الزمني
    await logTimelineEvent(
      id,
      userId,
      "DOCUMENT",
      "تم رفع مستندات إضافية",
      `تمت إضافة ${files.length} ملف(ات) جديدة يدوياً.`,
      "gray",
    );

    res.status(201).json({
      success: true,
      message: "تم رفع المستندات الإضافية بنجاح.",
    });
  } catch (error) {
    console.error("Direct Upload Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل رفع المستندات الإضافية." });
  }
};

// ==========================================
// 9. تحديث اسم المرفق
// ==========================================
exports.updateAttachmentName = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const { displayName } = req.body;
    await prisma.studyAttachment.update({
      where: { id: attachmentId },
      data: { displayName },
    });
    res.json({ success: true, message: "تم تحديث اسم المرفق بنجاح." });
  } catch (error) {
    console.error("Update Attachment Error:", error);
    res.status(500).json({ success: false, message: "فشل تحديث اسم المرفق." });
  }
};

// ==========================================
// 10. حذف المرفق
// ==========================================
exports.deleteAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    // نقوم بحذف المرفق نهائياً
    await prisma.studyAttachment.delete({
      where: { id: attachmentId },
    });
    res.json({ success: true, message: "تم حذف المرفق بنجاح." });
  } catch (error) {
    console.error("Delete Attachment Error:", error);
    res.status(500).json({ success: false, message: "فشل حذف المرفق." });
  }
};

// ==========================================
// 11. إضافة ملاحظة يدوية للخط الزمني
// ==========================================
exports.addStudyNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    let userId = req.user?.id;
    if (!userId) {
      const defaultEmployee = await prisma.employee.findFirst();
      userId = defaultEmployee?.id;
    }

    const note = await prisma.studyNote.create({
      data: { studyRequestId: id, text, type: "GENERAL", authorId: userId },
    });

    await logTimelineEvent(
      id,
      userId,
      "NOTE",
      "إضافة ملاحظة إدارية",
      text,
      "blue",
    );
    await prisma.studyRequest.update({
      where: { id },
      data: { lastActivityAt: new Date() },
    });

    res.json({ success: true, data: note, message: "تمت إضافة الملاحظة." });
  } catch (error) {
    console.error("Add Note Error:", error);
    res.status(500).json({ success: false, message: "فشل إضافة الملاحظة." });
  }
};

// ==========================================
// 13. تعديل قرار معتمد (Update Decision)
// ==========================================
exports.updateDecision = async (req, res) => {
  try {
    const { decisionId } = req.params;
    const { title, type, details } = req.body;

    let userId = req.user?.id;
    if (!userId) {
      const defaultEmployee = await prisma.employee.findFirst();
      userId = defaultEmployee?.id;
    }

    // جلب القرار القديم للمقارنة والتأكد من وجوده
    const oldDecision = await prisma.studyDecision.findUnique({
      where: { id: decisionId },
    });

    if (!oldDecision) {
      return res.status(404).json({ success: false, message: "القرار غير موجود." });
    }

    // تحديث القرار
    const updatedDecision = await prisma.studyDecision.update({
      where: { id: decisionId },
      data: { title, type, details, decidedById: userId },
    });

    // توثيق التعديل في الخط الزمني
    await logTimelineEvent(
      oldDecision.studyRequestId,
      userId,
      "DECISION",
      `تم تعديل قرار: ${title}`,
      `القرار القديم: ${oldDecision.title} - تم التحديث بنجاح.`,
      "orange"
    );

    res.json({
      success: true,
      data: updatedDecision,
      message: "تم تحديث القرار بنجاح.",
    });
  } catch (error) {
    console.error("Update Decision Error:", error);
    res.status(500).json({ success: false, message: "فشل تحديث القرار." });
  }
};
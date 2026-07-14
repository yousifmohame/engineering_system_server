const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

// تهيئة الذكاء الاصطناعي
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ==========================================
// 1. رفع أنظمة البناء وبدء التحليل في الخلفية
// ==========================================
const uploadBuildingCode = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "الرجاء إرفاق ملفات أنظمة البناء" });
    }

    const userId = req.user?.id || "النظام";
    const createdRecords = [];

    for (const file of req.files) {
      const fileUrl = `/uploads/building-codes/${file.filename}`;

      // 💡 هنا يتم إنشاء السجل.. لاحظ أننا لم نرسل serialNumber
      // قاعدة البيانات ستقوم بتوليده تلقائياً وحجزه لهذا السجل للأبد
      const newRecord = await prisma.buildingCodeArchiveRecord.create({
        data: {
          documentType: "UNCLASSIFIED",
          sourceFileUrl: fileUrl,
          sourceFileName: file.originalname,
          status: "ANALYZING",
          uploadedById: userId,
        },
      });
      createdRecords.push(newRecord);

      await prisma.buildingCodeAuditLog.create({
        data: {
          buildingCodeId: newRecord.id,
          action: "UPLOAD",
          userId: userId,
          notes: "تم رفع الملف وبدء التحليل الآلي",
        },
      });

      processBuildingCodeAI(newRecord.id, file.path, userId).catch(
        console.error,
      );
    }

    res.status(202).json({
      success: true,
      message: "تم استلام الملفات وجاري تحليلها لاستخراج الاشتراطات والقطاعات",
      data: createdRecords,
    });
  } catch (error) {
    console.error("Upload Building Code Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 💡 2. دالة معالجة الذكاء الاصطناعي (مضادة للانهيار)
// ==========================================
const processBuildingCodeAI = async (recordId, filePath, userId) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let mimeType = "image/jpeg";
    if (ext === ".pdf") mimeType = "application/pdf";
    else if (ext === ".png") mimeType = "image/png";
    else if (ext === ".webp") mimeType = "image/webp";

    const documentPart = {
      inlineData: { data: fileBuffer.toString("base64"), mimeType },
    };

    const prompt = `
      أنت مهندس تخطيط عمراني وأنظمة بناء خبير في السعودية وأمانة الرياض.
      استخرج كافة تفاصيل نظام البناء من المستند المرفق. قد يكون المستند حديثاً، أو قديماً، أو أولياً.
      
      قواعد الاستخراج:
      1. الأرقام فقط: أي حقل يحتوي على مساحة أو ارتداد أرجع الرقم فقط بدون حروف (مثال: ارجع 3.5 ولا ترجع 3.5م).
      2. عدد الأدوار (maxFloors): حول النصوص إلى أرقام (مثال: أرضي + أول = 2).
      3. الارتفاع المفتوح: إذا ذكر "مفتوح"، اجعل openHeight = true و maxFloors = null.
      4. الملحق العلوي: إذا لم يحدد نسبة، ضع roofAnnexPercentage = 50.
      5. القطاعات المتعددة: إذا كان النظام مقسماً لقطاعات، اجعل hasMultipleZones = true وعبئ مصفوفة zones.

      استخرج البيانات بصيغة JSON فقط بهذا الهيكل تماماً:
      {
        "documentType": "APPROVED",
        "systemNo": "",
        "requestNo": "",
        "transactionNo": "",
        "unifiedNo": "",
        "versionNo": "",
        "issuingAuthority": "",
        "issuingDepartment": "",
        "municipality": "",
        "district": "",
        "planNo": "",
        "plotNo": "",
        "blockNo": "",
        "deedNo": "",
        "surveyDecisionNo": "",
        "ownerName": "",
        "officeName": "",
        "streetName": "",
        "streetWidth": 0.0,
        "totalArea": 0.0,
        "projectLocationDescription": "",
        "zoningArea": "",
        "planningRequirementsText": "",
        "usageText": "",
        "setbacksText": "",
        "frontSetback": 0.0,
        "sideSetback": 0.0,
        "rearSetback": 0.0,
        "mainStreetSetback": 0.0,
        "sideStreetSetback": 0.0,
        "neighborSetback": 0.0,
        "heightText": "",
        "maxFloors": 0,
        "openHeight": false,
        "hasRoofAnnex": "UNKNOWN",
        "roofAnnexPercentage": 0.0,
        "roofAnnexBase": "UNKNOWN",
        "roofAnnexSetback": 0.0,
        "roofAnnexCountsInFar": "UNKNOWN",
        "farValue": 0.0,
        "buildingCoveragePercentage": 0.0,
        "parkingRequirementsText": "",
        "specialNotesText": "",
        "specialRestrictionsJson": [],
        "approvalDateGregorian": "",
        "approvalDateHijri": "",
        "approvalDateOriginalText": "",
        "approvalDateSource": "DOCUMENT_TEXT",
        "aiConfidenceOverall": 0.95,
        "hasMultipleZones": false,
        "zones": []
      }
    `;

    let response = null;
    const fallbackModels = [
      "gemini-3-flash-preview",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ];

    for (const model of fallbackModels) {
      try {
        response = await ai.models.generateContent({
          model: model,
          contents: [prompt, documentPart],
          config: { temperature: 0.0, responseMimeType: "application/json" },
        });
        break;
      } catch (e) {
        console.warn(`فشل الموديل ${model}، جاري المحاولة بالبديل...`);
      }
    }

    if (!response) throw new Error("فشل الاتصال بنماذج الذكاء الاصطناعي");

    let jsonStr = response.text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const cleanedText = jsonStr.replace(/[٠-٩]/g, (d) =>
      "٠١٢٣٤٥٦٧٨٩".indexOf(d),
    );
    const aiData = JSON.parse(cleanedText);

    // ✅ دوال تنظيف الأرقام لمنع انهيار Prisma
    const safeFloat = (val) => {
      if (val === null || val === undefined || val === "") return null;
      const parsed = parseFloat(String(val).replace(/[^\d.-]/g, ""));
      return isNaN(parsed) ? null : parsed;
    };

    const safeInt = (val) => {
      if (val === null || val === undefined || val === "") return null;
      const parsed = parseInt(String(val).replace(/[^\d-]/g, ""), 10);
      return isNaN(parsed) ? null : parsed;
    };

    // حساب التواريخ والصلاحية
    let validityStatus = "UNKNOWN";
    let expiryDateGregorian = null;
    let validityDays = 365;

    if (aiData.documentType === "PRELIMINARY") {
      validityStatus = "PRELIMINARY";
    } else if (aiData.approvalDateGregorian) {
      const approvalDate = new Date(aiData.approvalDateGregorian);
      if (!isNaN(approvalDate)) {
        expiryDateGregorian = new Date(
          approvalDate.getTime() + validityDays * 24 * 60 * 60 * 1000,
        );
        const daysUntilExpiry = Math.ceil(
          (expiryDateGregorian - new Date()) / (1000 * 60 * 60 * 24),
        );
        if (daysUntilExpiry < 0) validityStatus = "EXPIRED";
        else if (daysUntilExpiry <= 60) validityStatus = "EXPIRING_SOON";
        else validityStatus = "VALID";
      }
    }

    // ✅ عزل عملية فحص التكرار لمنعها من تدمير عملية الحفظ الأساسية
    let finalStatus = "COMPLETED";
    try {
      if (aiData.planNo && aiData.plotNo && aiData.district) {
        const existing = await prisma.buildingCodeArchiveRecord.findFirst({
          where: {
            planNo: String(aiData.planNo),
            plotNo: String(aiData.plotNo),
            district: String(aiData.district),
            id: { not: recordId },
            isArchived: false,
          },
        });

        if (existing) {
          finalStatus = "DUPLICATE";
          await prisma.buildingCodeDuplicateCandidate.create({
            data: {
              recordAId: existing.id,
              recordBId: recordId,
              duplicateType: "SIMILAR",
              matchScore: 90,
              status: "PENDING",
              notes: "تم اكتشاف تطابق في رقم المخطط والقطعة والحي",
            },
          });
        }
      }
    } catch (dupError) {
      console.error("⚠️ خطأ غير مؤثر أثناء فحص التكرار:", dupError);
      // نستمر في الحفظ حتى لو فشل فحص التكرار
    }

    const confidence = safeFloat(aiData.aiConfidenceOverall) || 0.9;

    // تجهيز القطاعات إن وجدت
    let zonesCreateInput = undefined;
    if (
      aiData.hasMultipleZones &&
      Array.isArray(aiData.zones) &&
      aiData.zones.length > 0
    ) {
      zonesCreateInput = {
        create: aiData.zones.map((zone) => ({
          zoneName: String(zone.zoneName || "قطاع غير مسمى"),
          zoneDescription: zone.zoneDescription,
          zoneDepth: safeFloat(zone.zoneDepth),
          zoneFacing: zone.zoneFacing,
          usageText: zone.usageText,
          heightText: zone.heightText,
          maxFloors: safeInt(zone.maxFloors),
          buildingCoveragePercentage: safeFloat(
            zone.buildingCoveragePercentage,
          ),
          farValue: safeFloat(zone.farValue),
          setbacksText: zone.setbacksText,
          hasRoofAnnex: zone.hasRoofAnnex || "UNKNOWN",
          roofAnnexPercentage: safeFloat(zone.roofAnnexPercentage),
          roofAnnexNotes: zone.roofAnnexNotes,
          parkingNotes: zone.parkingNotes,
          specialNotes: zone.specialNotes,
          aiConfidence: confidence,
        })),
      };
    }

    // ✅ التحديث الآمن للسجل الأساسي
    await prisma.buildingCodeArchiveRecord.update({
      where: { id: recordId },
      data: {
        documentType: aiData.documentType || "UNCLASSIFIED",
        systemNo: aiData.systemNo ? String(aiData.systemNo) : null,
        requestNo: aiData.requestNo ? String(aiData.requestNo) : null,
        transactionNo: aiData.transactionNo
          ? String(aiData.transactionNo)
          : null,
        unifiedNo: aiData.unifiedNo ? String(aiData.unifiedNo) : null,
        versionNo: aiData.versionNo ? String(aiData.versionNo) : null,
        issuingAuthority: aiData.issuingAuthority,
        issuingDepartment: aiData.issuingDepartment,
        municipality: aiData.municipality,
        district: aiData.district ? String(aiData.district) : null,
        planNo: aiData.planNo ? String(aiData.planNo) : null,
        plotNo: aiData.plotNo ? String(aiData.plotNo) : null,
        blockNo: aiData.blockNo ? String(aiData.blockNo) : null,
        deedNo: aiData.deedNo ? String(aiData.deedNo) : null,
        surveyDecisionNo: aiData.surveyDecisionNo
          ? String(aiData.surveyDecisionNo)
          : null,
        ownerName: aiData.ownerName,
        officeName: aiData.officeName,
        streetName: aiData.streetName,

        // استخدام دوال التنظيف لحماية Prisma
        streetWidth: safeFloat(aiData.streetWidth),
        totalArea: safeFloat(aiData.totalArea),

        projectLocationDescription: aiData.projectLocationDescription,
        zoningArea: aiData.zoningArea,
        planningRequirementsText: aiData.planningRequirementsText,
        usageText: aiData.usageText,
        setbacksText: aiData.setbacksText,

        frontSetback: safeFloat(aiData.frontSetback),
        sideSetback: safeFloat(aiData.sideSetback),
        rearSetback: safeFloat(aiData.rearSetback),
        mainStreetSetback: safeFloat(aiData.mainStreetSetback),
        sideStreetSetback: safeFloat(aiData.sideStreetSetback),
        neighborSetback: safeFloat(aiData.neighborSetback),

        heightText: aiData.heightText,
        maxFloors: safeInt(aiData.maxFloors),
        openHeight:
          aiData.openHeight === true ||
          String(aiData.openHeight).toLowerCase() === "true",

        hasRoofAnnex: aiData.hasRoofAnnex || "UNKNOWN",
        roofAnnexPercentage: safeFloat(aiData.roofAnnexPercentage),
        roofAnnexBase: aiData.roofAnnexBase,
        roofAnnexSetback: safeFloat(aiData.roofAnnexSetback),
        roofAnnexCountsInFar: aiData.roofAnnexCountsInFar || "UNKNOWN",

        farValue: safeFloat(aiData.farValue),
        buildingCoveragePercentage: safeFloat(
          aiData.buildingCoveragePercentage,
        ),
        parkingRequirementsText: aiData.parkingRequirementsText,
        specialNotesText: aiData.specialNotesText,
        specialRestrictionsJson: Array.isArray(aiData.specialRestrictionsJson)
          ? aiData.specialRestrictionsJson
          : [],

        approvalDateGregorian:
          aiData.approvalDateGregorian &&
          !isNaN(new Date(aiData.approvalDateGregorian))
            ? new Date(aiData.approvalDateGregorian)
            : null,
        approvalDateHijri: aiData.approvalDateHijri,
        approvalDateOriginalText: aiData.approvalDateOriginalText,
        approvalDateSource: aiData.approvalDateSource || "DOCUMENT_TEXT",

        validityDays: validityDays,
        expiryDateGregorian: expiryDateGregorian,

        status: confidence < 0.7 ? "NEEDS_REVIEW" : finalStatus,
        validityStatus: validityStatus,
        aiConfidenceOverall: confidence,
        aiExtractedJson: aiData,
        hasMultipleZones: aiData.hasMultipleZones === true,

        zones: zonesCreateInput,
      },
    });

    await prisma.buildingCodeAuditLog.create({
      data: {
        buildingCodeId: recordId,
        action: "AI_ANALYZE",
        userId,
        notes: `اكتمل تحليل الذكاء الاصطناعي بنجاح. الحالة: ${finalStatus}`,
      },
    });
  } catch (error) {
    console.error(`🔥 AI Error for Building Code Record ${recordId}:`, error);

    // حتى في أسوأ السيناريوهات، نحفظ حالة المراجعة لعدم ضياع الملف
    try {
      await prisma.buildingCodeArchiveRecord.update({
        where: { id: recordId },
        data: {
          status: "NEEDS_REVIEW",
          specialNotesText: "فشل التحليل الآلي، يرجى تعبئة البيانات يدوياً.",
        },
      });
    } catch (e) {
      console.error("فشل التحديث الطارئ:", e);
    }
  }
};

const getBuildingCodes = async (req, res) => {
  try {
    const { search, documentType, status, validityStatus, district } = req.query;
    const where = { isArchived: false };
    
    if (documentType) where.documentType = documentType;
    if (status) where.status = status;
    if (validityStatus) where.validityStatus = validityStatus;
    if (district) where.district = { contains: district };

    if (search) {
      where.OR = [
        { planNo: { contains: search } },
        { plotNo: { contains: search } },
        { systemNo: { contains: search } },
        { unifiedNo: { contains: search } },
        { requestNo: { contains: search } },
      ];
    }

    const records = await prisma.buildingCodeArchiveRecord.findMany({
      where,
      // 💡 لا تقم بإضافة select هنا إذا كنت تريد جلب كل الحقول (بما فيها serialNumber)
      // وإذا كنت تستخدم select، فتأكد من إضافة serialNumber للقائمة
      include: {
        duplicatesAsRecordA: { 
          where: { status: "PENDING" },
          select: { id: true } 
        },
        duplicatesAsRecordB: { 
          where: { status: "PENDING" },
          select: { id: true } 
        }
      },
      orderBy: { createdAt: "desc" },
    });

    // 💡 هنا سيتم إرجاع كل شيء + الحقل المحسوب الجديد
    const formattedRecords = records.map(record => {
      const dupCount = (record.duplicatesAsRecordA?.length || 0) + (record.duplicatesAsRecordB?.length || 0);
      
      // إزالة المصفوفات المساعدة
      delete record.duplicatesAsRecordA;
      delete record.duplicatesAsRecordB;

      return {
        ...record, 
        duplicatesCount: dupCount
      };
    });

    res.json({ success: true, data: formattedRecords });
  } catch (error) {
    console.error("🔥 Get Building Codes Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. دالة لجلب تفاصيل السجلات المكررة لمقارنتها
const getRecordDuplicates = async (req, res) => {
  try {
    const { id } = req.params;

    const duplicates = await prisma.buildingCodeDuplicateCandidate.findMany({
      where: {
        status: "PENDING",
        OR: [{ recordAId: id }, { recordBId: id }],
      },
      include: {
        recordA: true,
        recordB: true,
      },
    });

    res.json({ success: true, data: duplicates });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. دالة للفحص وإعادة الاكتشاف اليدوي للتكرارات (Re-scan)
const scanForDuplicates = async (req, res) => {
  try {
    const records = await prisma.buildingCodeArchiveRecord.findMany({
      where: { isArchived: false },
    });

    let newDuplicatesCount = 0;

    for (let i = 0; i < records.length; i++) {
      for (let j = i + 1; j < records.length; j++) {
        const a = records[i];
        const b = records[j];

        // شروط التطابق (نفس المخطط، نفس القطعة، ونفس الحي)
        if (
          a.planNo &&
          b.planNo &&
          a.planNo === b.planNo &&
          a.plotNo &&
          b.plotNo &&
          a.plotNo === b.plotNo &&
          a.district &&
          b.district &&
          a.district === b.district
        ) {
          // التأكد من عدم وجود سجل مسبق لهذا التطابق
          const existingDup =
            await prisma.buildingCodeDuplicateCandidate.findFirst({
              where: {
                OR: [
                  { recordAId: a.id, recordBId: b.id },
                  { recordAId: b.id, recordBId: a.id },
                ],
              },
            });

          if (!existingDup) {
            await prisma.buildingCodeDuplicateCandidate.create({
              data: {
                recordAId: a.id,
                recordBId: b.id,
                duplicateType: "SIMILAR",
                matchScore: 100,
                status: "PENDING",
                notes:
                  "تم اكتشاف تطابق أثناء الفحص اليدوي (نفس المخطط والقطعة)",
              },
            });
            newDuplicatesCount++;
          }
        }
      }
    }

    res.json({
      success: true,
      message: `اكتمل الفحص! تم اكتشاف ${newDuplicatesCount} تكرار جديد.`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. حذف السجل القديم أثناء معالجة التكرار
const deleteDuplicateRecord = async (req, res) => {
  try {
    const { duplicateId, recordToDeleteId } = req.body; // نرسل ID التكرار و ID السجل المراد حذفه

    // أرشفة أو حذف السجل بالكامل
    await prisma.buildingCodeArchiveRecord.update({
      where: { id: recordToDeleteId },
      data: { isArchived: true, status: "DUPLICATE" },
    });

    // إغلاق حالة التكرار
    await prisma.buildingCodeDuplicateCandidate.update({
      where: { id: duplicateId },
      data: { status: "RESOLVED", resolutionAction: "تم حذف السجل القديم" },
    });

    res.json({
      success: true,
      message: "تمت معالجة التكرار وحذف السجل القديم.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 4. جلب تفاصيل نظام بناء محدد (مع القطاعات والموظفين والارتباطات)
// ==========================================
const getBuildingCodeById = async (req, res) => {
  try {
    const { id } = req.params;
    const record = await prisma.buildingCodeArchiveRecord.findUnique({
      where: { id },
      include: {
        zones: true,
        links: true,
        auditLogs: { orderBy: { createdAt: "desc" }, take: 15 },
      },
    });

    if (!record)
      return res
        .status(404)
        .json({ success: false, message: "نظام البناء غير موجود" });

    // استخراج أسماء الموظفين للتدقيق
    const userIds = [
      ...new Set(record.auditLogs.map((log) => log.userId)),
    ].filter((uid) => uid !== "System" && uid !== "النظام");
    let userMap = {};
    if (userIds.length > 0) {
      const employees = await prisma.employee.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      });
      employees.forEach((emp) => {
        userMap[emp.id] = emp.name;
      });
    }

    const auditLogsWithNames = record.auditLogs.map((log) => ({
      ...log,
      userName:
        log.userId === "System" || log.userId === "النظام"
          ? "النظام الآلي"
          : userMap[log.userId] || log.userId,
    }));

    record.auditLogs = auditLogsWithNames;

    res.json({ success: true, data: record });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 5. التحديث اليدوي لكافة حقول نظام البناء (مع التدقيق)
// ==========================================
const updateBuildingCode = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const userId = req.user?.id || "النظام";

    // معالجة التواريخ في حال تحديثها يدوياً
    let expiryDateGregorian = data.expiryDateGregorian
      ? new Date(data.expiryDateGregorian)
      : null;
    let validityStatus = data.validityStatus || "UNKNOWN";

    if (expiryDateGregorian && data.documentType !== "PRELIMINARY") {
      const today = new Date();
      const diffTime = expiryDateGregorian - today;
      const daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (daysUntilExpiry < 0) validityStatus = "EXPIRED";
      else if (daysUntilExpiry <= 60) validityStatus = "EXPIRING_SOON";
      else validityStatus = "VALID";
    }

    const updatedRecord = await prisma.buildingCodeArchiveRecord.update({
      where: { id },
      data: {
        documentType: data.documentType,
        systemNo: data.systemNo,
        requestNo: data.requestNo,
        unifiedNo: data.unifiedNo,
        municipality: data.municipality,
        district: data.district,
        planNo: data.planNo,
        plotNo: data.plotNo,
        ownerName: data.ownerName,
        streetName: data.streetName,
        streetWidth: data.streetWidth ? parseFloat(data.streetWidth) : null,
        totalArea: data.totalArea ? parseFloat(data.totalArea) : null,

        zoningArea: data.zoningArea,
        usageText: data.usageText,
        maxFloors: data.maxFloors ? parseInt(data.maxFloors) : null,
        openHeight: data.openHeight === true || data.openHeight === "true",

        hasRoofAnnex: data.hasRoofAnnex,
        roofAnnexPercentage: data.roofAnnexPercentage
          ? parseFloat(data.roofAnnexPercentage)
          : null,
        farValue: data.farValue ? parseFloat(data.farValue) : null,
        buildingCoveragePercentage: data.buildingCoveragePercentage
          ? parseFloat(data.buildingCoveragePercentage)
          : null,

        specialNotesText: data.specialNotesText,

        approvalDateGregorian: data.approvalDateGregorian
          ? new Date(data.approvalDateGregorian)
          : null,
        expiryDateGregorian: expiryDateGregorian,
        validityStatus: validityStatus,
        status: "CONFIRMED", // عند التعديل اليدوي يعتبر مؤكداً

        lastUpdatedById: userId,
      },
    });

    await prisma.buildingCodeAuditLog.create({
      data: {
        buildingCodeId: id,
        action: "MANUAL_EDIT",
        userId,
        notes: "تم تعديل واعتماد البيانات يدوياً",
      },
    });

    res.json({
      success: true,
      message: "تم تحديث واعتماد بيانات نظام البناء",
      data: updatedRecord,
    });
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 6. دمج أنظمة البناء المكررة (التكرارات أو النسخ المجددة)
// ==========================================
const mergeBuildingCodes = async (req, res) => {
  try {
    const { duplicateId } = req.params;
    const userId = req.user?.id || "النظام";

    const duplicateRecord =
      await prisma.buildingCodeDuplicateCandidate.findUnique({
        where: { id: duplicateId },
      });
    if (!duplicateRecord)
      return res
        .status(404)
        .json({ success: false, message: "سجل التكرار غير موجود" });

    // أرشفة القديم (B) ونقل ارتباطاته إلى الجديد (A)
    await prisma.buildingCodeArchiveLink.updateMany({
      where: { buildingCodeId: duplicateRecord.recordBId },
      data: { buildingCodeId: duplicateRecord.recordAId },
    });

    await prisma.buildingCodeArchiveRecord.update({
      where: { id: duplicateRecord.recordBId },
      data: { isArchived: true, status: "MERGED_OLD_VERSION" },
    });

    await prisma.buildingCodeDuplicateCandidate.update({
      where: { id: duplicateId },
      data: {
        status: "MERGED",
        resolvedById: userId,
        resolvedAt: new Date(),
        resolutionAction: "تم دمج السجل القديم وأرشفته",
      },
    });

    res.json({
      success: true,
      message:
        "تم دمج الأنظمة المكررة بنجاح مع الاحتفاظ بالملفات القديمة مؤرشفة",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 7. حذف نظام بناء بشكل نهائي
// ==========================================
const deleteBuildingCode = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || "النظام";

    // التحقق من وجود السجل
    const record = await prisma.buildingCodeArchiveRecord.findUnique({
      where: { id },
    });
    if (!record) {
      return res
        .status(404)
        .json({ success: false, message: "السجل غير موجود." });
    }

    // حذف السجل نهائياً (قاعدة البيانات ستضمن عدم إعادة استخدام الـ serialNumber الخاص به)
    await prisma.buildingCodeArchiveRecord.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: "تم حذف نظام البناء من الأرشيف نهائياً.",
    });
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  uploadBuildingCode,
  getBuildingCodes,
  getRecordDuplicates,
  scanForDuplicates,
  deleteDuplicateRecord,
  getBuildingCodeById,
  updateBuildingCode,
  mergeBuildingCodes,
  deleteBuildingCode,
};

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

    // دعم الرفع المتعدد (Bulk Upload)
    for (const file of req.files) {
      const fileUrl = `/uploads/building-codes/${file.filename}`;

      // إنشاء السجل المبدئي ليكون متاحاً في الواجهة فوراً
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

      // تسجيل حركة الرفع في التدقيق
      await prisma.buildingCodeAuditLog.create({
        data: {
          buildingCodeId: newRecord.id,
          action: "UPLOAD",
          userId: userId,
          notes: "تم رفع الملف وبدء التحليل الآلي",
        },
      });

      // 💡 إطلاق المعالجة الذكية في الخلفية (Fire & Forget)
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
// 💡 2. دالة معالجة الذكاء الاصطناعي (تعمل بالخلفية)
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

    // الـ Prompt الضخم والشامل لجميع الحالات (الاستيكر، مفتوح، أرضي+أول، القطاعات)
    const prompt = `
      أنت مهندس تخطيط عمراني وأنظمة بناء خبير في السعودية وأمانة الرياض.
      استخرج كافة تفاصيل نظام البناء من المستند المرفق. قد يكون المستند حديثاً (إلكتروني)، أو قديماً (فيه استيكر أخضر)، أو أولياً.
      
      قواعد الاستخراج:
      1. عدد الأدوار (maxFloors): حول النصوص إلى أرقام. "أرضي + أول" = 2. "أرضي + دورين" = 3. 
      2. الارتفاع المفتوح: إذا ذكر "مفتوح" أو "لا يوجد حد"، اجعل openHeight = true و maxFloors = null.
      3. الملحق العلوي: إذا ذكر "ملاحق علوية" ولم يحدد نسبة، ضع roofAnnexPercentage = 50.
      4. القطاعات المتعددة: إذا كان النظام مقسماً (مثال: "القطعة الأمامية"، "باقي العمق")، اجعل hasMultipleZones = true وقم بتعبئة مصفوفة zones.
      5. التواريخ: استخرجها بدقة. إذا كان قديماً، ابحث في ختم الوارد أو الاستيكر الأخضر.

      استخرج البيانات بصيغة JSON فقط بهذا الهيكل تماماً:
      {
        "documentType": "APPROVED | PRELIMINARY | OLD_PAPER | REQUEST | SCREENSHOT | UNCLASSIFIED",
        "systemNo": "",
        "requestNo": "",
        "transactionNo": "",
        "unifiedNo": "الرقم الموحد من الاستيكر إن وجد",
        "versionNo": "",
        "issuingAuthority": "",
        "issuingDepartment": "",
        "municipality": "البلدية الفرعية",
        "district": "الحي",
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
        "zoningArea": "منطقة التقسيم مثل س111",
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
        "hasRoofAnnex": "YES | NO | UNKNOWN",
        "roofAnnexPercentage": 0.0,
        "roofAnnexBase": "LAST_FLOOR | FIRST_FLOOR | ROOF | UNKNOWN",
        "roofAnnexSetback": 0.0,
        "roofAnnexCountsInFar": "YES | NO | UNKNOWN",
        "farValue": 0.0,
        "buildingCoveragePercentage": 0.0,
        "parkingRequirementsText": "",
        "specialNotesText": "",
        "specialRestrictionsJson": ["أمثلة: منع فتحات", "موافقة هيئة"],
        "approvalDateGregorian": "YYYY-MM-DD",
        "approvalDateHijri": "YYYY-MM-DD",
        "approvalDateOriginalText": "",
        "approvalDateSource": "DOCUMENT_TEXT | GREEN_STICKER | MANUAL",
        "aiConfidenceOverall": 0.95,
        "hasMultipleZones": false,
        "zones": [
          {
            "zoneName": "القطعة الأمامية",
            "zoneDescription": "",
            "zoneDepth": 0.0,
            "zoneFacing": "",
            "usageText": "",
            "heightText": "",
            "maxFloors": 0,
            "buildingCoveragePercentage": 0.0,
            "farValue": 0.0,
            "setbacksText": "",
            "hasRoofAnnex": "YES",
            "roofAnnexPercentage": 50,
            "roofAnnexNotes": "",
            "parkingNotes": "",
            "specialNotes": ""
          }
        ]
      }
    `;

    const fallbackModels = [
      "gemini-3-flash-preview",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ];
    let response = null;

    for (const model of fallbackModels) {
      try {
        response = await ai.models.generateContent({
          model: model,
          contents: [prompt, documentPart],
          config: { temperature: 0.0, responseMimeType: "application/json" },
        });
        break;
      } catch (e) {
        console.warn(
          `فشل الموديل ${model} في تحليل نظام البناء، جاري المحاولة بآخر...`,
        );
        await new Promise((r) => setTimeout(r, 1000));
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

    // حساب التواريخ والصلاحية (سنة واحدة افتراضياً إذا وجدنا تاريخ اعتماد)
    let validityStatus = "UNKNOWN";
    let expiryDateGregorian = null;
    let daysUntilExpiry = null;
    let validityDays = 365; // الصلاحية الافتراضية

    if (aiData.documentType === "PRELIMINARY") {
      validityStatus = "PRELIMINARY";
    } else if (aiData.approvalDateGregorian) {
      const approvalDate = new Date(aiData.approvalDateGregorian);
      expiryDateGregorian = new Date(
        approvalDate.getTime() + validityDays * 24 * 60 * 60 * 1000,
      );

      const today = new Date();
      const diffTime = expiryDateGregorian - today;
      daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (daysUntilExpiry < 0) validityStatus = "EXPIRED";
      else if (daysUntilExpiry <= 60) validityStatus = "EXPIRING_SOON";
      else validityStatus = "VALID";
    }

    // التحقق من التكرار الدقيق (نفس المخطط والقطعة والحي)
    let finalStatus = "COMPLETED";
    if (aiData.planNo && aiData.plotNo && aiData.district) {
      const existing = await prisma.buildingCodeArchiveRecord.findFirst({
        where: {
          planNo: aiData.planNo,
          plotNo: aiData.plotNo,
          district: aiData.district,
          id: { not: recordId },
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

    const confidence = aiData.aiConfidenceOverall || 0.9;

    // تجهيز بيانات القطاعات إذا وجدت
    let zonesCreateInput = undefined;
    if (aiData.hasMultipleZones && aiData.zones && aiData.zones.length > 0) {
      zonesCreateInput = {
        create: aiData.zones.map((zone) => ({
          zoneName: zone.zoneName || "قطاع غير مسمى",
          zoneDescription: zone.zoneDescription,
          zoneDepth: zone.zoneDepth,
          zoneFacing: zone.zoneFacing,
          usageText: zone.usageText,
          heightText: zone.heightText,
          maxFloors: zone.maxFloors,
          buildingCoveragePercentage: zone.buildingCoveragePercentage,
          farValue: zone.farValue,
          setbacksText: zone.setbacksText,
          hasRoofAnnex: zone.hasRoofAnnex || "UNKNOWN",
          roofAnnexPercentage: zone.roofAnnexPercentage,
          roofAnnexNotes: zone.roofAnnexNotes,
          parkingNotes: zone.parkingNotes,
          specialNotes: zone.specialNotes,
          aiConfidence: confidence,
        })),
      };
    }

    // التحديث الضخم بكافة الحقول دون اختصار
    await prisma.buildingCodeArchiveRecord.update({
      where: { id: recordId },
      data: {
        documentType: aiData.documentType || "UNCLASSIFIED",
        systemNo: aiData.systemNo,
        requestNo: aiData.requestNo,
        transactionNo: aiData.transactionNo,
        unifiedNo: aiData.unifiedNo,
        versionNo: aiData.versionNo,
        issuingAuthority: aiData.issuingAuthority,
        issuingDepartment: aiData.issuingDepartment,
        municipality: aiData.municipality,
        district: aiData.district,
        planNo: aiData.planNo,
        plotNo: aiData.plotNo,
        blockNo: aiData.blockNo,
        deedNo: aiData.deedNo,
        surveyDecisionNo: aiData.surveyDecisionNo,
        ownerName: aiData.ownerName,
        officeName: aiData.officeName,
        streetName: aiData.streetName,
        streetWidth: aiData.streetWidth,
        totalArea: aiData.totalArea,
        projectLocationDescription: aiData.projectLocationDescription,
        zoningArea: aiData.zoningArea,
        planningRequirementsText: aiData.planningRequirementsText,
        usageText: aiData.usageText,
        setbacksText: aiData.setbacksText,
        frontSetback: aiData.frontSetback,
        sideSetback: aiData.sideSetback,
        rearSetback: aiData.rearSetback,
        mainStreetSetback: aiData.mainStreetSetback,
        sideStreetSetback: aiData.sideStreetSetback,
        neighborSetback: aiData.neighborSetback,
        heightText: aiData.heightText,
        maxFloors: aiData.maxFloors,
        openHeight: aiData.openHeight || false,
        hasRoofAnnex: aiData.hasRoofAnnex || "UNKNOWN",
        roofAnnexPercentage: aiData.roofAnnexPercentage,
        roofAnnexBase: aiData.roofAnnexBase,
        roofAnnexSetback: aiData.roofAnnexSetback,
        roofAnnexCountsInFar: aiData.roofAnnexCountsInFar || "UNKNOWN",
        farValue: aiData.farValue,
        buildingCoveragePercentage: aiData.buildingCoveragePercentage,
        parkingRequirementsText: aiData.parkingRequirementsText,
        specialNotesText: aiData.specialNotesText,
        specialRestrictionsJson: aiData.specialRestrictionsJson || [],

        approvalDateGregorian: aiData.approvalDateGregorian
          ? new Date(aiData.approvalDateGregorian)
          : null,
        approvalDateHijri: aiData.approvalDateHijri,
        approvalDateOriginalText: aiData.approvalDateOriginalText,
        approvalDateSource: aiData.approvalDateSource,

        validityDays: validityDays,
        expiryDateGregorian: expiryDateGregorian,

        status: confidence < 0.7 ? "NEEDS_REVIEW" : finalStatus,
        validityStatus: validityStatus,
        aiConfidenceOverall: confidence,
        aiExtractedJson: aiData,
        hasMultipleZones: aiData.hasMultipleZones || false,

        // إدراج القطاعات إن وجدت
        zones: zonesCreateInput,
      },
    });

    await prisma.buildingCodeAuditLog.create({
      data: {
        buildingCodeId: recordId,
        action: "AI_ANALYZE",
        userId,
        notes: "اكتمل تحليل الذكاء الاصطناعي بنجاح",
      },
    });
  } catch (error) {
    console.error(`AI Error for Building Code Record ${recordId}:`, error);
    await prisma.buildingCodeArchiveRecord.update({
      where: { id: recordId },
      data: { status: "NEEDS_REVIEW" },
    });
  }
};

// ==========================================
// 3. جلب جميع أنظمة البناء (لشاشة الجدول)
// ==========================================
const getBuildingCodes = async (req, res) => {
  try {
    const { search, documentType, status, validityStatus, district } =
      req.query;

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
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: records });
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

module.exports = {
  uploadBuildingCode,
  getBuildingCodes,
  getBuildingCodeById,
  updateBuildingCode,
  mergeBuildingCodes,
};

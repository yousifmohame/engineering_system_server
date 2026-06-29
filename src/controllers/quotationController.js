// src/controllers/quotationController.js
const prisma = require("../utils/prisma");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const https = require("https");
const fontsBase64 = require("../utils/fontsBase64");

// ==========================================
// 🚀 دالة مساعدة: توليد اسم ملف عرض السعر الديناميكي
// ==========================================
const generateQuotationFileName = (data) => {
  // 1. استخراج اسم المالك الأول والأخير
  const fullName =
    data.clientNameForPreview ||
    data.secondPartyName ||
    data.client?.name?.ar ||
    data.client?.name ||
    "عميل_غير_محدد";
  const nameParts = fullName.trim().split(" ");
  const firstAndLastName =
    nameParts.length > 1
      ? `${nameParts[0]} ${nameParts[nameParts.length - 1]}`
      : nameParts[0];

  // 2. استخراج اسم الحي
  const districtName =
    data.propertyDistrict || data.ownership?.district || "حي_غير_محدد";

  // 3. تاريخ اليوم ميلادي (YYYY-MM-DD)
  const today = new Date();
  const formattedDate = today.toISOString().split("T")[0];

  // 4. رقم النسخة (إذا لم تكن متوفرة نفترض أنها 1)
  const version = data.version || "1";

  // 5. تجميع الاسم النهائي
  const rawFileName = `عرض سعر_${firstAndLastName}_${districtName}_${formattedDate}_V${version}.pdf`;

  // 6. تنظيف الاسم من أي رموز قد تمنع نظام التشغيل من حفظ الملف واستبدال المسافات بشرطة سفلية (أفضل للروابط)
  return rawFileName.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, "_");
};
// ==========================================
// 🚀 دالة: الرفع المؤقت للملفات (ترد بالمسار المؤقت)
// ==========================================
const uploadTempAttachments = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم رفع أي ملف" });
    }

    const uploadedFiles = req.files.map((file) => {
      return {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: (file.size / 1024 / 1024).toFixed(2),
        tempPath: `/uploads/temp/${file.filename}`, // المسار الذي حفظه Multer
      };
    });

    res.status(200).json({ success: true, data: uploadedFiles });
  } catch (error) {
    console.error("Temp Upload Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل رفع الملفات المؤقتة" });
  }
};

// ==========================================
// 🚀 دالة: معالجة ونقل المرفقات (من Temp إلى النهائي)
// ==========================================
const processAndSaveAttachments = (attachments, userId) => {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0)
    return [];

  const finalDir = path.join(__dirname, "../../uploads/quotations/attachments");
  if (!fs.existsSync(finalDir)) {
    fs.mkdirSync(finalDir, { recursive: true });
  }

  const processedFiles = [];

  for (const att of attachments) {
    // 1. إذا كان الملف قديماً وموجوداً مسبقاً (يمتلك filePath وليس له tempPath) نتخطاه
    if (att.filePath && !att.tempPath) continue;

    // 2. إذا كان الملف مرفوعاً للتو في الـ Temp
    if (att.tempPath) {
      const sourcePath = path.join(__dirname, "../../", att.tempPath);
      const extension = att.name.includes(".")
        ? att.name.split(".").pop()
        : "bin";
      const finalFileName = `ATT_${Date.now()}_${Math.round(Math.random() * 1000)}.${extension}`;
      const destPath = path.join(finalDir, finalFileName);

      try {
        if (fs.existsSync(sourcePath)) {
          // نقل الملف من المسار المؤقت إلى المسار النهائي بسرعة فائقة
          fs.renameSync(sourcePath, destPath);

          processedFiles.push({
            fileName: att.name,
            filePath: `/uploads/quotations/attachments/${finalFileName}`,
            fileType: att.type || "application/octet-stream",
            fileSize: att.size ? parseFloat(att.size) * 1024 * 1024 : 0, // تحويل الميجا إلى بايت
            notes: att.description || null,
            uploadedById: userId,
          });
        }
      } catch (err) {
        console.error(`Error moving temp file ${att.name}:`, err);
      }
    }
    // 3. (Fallback) احتياطي: لو تم تمرير Base64 بالخطأ بدلاً من الـ tempPath
    else if (att.fileData && att.fileData.startsWith("data:")) {
      const matches = att.fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const buffer = Buffer.from(matches[2], "base64");
        const extension = att.name.split(".").pop();
        const finalFileName = `ATT_B64_${Date.now()}_${Math.round(Math.random() * 1000)}.${extension}`;
        const destPath = path.join(finalDir, finalFileName);
        fs.writeFileSync(destPath, buffer);
        processedFiles.push({
          fileName: att.name,
          filePath: `/uploads/quotations/attachments/${finalFileName}`,
          fileType: matches[1],
          fileSize: buffer.length,
          notes: att.description || null,
          uploadedById: userId,
        });
      }
    }
  }

  return processedFiles;
};
// ==========================================
// دالة مساعدة: توليد رقم عرض السعر (QT-YY-MM-####)
// ==========================================
const generateQuotationNumber = async () => {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const prefix = `QT-${year}-${month}-`;

  const lastQuotation = await prisma.quotation.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
  });

  let nextSeq = 1;
  if (lastQuotation) {
    const lastSeq = parseInt(lastQuotation.number.split("-").pop(), 10);
    nextSeq = lastSeq + 1;
  }
  return `${prefix}${nextSeq.toString().padStart(4, "0")}`;
};

// دالة مساعدة لتوليد بيانات أمنية (الباركود والـ QR)
const generateSecurityData = (quoteNumber) => {
  const randomStr = crypto.randomBytes(3).toString("hex").toUpperCase();
  const barcodeData = `815-${quoteNumber}-${randomStr}`;
  // هذا الرابط سيتوجه إلى شاشة في نظامك للتحقق من صحة العرض
  const qrVerificationUrl = `${process.env.FRONTEND_URL}/verify/quote/${barcodeData}`;
  return { barcodeData, qrVerificationUrl };
};

const isValidId = (val) => {
  // معرفات Prisma (CUID/UUID) لا تحتوي على مسافات وطولها 20 حرفاً على الأقل
  return typeof val === "string" && val.length >= 20 && !val.includes(" ");
};

// ===============================================
// 1. إنشاء عرض سعر جديد
// ===============================================
const createQuotation = async (req, res) => {
  try {
    const data = req.body;

    const issueDate = new Date(data.issueDate || new Date());
    const expiryDate = new Date(issueDate);
    expiryDate.setDate(
      expiryDate.getDate() + (parseInt(data.validityDays) || 30),
    );

    const quotationNumber = await generateQuotationNumber();

    let calcSubtotal = 0;
    let calcTaxAmount = 0;

    const itemsToCreate = (data.items || []).map((item, index) => {
      const lineTotal = parseFloat(item.qty) * parseFloat(item.price);
      let lineDiscount =
        item.discountType === "PERCENTAGE"
          ? lineTotal * (parseFloat(item.discount) / 100)
          : parseFloat(item.discount) || 0;

      const subtotal = Math.max(0, lineTotal - lineDiscount);
      calcSubtotal += subtotal;

      const itemTaxRate =
        item.taxRate !== undefined ? parseFloat(item.taxRate) / 100 : 0.15;
      const itemTaxAmount = subtotal * itemTaxRate;
      calcTaxAmount += itemTaxAmount;

      return {
        order: index + 1,
        title: item.title,
        description: item.description,
        quantity: parseFloat(item.qty),
        unit: item.unit,
        unitPrice: parseFloat(item.price),
        discount: parseFloat(item.discount) || 0,
        discountType: item.discountType || "PERCENTAGE",
        subtotal: subtotal,
        taxRate: itemTaxRate,
        taxAmount: itemTaxAmount,
        executionDuration: item.executionDuration
          ? parseInt(item.executionDuration)
          : null,
        durationUnit: item.durationUnit || null,
        timelineNotes: item.timelineNotes || null,
        showInTimeline:
          item.showInTimeline !== undefined ? item.showInTimeline : true,
      };
    });

    const calcTotal = calcSubtotal + calcTaxAmount;
    const globalTaxRateFloat = parseFloat(data.taxRate || 15) / 100;

    let securityData = {};
    const stampType = data.stampType || "NONE";
    if (stampType === "SECURE_QR") {
      securityData = generateSecurityData(quotationNumber);
      securityData.securityHash = crypto
        .createHash("sha256")
        .update(`${quotationNumber}-${calcTotal}`)
        .digest("hex");
    }

    // 🛡️ حماية الـ ID (يمنع الـ Crash)
    let validTransactionTypeId = undefined;
    if (isValidId(data.transactionTypeId)) {
      const existingType = await prisma.transactionType.findUnique({
        where: { id: data.transactionTypeId },
      });
      if (existingType) validTransactionTypeId = existingType.id;
    }

    const attachmentsToCreate = processAndSaveAttachments(
      data.ownerAttachments,
      req.user?.id,
    );

    const newQuotation = await prisma.$transaction(async (tx) => {
      const createdQuote = await tx.quotation.create({
        data: {
          number: quotationNumber,
          subject: data.subject || null,
          address: data.address || null,
          bgType: data.bgType || "official1",
          fontFamily: data.fontFamily || "Tajawal",

          client: data.clientId
            ? { connect: { id: data.clientId } }
            : undefined,
          ownership: data.propertyId
            ? { connect: { id: data.propertyId } }
            : undefined,
          transaction: data.transactionId
            ? { connect: { id: data.transactionId } }
            : undefined,
          meetingMinute: data.meetingId
            ? { connect: { id: data.meetingId } }
            : undefined,

          transactionType: validTransactionTypeId
            ? { connect: { id: validTransactionTypeId } }
            : undefined,
          documentTitle: data.documentTitle || data.documentType,
          transactionTypeName:
            data.transactionTypeName ||
            data.transactionTypeId ||
            "خدمات هندسية",

          issueDate,
          validityDays: parseInt(data.validityDays) || 30,
          expiryDate,
          templateType: data.templateType || "SUMMARY",
          templateId: data.templateId || null,
          showClientCode: data.showClientCode ?? true,
          showPropertyCode: data.showPropertyCode ?? true,

          showSummaryTable: data.showSummaryTable ?? true,
          secondPartyName: data.secondPartyName || null,
          secondPartyRep: data.secondPartyRep || null,
          firstPartyRep: data.firstPartyRep || null,

          authDocDate: data.authDocDate ? new Date(data.authDocDate) : null,
          authDocIssueDate: data.authDocIssueDate
            ? new Date(data.authDocIssueDate)
            : null,
          showAuthDocIssueDate: data.showAuthDocIssueDate || false,
          authDocExpiryDate: data.authDocExpiryDate
            ? new Date(data.authDocExpiryDate)
            : null,
          showAuthDocExpiryDate: data.showAuthDocExpiryDate || false,

          firstPartyEmployee: isValidId(data.firstPartyEmployeeId)
            ? { connect: { id: data.firstPartyEmployeeId } }
            : undefined,
          firstPartyRepCapacity: data.firstPartyRepCapacity,
          showFirstPartyEmpId: data.showFirstPartyEmpId ?? true,
          firstPartySignatureType: data.firstPartySignatureType || "MANUAL",

          serviceNumber: data.serviceNumber || null,
          serviceYear: data.serviceYear || null,
          licenseNumber: data.licenseNumber || null,
          licenseYear: data.licenseYear || null,

          subtotal: calcSubtotal,
          taxRate: globalTaxRateFloat,
          officeTaxBearing: parseInt(data.officeTaxBearing) || 0,
          taxAmount: calcTaxAmount,
          total: calcTotal,

          showTimeline: data.showTimeline ?? true,
          totalDuration: parseInt(data.totalDuration) || 20,
          durationUnit: data.durationUnit || "WORKING_DAY",
          startConditions: data.startConditions
            ? JSON.stringify(data.startConditions)
            : '["DOCUMENTS_RECEIVED"]',
          customStartDate: data.customStartDate
            ? new Date(data.customStartDate)
            : null,
          showEndDate: data.showEndDate ?? false,
          showTimelineNotes: data.showTimelineNotes ?? true,
          timelineNotes: data.timelineNotes || null,

          missingDocs: data.missingDocs,
          showMissingDocs: data.showMissingDocs || false,
          terms: data.terms,
          conclusion: data.conclusion,

          clientTitle: data.clientTitle || "MR",
          handlingMethod: data.handlingMethod || "DIRECT",
          acceptedMethods: data.acceptedMethods || ["bank"],
          selectedBankAccounts: data.selectedBankAccounts || [],

          clientType: data.clientType || "فرد",
          signatureMethod: data.signatureMethod || "SELF",
          repName: data.repName || null,
          repIdNumber: data.repIdNumber || null,
          repPhone: data.repPhone || null,
          repCapacity: data.repCapacity || null,
          authDocType: data.authDocType || null,
          authDocNumber: data.authDocNumber || null,
          customUsufructType: data.customUsufructType || null,

          stampType: stampType,
          barcodeData: securityData.barcodeData,
          qrVerificationUrl: securityData.qrVerificationUrl,
          securityHash: securityData.securityHash,
          isStamped: stampType === "SECURE_QR",
          stampedAt: stampType === "SECURE_QR" ? new Date() : null,

          status: data.isDraft
            ? "DRAFT"
            : stampType === "SECURE_QR"
              ? "APPROVED"
              : "PENDING_APPROVAL",
          creator: req.user?.id ? { connect: { id: req.user.id } } : undefined,

          items: { create: itemsToCreate },
          payments: {
            create: (data.payments || []).map((p, idx) => ({
              installmentNumber: idx + 1,
              percentage: parseFloat(p.percentage),
              amount: parseFloat(p.amount),
              dueCondition: p.condition || "حسب الاتفاق",
            })),
          },
          attachments: { create: attachmentsToCreate },
        },
      });

      await tx.quotationLog.create({
        data: {
          quotationId: createdQuote.id,
          action: "CREATE",
          toStatus: createdQuote.status,
          userId: req.user?.id || "SYSTEM",
          userName: req.user?.name || "نظام الإنشاء الآلي",
          notes: "تم إنشاء مسودة عرض السعر الأولي",
        },
      });
      return createdQuote;
    });

    res.status(201).json({ success: true, data: newQuotation });
  } catch (error) {
    console.error("Create Quotation Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل حفظ عرض السعر",
      error: error.message,
    });
  }
};

// ===============================================
// 2. تحديث عرض سعر (مصحح ضد خطأ P2025)
// ===============================================
const updateQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existingQuote = await prisma.quotation.findUnique({ where: { id } });
    if (!existingQuote)
      return res
        .status(404)
        .json({ success: false, message: "عرض السعر غير موجود" });

    const isLockedStatus = [
      "APPROVED",
      "SENT",
      "ACCEPTED",
      "PARTIALLY_PAID",
    ].includes(existingQuote.status);
    let statusToSave = data.status || existingQuote.status;
    let resetSecurityData = {};
    let isPostApprovalEdit = false;

    if (isLockedStatus) {
      if (data.editReason) {
        isPostApprovalEdit = true;
        statusToSave = data.isDraft ? "DRAFT" : "PENDING_APPROVAL";
        resetSecurityData = {
          isStamped: false,
          stampedAt: null,
          stampedBy: null,
          qrVerificationUrl: null,
          barcodeData: null,
          securityHash: null,
          pdfUrl: null,
        };
      } else if (data.items || data.payments) {
        return res.status(400).json({
          success: false,
          message: "هذا العرض معتمد. لتعديله، يرجى تقديم سبب التعديل.",
        });
      }
    }

    let issueDate = data.issueDate
      ? new Date(data.issueDate)
      : existingQuote.issueDate;
    let validityDays = data.validityDays
      ? parseInt(data.validityDays)
      : existingQuote.validityDays;
    let expiryDate = new Date(issueDate);
    expiryDate.setDate(expiryDate.getDate() + validityDays);

    const baseUpdateData = {
      ...resetSecurityData,
      status: statusToSave,
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.subject !== undefined && { subject: data.subject }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.bgType && { bgType: data.bgType }),
      ...(data.fontFamily && { fontFamily: data.fontFamily }),
      ...(data.terms !== undefined && { terms: data.terms }),
      ...(data.conclusion !== undefined && { conclusion: data.conclusion }),
      ...(data.templateType && { templateType: data.templateType }),
      ...(data.templateId !== undefined && { templateId: data.templateId }),
      ...(data.showClientCode !== undefined && {
        showClientCode: data.showClientCode,
      }),
      ...(data.showPropertyCode !== undefined && {
        showPropertyCode: data.showPropertyCode,
      }),
      ...(data.showSummaryTable !== undefined && {
        showSummaryTable: data.showSummaryTable,
      }),
      ...(data.secondPartyName !== undefined && {
        secondPartyName: data.secondPartyName,
      }),
      ...(data.secondPartyRep !== undefined && {
        secondPartyRep: data.secondPartyRep,
      }),
      ...(data.firstPartyRep !== undefined && {
        firstPartyRep: data.firstPartyRep,
      }),
      ...(data.documentTitle !== undefined && {
        documentTitle: data.documentTitle,
      }),
      ...(data.transactionTypeName !== undefined && {
        transactionTypeName: data.transactionTypeName,
      }),

      ...(data.serviceNumber !== undefined && {
        serviceNumber: data.serviceNumber,
      }),
      ...(data.serviceYear !== undefined && { serviceYear: data.serviceYear }),
      ...(data.licenseNumber !== undefined && {
        licenseNumber: data.licenseNumber,
      }),
      ...(data.licenseYear !== undefined && { licenseYear: data.licenseYear }),
      ...(data.missingDocs !== undefined && { missingDocs: data.missingDocs }),
      ...(data.showMissingDocs !== undefined && {
        showMissingDocs: data.showMissingDocs,
      }),
      ...(data.clientTitle && { clientTitle: data.clientTitle }),
      ...(data.handlingMethod && { handlingMethod: data.handlingMethod }),
      ...(data.acceptedMethods && { acceptedMethods: data.acceptedMethods }),
      ...(data.selectedBankAccounts && {
        selectedBankAccounts: data.selectedBankAccounts,
      }),
      ...(data.officeTaxBearing !== undefined && {
        officeTaxBearing: parseInt(data.officeTaxBearing),
      }),
      issueDate,
      validityDays,
      expiryDate,

      ...(data.clientType !== undefined && { clientType: data.clientType }),
      ...(data.signatureMethod !== undefined && {
        signatureMethod: data.signatureMethod,
      }),
      ...(data.repName !== undefined && { repName: data.repName }),
      ...(data.repIdNumber !== undefined && { repIdNumber: data.repIdNumber }),
      ...(data.repPhone !== undefined && { repPhone: data.repPhone }),
      ...(data.repCapacity !== undefined && { repCapacity: data.repCapacity }),
      ...(data.authDocType !== undefined && { authDocType: data.authDocType }),
      ...(data.authDocNumber !== undefined && {
        authDocNumber: data.authDocNumber,
      }),
      ...(data.authDocDate !== undefined && {
        authDocDate: data.authDocDate ? new Date(data.authDocDate) : null,
      }),
      ...(data.authDocIssueDate !== undefined && {
        authDocIssueDate: data.authDocIssueDate
          ? new Date(data.authDocIssueDate)
          : null,
      }),
      ...(data.showAuthDocIssueDate !== undefined && {
        showAuthDocIssueDate: data.showAuthDocIssueDate,
      }),
      ...(data.authDocExpiryDate !== undefined && {
        authDocExpiryDate: data.authDocExpiryDate
          ? new Date(data.authDocExpiryDate)
          : null,
      }),
      ...(data.showAuthDocExpiryDate !== undefined && {
        showAuthDocExpiryDate: data.showAuthDocExpiryDate,
      }),
      ...(data.customUsufructType !== undefined && {
        customUsufructType: data.customUsufructType,
      }),

      ...(data.showTimeline !== undefined && {
        showTimeline: data.showTimeline,
      }),
      ...(data.totalDuration !== undefined && {
        totalDuration: parseInt(data.totalDuration),
      }),
      ...(data.durationUnit !== undefined && {
        durationUnit: data.durationUnit,
      }),
      ...(data.startConditions !== undefined && {
        startConditions: JSON.stringify(data.startConditions),
      }),
      ...(data.customStartDate !== undefined && {
        customStartDate: data.customStartDate
          ? new Date(data.customStartDate)
          : null,
      }),
      ...(data.showEndDate !== undefined && { showEndDate: data.showEndDate }),
      ...(data.showTimelineNotes !== undefined && {
        showTimelineNotes: data.showTimelineNotes,
      }),
      ...(data.timelineNotes !== undefined && {
        timelineNotes: data.timelineNotes,
      }),

      firstPartyRepCapacity:
        data.firstPartyRepCapacity !== undefined
          ? data.firstPartyRepCapacity
          : existingQuote.firstPartyRepCapacity,
      showFirstPartyEmpId:
        data.showFirstPartyEmpId ?? existingQuote.showFirstPartyEmpId,
      firstPartySignatureType:
        data.firstPartySignatureType || existingQuote.firstPartySignatureType,
    };

    // 🛡️ الحماية القوية ضد خطأ Prisma (P2025)
    if (isValidId(data.transactionTypeId)) {
      try {
        const existingTx = await prisma.transactionType.findUnique({
          where: { id: data.transactionTypeId },
        });
        if (existingTx)
          baseUpdateData.transactionType = {
            connect: { id: data.transactionTypeId },
          };
      } catch (e) {}
    }

    if (isValidId(data.firstPartyEmployeeId)) {
      try {
        const existingEmp = await prisma.employee.findUnique({
          where: { id: data.firstPartyEmployeeId },
        });
        if (existingEmp)
          baseUpdateData.firstPartyEmployee = {
            connect: { id: data.firstPartyEmployeeId },
          };
        else baseUpdateData.firstPartyEmployee = { disconnect: true };
      } catch (e) {}
    } else if (
      data.firstPartyEmployeeId === null ||
      data.firstPartyEmployeeId === ""
    ) {
      baseUpdateData.firstPartyEmployee = { disconnect: true };
    }

    if (data.clientId)
      baseUpdateData.client = { connect: { id: data.clientId } };
    if (data.propertyId)
      baseUpdateData.ownership = { connect: { id: data.propertyId } };
    if (data.transactionId)
      baseUpdateData.transaction = { connect: { id: data.transactionId } };
    if (data.meetingId)
      baseUpdateData.meetingMinute = { connect: { id: data.meetingId } };

    const newAttachmentsToCreate = processAndSaveAttachments(
      data.ownerAttachments,
      req.user?.id,
    );

    const updatedQuotation = await prisma.$transaction(async (tx) => {
      let calcSubtotal = existingQuote.subtotal;
      let calcTaxAmount = existingQuote.taxAmount;
      let calcTotal = existingQuote.total;
      let globalTaxRateFloat =
        data.taxRate !== undefined
          ? parseFloat(data.taxRate) / 100
          : existingQuote.taxRate;

      if (data.items) {
        await tx.quotationItem.deleteMany({ where: { quotationId: id } });
        calcSubtotal = 0;
        calcTaxAmount = 0;

        const itemsToCreate = data.items.map((item, index) => {
          const lineTotal = parseFloat(item.qty) * parseFloat(item.price);
          let lineDiscount =
            item.discountType === "PERCENTAGE"
              ? lineTotal * (parseFloat(item.discount) / 100)
              : parseFloat(item.discount) || 0;
          const subtotal = Math.max(0, lineTotal - lineDiscount);
          calcSubtotal += subtotal;

          const itemTaxRate =
            item.taxRate !== undefined ? parseFloat(item.taxRate) / 100 : 0.15;
          const itemTaxAmount = subtotal * itemTaxRate;
          calcTaxAmount += itemTaxAmount;

          return {
            quotationId: id,
            order: index + 1,
            title: item.title,
            description: item.description || null,
            category: item.category || "عام",
            quantity: parseFloat(item.qty),
            unit: item.unit || "خدمة",
            unitPrice: parseFloat(item.price),
            discount: parseFloat(item.discount) || 0,
            discountType: item.discountType || "PERCENTAGE",
            subtotal: subtotal,
            taxRate: itemTaxRate,
            taxAmount: itemTaxAmount,
            executionDuration: item.executionDuration
              ? parseInt(item.executionDuration)
              : null,
            durationUnit: item.durationUnit || null,
            timelineNotes: item.timelineNotes || null,
            showInTimeline:
              item.showInTimeline !== undefined ? item.showInTimeline : true,
          };
        });

        calcTotal = calcSubtotal + calcTaxAmount;
        if (itemsToCreate.length > 0)
          await tx.quotationItem.createMany({ data: itemsToCreate });
      }

      if (data.payments) {
        await tx.quotationPayment.deleteMany({ where: { quotationId: id } });
        const paymentsToCreate = data.payments.map((p, idx) => ({
          quotationId: id,
          installmentNumber: idx + 1,
          percentage: parseFloat(p.percentage),
          amount: parseFloat(p.amount),
          dueCondition: p.condition || "حسب الاتفاق",
        }));
        if (paymentsToCreate.length > 0)
          await tx.quotationPayment.createMany({ data: paymentsToCreate });
      }

      if (newAttachmentsToCreate && newAttachmentsToCreate.length > 0) {
        await tx.attachment.createMany({
          data: newAttachmentsToCreate.map((att) => ({
            ...att,
            quotationId: id,
          })),
        });
      }

      const result = await tx.quotation.update({
        where: { id },
        data: {
          ...baseUpdateData,
          subtotal: calcSubtotal,
          taxRate: globalTaxRateFloat,
          taxAmount: calcTaxAmount,
          total: calcTotal,
        },
        include: {
          items: { orderBy: { order: "asc" } },
          payments: { orderBy: { installmentNumber: "asc" } },
          client: { select: { name: true, clientCode: true } },
          ownership: { select: { code: true } },
        },
      });

      await tx.quotationLog.create({
        data: {
          quotationId: id,
          action: isPostApprovalEdit ? "POST_APPROVAL_EDIT" : "UPDATE",
          fromStatus: existingQuote.status,
          toStatus: statusToSave,
          userId: req.user?.id || "SYSTEM",
          userName: req.user?.name || "النظام",
          notes: isPostApprovalEdit
            ? `تم التعديل. السبب: ${data.editReason}`
            : "تحديث بيانات العرض",
        },
      });
      return result;
    });

    res.status(200).json({
      success: true,
      message: "تم التحديث بنجاح",
      data: updatedQuotation,
    });
  } catch (error) {
    console.error("Update Quotation Error:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء التحديث",
      error: error.message,
    });
  }
};

// ===============================================
// 2. جلب جميع عروض الأسعار (بدون المحذوفة)
// GET /api/quotations
// ===============================================
const getAllQuotations = async (req, res) => {
  try {
    const quotations = await prisma.quotation.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true, clientCode: true } },
        ownership: { select: { code: true, district: true } },
      },
    });
    res.status(200).json({ success: true, data: quotations });
  } catch (error) {
    console.error("Get Quotations Error:", error);
    res.status(500).json({ success: false, message: "خطأ في جلب العروض" });
  }
};

// ===============================================
// 3. جلب بيانات عرض سعر واحد (بكامل تفاصيله)
// GET /api/quotations/:id
// ===============================================
const getQuotationById = async (req, res) => {
  try {
    const { id } = req.params;
    const quotation = await prisma.quotation.findUnique({
      where: { id: id },
      include: {
        client: true,
        ownership: true,
        transaction: true,
        meetingMinute: true,
        items: { orderBy: { order: "asc" } },
        payments: { orderBy: { installmentNumber: "asc" } },
        contract: true,
        attachments: true, // 👈👈 أضف هذا السطر المفقود
        // 👇 إضافة جلب السجل التاريخي بترتيب تنازلي
        logs: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: { name: true } } }, // جلب اسم الموظف من العلاقة
        },
      },
    });

    if (!quotation) {
      return res
        .status(404)
        .json({ success: false, message: "عرض السعر غير موجود" });
    }
    res.status(200).json({ success: true, data: quotation });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "خطأ في جلب تفاصيل العرض" });
  }
};

// ===============================================
// 5. حذف عرض سعر (نقل لسلة المحذوفات - Soft Delete)
// DELETE /api/quotations/:id
// ===============================================
const deleteQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userName = req.user?.name || "مستخدم النظام";

    const trashedQuotation = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findUnique({ where: { id } });
      if (!quotation) throw new Error("NOT_FOUND");
      if (quotation.status === "TRASHED") throw new Error("ALREADY_TRASHED");

      const updated = await tx.quotation.update({
        where: { id },
        data: { status: "TRASHED" },
      });

      // توثيق عملية النقل للسلة
      await tx.quotationLog.create({
        data: {
          quotationId: id,
          action: "TRASH",
          fromStatus: quotation.status,
          toStatus: "TRASHED",
          userId: userId,
          userName: userName,
          notes: "تم نقل عرض السعر إلى سلة المحذوفات",
        },
      });

      return updated;
    });

    res.status(200).json({
      success: true,
      message: "تم نقل عرض السعر إلى سلة المحذوفات بنجاح",
      data: trashedQuotation,
    });
  } catch (error) {
    if (error.message === "NOT_FOUND")
      return res
        .status(404)
        .json({ success: false, message: "عرض السعر غير موجود" });
    if (error.message === "ALREADY_TRASHED")
      return res
        .status(400)
        .json({ success: false, message: "العرض موجود مسبقاً في السلة" });
    res.status(500).json({ success: false, message: "خطأ في حذف العرض" });
  }
};

// في quotationController.js
const hardDeleteQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    // الحذف النهائي من الداتابيز
    await prisma.quotation.delete({ where: { id } });
    res.json({ success: true, message: "تم الحذف النهائي" });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل الحذف النهائي" });
  }
};

// ===============================================
// استرجاع العرض من سلة المحذوفات (Restore)
// ===============================================
const restoreFromTrash = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userName = req.user?.name || "مستخدم النظام";

    await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findUnique({
        where: { id },
        include: { logs: { orderBy: { createdAt: "desc" }, take: 2 } },
      });

      if (!quotation || quotation.status !== "TRASHED") {
        throw new Error("هذا العرض ليس في سلة المحذوفات");
      }

      // 💡 البحث عن الحالة السابقة قبل الحذف، وإن لم توجد يعود كمسودة
      const previousStatus =
        quotation.logs.find((log) => log.toStatus === "TRASHED")?.fromStatus ||
        "DRAFT";

      await tx.quotation.update({
        where: { id },
        data: { status: previousStatus },
      });

      await tx.quotationLog.create({
        data: {
          quotationId: id,
          action: "RESTORE",
          fromStatus: "TRASHED",
          toStatus: previousStatus,
          userId: userId,
          userName: userName,
          notes: "تم استرجاع عرض السعر من سلة المحذوفات",
        },
      });
    });

    res.json({
      success: true,
      message: "تم استرجاع العرض بنجاح للحالة السابقة",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ===============================================
// دورة الاعتماد: 1. تقديم العرض للمراجعة
// ===============================================
const submitForApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userName = req.user?.name || "مستخدم النظام";

    await prisma.$transaction(async (tx) => {
      const quote = await tx.quotation.findUnique({ where: { id } });
      if (
        !quote ||
        (quote.status !== "DRAFT" && quote.status !== "NEEDS_MODIFICATION")
      ) {
        throw new Error("يمكن إرسال المسودات أو العروض المعادة للتعديل فقط");
      }

      await tx.quotation.update({
        where: { id },
        data: { status: "PENDING_APPROVAL" },
      });

      await tx.quotationLog.create({
        data: {
          quotationId: id,
          action: "SUBMIT",
          fromStatus: quote.status,
          toStatus: "PENDING_APPROVAL",
          userId,
          userName,
          notes: "تم تقديم العرض للمشرف للمراجعة والاعتماد",
        },
      });
    });
    res.json({ success: true, message: "تم إرسال العرض بنجاح للمراجعة" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ===============================================
// دورة الاعتماد: 2. طلب تعديل من الموظف
// ===============================================
const requestModification = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const userId = req.user?.id;
    const userName = req.user?.name || "المشرف";

    if (!notes) throw new Error("يجب إرفاق ملاحظات التعديل");

    await prisma.$transaction(async (tx) => {
      const quote = await tx.quotation.findUnique({ where: { id } });
      if (!quote || quote.status !== "PENDING_APPROVAL")
        throw new Error("العرض ليس قيد المراجعة");

      await tx.quotation.update({
        where: { id },
        data: { status: "NEEDS_MODIFICATION" },
      });

      await tx.quotationLog.create({
        data: {
          quotationId: id,
          action: "REQUEST_MODIFICATION",
          fromStatus: quote.status,
          toStatus: "NEEDS_MODIFICATION",
          userId,
          userName,
          notes,
        },
      });
    });
    res.json({ success: true, message: "تم إعادة العرض للموظف للتعديل" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ===============================================
// دورة الاعتماد: 3. رفض العرض نهائياً
// ===============================================
const rejectQuotationWorkflow = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.user?.id;
    const userName = req.user?.name || "المشرف";

    if (!reason) throw new Error("يجب كتابة سبب الرفض");

    await prisma.$transaction(async (tx) => {
      const quote = await tx.quotation.findUnique({ where: { id } });
      if (!quote || quote.status !== "PENDING_APPROVAL")
        throw new Error("العرض ليس قيد المراجعة");

      await tx.quotation.update({
        where: { id },
        data: { status: "REJECTED" },
      });

      await tx.quotationLog.create({
        data: {
          quotationId: id,
          action: "REJECT",
          fromStatus: quote.status,
          toStatus: "REJECTED",
          userId,
          userName,
          notes: reason,
        },
      });
    });
    res.json({ success: true, message: "تم رفض العرض نهائياً" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// دوال مساعدة لترجمة الثوابت من قاعدة البيانات
// ==========================================
const mapTitleToArabic = (title) => {
  const titles = {
    MR: "المكرم",
    MRS: "المكرمة",
    SIR_COMPANY: "السادة شركة",
    SIR_ENTITY: "السادة جهة",
    SIR_WAQF: "المكرم ناظر وقف",
    PRINCE: "صاحب السمو الأمير",
    PRINCESS: "صاحبة السمو الأميرة",
    ROYAL_PRINCE: "صاحب السمو الملكي الأمير",
    ROYAL_PRINCESS: "صاحبة السمو الملكي الأميرة",
    CUSTOM: "المكرم",
  };
  return titles[title] || "المكرم";
};

const mapHandlingMethod = (method) => {
  const methods = {
    DIRECT: "المالك مباشرة",
    AUTHORIZED: "مفوض نظامي",
    AGENT: "وكيل شرعي",
  };
  return methods[method] || "المالك مباشرة";
};

// ============================================================================
// 🌟 دالة توليد قالب HTML لعروض الأسعار (مصححة لإظهار QR الوثيقة) 🌟
// ============================================================================
// src/controllers/quotationController.js
const buildQuotationHtmlTemplate = (
  data,
  verificationQrImage = "",
  userName = "النظام",
) => {
  const {
    transactionType,
    licenseNumber,
    licenseYear,
    serviceNumber,
    serviceYear,
    subject,
    address,
    clientTitle,
    clientNameForPreview,
    clientCodeForPreview,
    validityDays,
    propertyCodeForPreview,
    termsText,
    conclusion,
    items = [],
    subtotal = 0,
    taxAmount = 0,
    grandTotal = 0,
    officeTaxBearing = 0,
    paymentsList = [],
    showQuantity = false,
    plots = [],
    deedNumber,
    deedDate,
    clientType = "فرد",
    signatureMethod = "SELF",
    repName,
    repIdNumber,
    repPhone,
    repCapacity,
    authDocType,
    authDocNumber,
    handlingMethod = "المالك مباشرة",
    firstPartyName,
    firstPartyRep,
    secondPartyName,
    selectedBankAccounts = [],
    bankAccountsData = [],
    propertyDistrict = "---",
    propertyPlanNumber = "---",
    status = "DRAFT",
    transactionRefForPreview,
    meetingTitleForPreview,
    firstPartyRepCapacity = "إدارة المشاريع وعقود العملاء",
    firstPartyEmpCode,
    showFirstPartyEmpId = true,
    firstPartySignatureType = "MANUAL",
    employeeSignatureUrl,
    bgType = "official1",
    authDocIssueDate,
    showAuthDocIssueDate,
    authDocExpiryDate,
    showAuthDocExpiryDate,
    customUsufructType,
    documentType,
    missingDocs = "",
    showMissingDocs = false,
    taxRate = 15,
    issueDate,
    timelineState,
    fontFamily = "Tajawal", // 🌟 قراءة الخط الممرر
    showSummaryTable = true,
  } = data;

  const getLocalImageAsBase64 = (imagePath) => {
    if (!imagePath) return "";

    // 1. إذا كانت الصورة محفوظة كـ Base64 مسبقاً في قاعدة البيانات
    if (imagePath.startsWith("data:image")) {
      return imagePath;
    }

    try {
      let cleanPath = imagePath;

      // 2. إذا كانت مسجلة كرابط كامل (http://...) نستخرج المسار المحلي فقط
      if (imagePath.startsWith("http")) {
        const urlObj = new URL(imagePath);
        cleanPath = urlObj.pathname; // النتيجة: /uploads/clients/logo.png
      }

      // 3. تنظيف المسار من /api (إن وجدت) والشرطة المائلة في البداية
      cleanPath = cleanPath.replace("/api", "").replace(/^\/+/, "");

      // 4. بناء المسار الكامل داخل السيرفر (بافتراض أن مجلد uploads في الجذر)
      const absolutePath = path.join(__dirname, "../../", cleanPath);

      // 5. قراءة الصورة من السيرفر وتحويلها لـ Base64
      if (fs.existsSync(absolutePath)) {
        const ext = path.extname(absolutePath).substring(1) || "png";
        const base64Data = fs.readFileSync(absolutePath, {
          encoding: "base64",
        });
        return `data:image/${ext};base64,${base64Data}`;
      } else {
        console.log("⚠️ [PDF Builder] Logo not found on disk:", absolutePath);
      }
    } catch (err) {
      console.error("❌ [PDF Builder] Error converting image:", err.message);
    }

    return ""; // إرجاع فارغ إذا فشل كل شيء
  };

  const quotationId = data.quotationId || data.id;
  const referenceNumber =
    data.referenceNumber || `QT-${Date.now().toString().slice(-5)}`;

  // ================= Helpers =================
  // تغيير ar-SA إلى en-US لطباعة الأرقام بالإنجليزية
  const formatCurrency = (value) =>
    Number(value || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const formatArea = (val) =>
    Number(val || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const formatIBAN = (iban) =>
    iban
      ? iban
          .replace(/\s+/g, "")
          .replace(/(.{4})/g, "$1 ")
          .trim()
      : "---";

  const getDatePart = (formatter, date, type) =>
    formatter.formatToParts(date).find((part) => part.type === type)?.value ||
    "";

  const formatDateParts = (value) => {
    const date = value ? new Date(value) : new Date();

    // اسم اليوم يبقى بالعربية
    const dayName = new Intl.DateTimeFormat("ar-SA", {
      weekday: "long",
    }).format(date);

    if (Number.isNaN(date.getTime()))
      return { gregorian: value, hijri: value, combined: value };

    // استخدام en-US لضمان خروج الأرقام (اليوم، الشهر، السنة) بالإنجليزية
    const gregorianFormatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // استخدام en-US مع التقويم الهجري لضمان الأرقام الإنجليزية
    const hijriFormatter = new Intl.DateTimeFormat(
      "en-US-u-ca-islamic-umalqura",
      { year: "numeric", month: "2-digit", day: "2-digit" },
    );

    const gregorian = `${getDatePart(gregorianFormatter, date, "year")}/${getDatePart(gregorianFormatter, date, "month")}/${getDatePart(gregorianFormatter, date, "day")}`;

    const hijri = `${getDatePart(hijriFormatter, date, "year")}/${getDatePart(hijriFormatter, date, "month")}/${getDatePart(hijriFormatter, date, "day")}`;

    return {
      gregorian,
      hijri,
      combined: `${dayName}، ميلادي: ${gregorian} / هجري: ${hijri}`,
      dayName,
    };
  };

  const issueDateParts = formatDateParts(issueDate);

  // ================= Status Badge Logic =================
  let badgeText = "مسودة غير معتمدة";
  let badgeStyles =
    "background-color: #fffbeb; color: #b45309; border-color: #fde68a;";
  let statusDocumentText = "مسودة مراجعة داخلية";
  let statusDocumentColor = "#b45309";

  const isFullyApproved = status === "ACCEPTED" || status === "PARTIALLY_PAID";
  const isCancelled = status === "CANCELLED" || status === "REJECTED";
  const isOfficeApproved = status === "APPROVED" || status === "SENT";

  let isExpired = false;
  if (
    !isFullyApproved &&
    !isCancelled &&
    issueDate &&
    validityDays !== "unlimited"
  ) {
    const expiryDate = new Date(issueDate);
    expiryDate.setDate(expiryDate.getDate() + parseInt(validityDays));
    expiryDate.setHours(23, 59, 59, 999);
    if (new Date() > expiryDate) isExpired = true;
  }

  if (isExpired) {
    badgeText = "منتهي (انتهت الصلاحية)";
    badgeStyles =
      "background-color: #f1f5f9; color: #334155; border-color: #cbd5e1;";
    statusDocumentText = "منتهي";
    statusDocumentColor = "#334155";
  } else if (isCancelled) {
    badgeText = "ملغي";
    badgeStyles =
      "background-color: #fef2f2; color: #b91c1c; border-color: #fecaca;";
    statusDocumentText = "ملغي";
    statusDocumentColor = "#b91c1c";
  } else if (isFullyApproved) {
    badgeText = "معتمد من جميع الأطراف";
    badgeStyles =
      "background-color: #ecfdf5; color: #047857; border-color: #a7f3d0;";
    statusDocumentText = badgeText;
    statusDocumentColor = "#047857";
  } else if (isOfficeApproved) {
    badgeText = "معتمد من مقدم الخدمة فقط";
    badgeStyles =
      "background-color: #eff6ff; color: #1d4ed8; border-color: #bfdbfe;";
    statusDocumentText = badgeText;
    statusDocumentColor = "#1d4ed8";
  }

  const calculatedOfficeDiscount = (taxAmount * (officeTaxBearing || 0)) / 100;
  const finalPayable =
    (grandTotal || subtotal + taxAmount) - calculatedOfficeDiscount;

  let introText = `إشارة إلى طلبكم بخصوص تقديم عرض سعر خدمات (${transactionType || "الخدمات الهندسية والاستشارية"})`;
  if (handlingMethod)
    introText += `، بناءً على أسلوب التعامل والتفويض المعتمد (${handlingMethod})`;
  introText +=
    "، فإنه يسرنا تقديم العرض المالي والفني لإنهاء الأعمال المطلوبة وفقاً لنطاق العمل والاشتراطات والملاحظات التالية:";

  // ================= Design Assets =================
  const logoUrl = "https://details-worksystem1.com/logo.jpeg";
  const SECURITY_BACKGROUNDS = {
    none: "none",
    official1: "url('https://details-worksystem1.com/safe_background/1.webp')",
    official2: "url('https://details-worksystem1.com/safe_background/2.webp')",
    official3: "url('https://details-worksystem1.com/safe_background/3.webp')",
  };
  const finalBgUrl =
    SECURITY_BACKGROUNDS[bgType] || SECURITY_BACKGROUNDS["official1"];
  const accentColor = "#123f59";
  const goldColor = "#c5983c";

  const icons = {
    scale: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>`,
    userCheck: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${goldColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>`,
    building: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${goldColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>`,
    fileText: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${goldColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
    dollarSign: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${goldColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    folderOpen: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${goldColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/></svg>`,
    alertTriangle: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${goldColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>`,
  };

  // ================= Client Representation =================

  if (signatureMethod !== "SELF" && signatureMethod) {
    const safeClientType = clientType
      ? String(clientType).replace(/_/g, " ")
      : "العميل";
    let clientRepText = `ويمثل العميل (${safeClientType}) بالتوقيع والاعتماد على هذا العرض السيد/ة: `;
    clientRepText += repName ? `${repName}` : "........................";
    if (repIdNumber) clientRepText += `، (هوية رقم: ${repIdNumber})`;
    if (repCapacity) clientRepText += `، بصفته: ${repCapacity}`;
    if (authDocType || authDocNumber) {
      clientRepText += `، بموجب `;
      if (authDocType)
        clientRepText += `${authDocType === "مستند انتفاع" && customUsufructType ? customUsufructType : authDocType} `;
      if (authDocNumber) clientRepText += `رقم (${authDocNumber}) `;
      if (authDocIssueDate && showAuthDocIssueDate)
        clientRepText += `بتاريخ ${formatDateParts(authDocIssueDate).gregorian}`;
    }
    clientRepText += ".";
  }

  // ================= Plots Logic =================
  const totalPlotsArea = plots.reduce(
    (sum, plot) => sum + (Number(plot.area) || 0),
    0,
  );
  let rowSpans = { district: [], plan: [], deed: [], date: [] };
  if (plots && plots.length > 0) {
    let currentIdx = { district: 0, plan: 0, deed: 0, date: 0 };
    rowSpans.district = Array(plots.length).fill(0);
    rowSpans.plan = Array(plots.length).fill(0);
    rowSpans.deed = Array(plots.length).fill(0);
    rowSpans.date = Array(plots.length).fill(0);
    rowSpans.district[0] = 1;
    rowSpans.plan[0] = 1;
    rowSpans.deed[0] = 1;
    rowSpans.date[0] = 1;

    for (let i = 1; i < plots.length; i++) {
      if (
        (plots[i].district || propertyDistrict) ===
        (plots[i - 1].district || propertyDistrict)
      ) {
        rowSpans.district[currentIdx.district] += 1;
        rowSpans.district[i] = 0;
      } else {
        rowSpans.district[i] = 1;
        currentIdx.district = i;
      }
      if (
        (plots[i].planNumber || propertyPlanNumber) ===
        (plots[i - 1].planNumber || propertyPlanNumber)
      ) {
        rowSpans.plan[currentIdx.plan] += 1;
        rowSpans.plan[i] = 0;
      } else {
        rowSpans.plan[i] = 1;
        currentIdx.plan = i;
      }
      if (
        (plots[i].deedNumber || deedNumber) ===
        (plots[i - 1].deedNumber || deedNumber)
      ) {
        rowSpans.deed[currentIdx.deed] += 1;
        rowSpans.deed[i] = 0;
      } else {
        rowSpans.deed[i] = 1;
        currentIdx.deed = i;
      }
      if (
        (plots[i].deedDate || deedDate) === (plots[i - 1].deedDate || deedDate)
      ) {
        rowSpans.date[currentIdx.date] += 1;
        rowSpans.date[i] = 0;
      } else {
        rowSpans.date[i] = 1;
        currentIdx.date = i;
      }
    }
  }

  // ================= Bank Accounts =================
  const paymentMethodsLabels = {
    bank: "تحويل بنكي",
    cash: "نقدي",
    sadad: "رقم سداد",
    pos: "دفع الكترونى POS",
  };
  const acceptedMethodsList =
    typeof data.acceptedMethods === "string"
      ? JSON.parse(data.acceptedMethods)
      : data.acceptedMethods || ["bank"];

  let bankAccountsHTML = "";
  if (acceptedMethodsList.includes("bank") && selectedBankAccounts.length > 0) {
    const bankRows = selectedBankAccounts.map((bankId) => {
      const bank = bankAccountsData.find((b) => b.id === bankId);
      if (!bank) return "";

      const base64BankLogo = getLocalImageAsBase64(bank.logo || bank.bankLogo);

      return `
        <tr style="background-color: transparent;">
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">
             <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;">
                ${
                  base64BankLogo
                    ? `<img src="${base64BankLogo}" style="width: 24px; height: 24px; object-fit: contain; flex-shrink: 0;" />`
                    : `<div style="width: 20px; height: 20px; color:#94a3b8;">🏦</div>`
                }
                <span style="font-weight: 900; color: #123f59; font-size: 10.5px;">${bank.bankName || bank.name}</span>
             </div>
          </td>
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle; color: #475569; font-size: 10.5px; line-height: 1.625;">
             <div style="font-weight: bold; color: #1e293b;">${bank.accountNameAr || bank.accountName || "---"}</div>
             <div style="direction: ltr; margin-top: 2px;">${bank.accountNameEn || "---"}</div>
          </td>
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">
             <div style="font-family: monospace; font-weight: bold; color: #1e293b; font-size: 10.5px; direction: ltr; letter-spacing: 0.1em;">
               ${bank.accountNumber || "---"}
             </div>
          </td>
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">
             <div style="font-family: monospace; font-weight: 900; color: #3730a3; font-size: 10.5px; direction: ltr; letter-spacing: 0.05em;">
               ${formatIBAN(bank.iban)}
             </div>
          </td>
          <td style="padding: 0; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">
            <div style="display: flex; align-items: center; justify-content: center;">
                <img src="${bank.qrCodeData || ""}" alt="QR" style="width: 100%; height: 100%; max-width: 60px; max-height: 60px; object-fit: contain; margin-bottom: 4px; border: 1px solid #f1f5f9; padding: 2px; border-radius: 4px; background: #ffffff;" />
            </div>
          </td>
        </tr>`;
    });
    bankAccountsHTML = `
      <div style="border-top: 1px solid rgba(216,180,106,0.2); margin-top: 4px; padding-top: 12px; page-break-inside: avoid;">
        <span style="font-weight: 900; color: #123f59; display: block; margin-bottom: 8px; text-align: right; font-size: 11px;">البيانات البنكية المعتمدة للسداد:</span>
        <table style="width: 100%; border-collapse: collapse; background-color: transparent; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); text-align: center;">
          <thead style="background-color: rgba(241, 245, 249, 0.8);">
            <tr>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">البنك</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">اسم المستفيد</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">رقم الحساب</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">الآيبان / IBAN</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 8px; font-weight: 900; color: #475569; width: 15%;">QR للنسخ والمشاركة</th>
            </tr>
          </thead>
          <tbody>${bankRows.join("")}</tbody>
        </table>
      </div>`;
  }

  // ================= 🚀 معالجة الجدول الزمني (Timeline HTML Generator) =================
  let timelineHTML = "";
  if (timelineState && timelineState.showTimeline) {
    const DURATION_UNITS_AR = {
      WORKING_DAY: "يوم عمل",
      CALENDAR_DAY: "يوم تقويمي",
      WEEK: "أسبوع",
      MONTH: "شهر",
    };

    // توليد نص شروط البداية
    const conds = timelineState.startConditions || [];
    let parts = [];
    if (conds.includes("DOCUMENTS_RECEIVED"))
      parts.push("استلام كافة المستندات والبيانات المطلوبة");
    if (conds.includes("ADVANCE_PAYMENT"))
      parts.push("تأكيد استلام الدفعة الأولى أو المستحق المالي");
    if (conds.includes("SPECIFIC_DATE") && timelineState.customStartDate) {
      parts.push(
        `التاريخ المحدد (${new Date(timelineState.customStartDate).toLocaleDateString("ar-SA")})`,
      );
    }
    let timelineStartText =
      "تبدأ مدة تنفيذ الخدمات من تاريخ " +
      parts.join("، و") +
      (parts.length > 1 ? "، أيهما لاحق." : ".");
    if (conds.includes("TRAFFIC_STUDY"))
      timelineStartText +=
        " وفي حال تطلب الأمر دراسة مرورية، تستكمل المدة بعد استلام خطاب الاعتماد من الجهة المختصة.";

    const distributedDuration =
      timelineState.timelineItems?.reduce(
        (sum, item) => sum + (Number(item.duration) || 0),
        0,
      ) || 0;
    const totalDuration = Number(timelineState.totalDuration) || 0;
    const remainingDuration = Math.max(0, totalDuration - distributedDuration);

    let timelineRowsHTML = "";
    if (timelineState.timelineItems && timelineState.timelineItems.length > 0) {
      timelineRowsHTML += timelineState.timelineItems
        .map((tItem, index) => {
          const relatedItem = items.find(
            (i) => String(i.id) === String(tItem.itemId),
          );
          return `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); font-family: monospace; background-color: rgba(248, 250, 252, 0.5);">${index + 1}</td>
            <td style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); text-align: right; line-height: 1.6;">${relatedItem ? relatedItem.title : "خدمة غير محددة"}</td>
            <td style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); font-family: monospace;">${tItem.duration} ${DURATION_UNITS_AR[tItem.unit || timelineState.durationUnit]}</td>
            <td style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); font-size: 9.5px; color: #64748b;">${tItem.notes || "---"}</td>
          </tr>
        `;
        })
        .join("");
    }

    if (remainingDuration > 0 && timelineState.timelineItems?.length > 0) {
      timelineRowsHTML += `
        <tr style="background-color: #f8fafc; border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); font-family: monospace; color: #94a3b8;">*</td>
          <td style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); text-align: right; color: #334155;">بقية خدمات نطاق العمل</td>
          <td style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); font-family: monospace; color: #334155;">${remainingDuration} ${DURATION_UNITS_AR[timelineState.durationUnit]}</td>
          <td style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); font-size: 9.5px; color: #64748b;">حسب التتابع الزمني</td>
        </tr>
      `;
    }

    let endDateHTML = "";
    if (
      timelineState.showEndDate &&
      conds.includes("SPECIFIC_DATE") &&
      timelineState.customStartDate
    ) {
      const estimatedEnd = new Date(
        new Date(timelineState.customStartDate).getTime() +
          totalDuration * 24 * 60 * 60 * 1000,
      ).toLocaleDateString("ar-SA");
      endDateHTML = `<span style="display: block; font-size: 9px; color: #047857; margin-top: 4px; font-family: 'Tajawal', sans-serif;">(ينتهي تقريباً في: ${estimatedEnd})</span>`;
    }

    timelineHTML = `
      <div class="bg-transparent" style="margin-bottom: 24px;">
        <h4 style="margin: 0 0 12px 0; font-size: 11.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: ${accentColor}; page-break-after: avoid;">
            ${icons.calendar} ${signatureMethod !== "SELF" ? "خامساً" : "رابعاً"}: الجدول الزمني لتنفيذ الخدمات
        </h4>
        <div style="margin-bottom: 12px; font-size: 10.5px; font-weight: bold; color: #475569; background-color: rgba(248, 250, 252, 0.5); padding: 10px; border-radius: 8px; border: 1px solid #f1f5f9; line-height: 1.6; page-break-after: avoid;">
          ${timelineStartText}
        </div>
        <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 10.5px; border: 1px solid ${accentColor}; margin-bottom: 0; background-color: transparent;">
          <thead style="background-color: ${accentColor}; color: #fff; font-weight: 900;">
            <tr>
              <th style="padding: 8px; border: 1px solid ${accentColor}; width: 8%;">م</th>
              <th style="padding: 8px; border: 1px solid ${accentColor}; width: 45%;">الخدمة / المرحلة</th>
              <th style="padding: 8px; border: 1px solid ${accentColor}; width: 22%;">المدة</th>
              <th style="padding: 8px; border: 1px solid ${accentColor}; width: 25%;">ملاحظات</th>
            </tr>
          </thead>
          <tbody class="font-bold text-[#123f59]">
            ${timelineRowsHTML}
            <tr style="background-color: rgba(241, 245, 249, 0.8);">
              <td colspan="2" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); text-align: left; font-weight: 900; color: #1e293b;">إجمالي مدة تنفيذ الخدمات:</td>
              <td colspan="2" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); font-weight: 900; font-family: monospace; color: ${accentColor};">
                ${totalDuration} ${DURATION_UNITS_AR[timelineState.durationUnit]}
                ${endDateHTML}
              </td>
            </tr>
          </tbody>
        </table>
        ${timelineState.showTimelineNotes && timelineState.timelineNotes ? `<div style="margin-top: 8px; font-size: 10px; font-weight: bold; color: #64748b; line-height: 1.6; text-align: justify; page-break-inside: avoid;">* ${timelineState.timelineNotes}</div>` : ""}
      </div>
    `;
  }

  // ================= إعدادات جدول الاعتماد العلوي (للباك إند) =================
  const validityText = isExpired ? "غير ساري" : "ساري";
  const validityColorHex = isExpired ? "#e11d48" : "#059669";

  let firstPartyStatusText = "مسودة";
  let firstPartyStatusColorHex = "#64748b";
  if (status === "REJECTED" || status === "CANCELLED") {
    firstPartyStatusText = "مرفوض / ملغي";
    firstPartyStatusColorHex = "#e11d48";
  } else if (isOfficeApproved || isFullyApproved) {
    firstPartyStatusText = `معتمد بتاريخ ${issueDateParts.gregorian}`;
    firstPartyStatusColorHex = "#123f59";
  } else {
    firstPartyStatusText = "في انتظار الاعتماد";
    firstPartyStatusColorHex = "#d97706";
  }

  let secondPartyStatusText = "في انتظار الاعتماد";
  let secondPartyStatusColorHex = "#d97706";
  if (isFullyApproved) {
    secondPartyStatusText = "معتمد";
    secondPartyStatusColorHex = "#059669";
  } else if (status === "REJECTED" || status === "CANCELLED") {
    secondPartyStatusText = "مرفوض / ملغي";
    secondPartyStatusColorHex = "#e11d48";
  }

  const safeFontFamily = fontFamily ? fontFamily.toLowerCase() : "tajawal";
  const selectedFontBase64 = fontsBase64[safeFontFamily] || fontsBase64.tajawal;

  // 🚀 1. تنظيف الـ Base64 من أي فواصل أسطر أو مسافات تكسر الـ CSS
  const cleanBase64 = selectedFontBase64.replace(/[\r\n\s]+/g, "");

  // 🚀 تجهيز مصفوفة الشروط والأحكام لتحويلها إلى جدول
  const termsArray = (termsText || "خاضع للشروط العامة المسجلة بالمكتب.")
    .split("\n")
    .map((term) => term.trim())
    .filter((term) => term !== "");

  const termsHtmlRows =
    termsArray.length > 0
      ? termsArray
          .map(
            (term, index) => `
    <tr style="background-color: ${index % 2 === 0 ? "rgba(248, 250, 252, 0.5)" : "transparent"}; border-bottom: 1px solid ${accentColor}22;">
      <td style="padding: 8px; border-left: 1px solid ${accentColor}44; text-align: center; font-family: monospace;">
        ${index + 1}
      </td>
      <td style="padding: 8px; line-height: 1.6; border-left: 1px solid ${accentColor}44;">
        ${term.replace(/^[*-•\d.)]+\s*/, "")}
      </td>
    </tr>
  `,
          )
          .join("")
      : `
    <tr>
       <td colspan="2" style="padding: 16px; text-align: center; color: #64748b;">لا توجد شروط وأحكام مسجلة</td>
    </tr>
  `;

  // ================= HTML Output =================
  return `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <style>
        @font-face {
          font-family: '${fontFamily}';
          src: url("data:font/ttf;base64,${cleanBase64}") format("truetype");
          font-weight: normal;
          font-style: normal;
        }
        @page { size: A4; margin: 0; }
        
        body, html { 
            direction: rtl; text-align: right; height: 100%; margin: 0; padding: 0; 
            font-family: '${fontFamily}', sans-serif !important; color: #123f59; 
            -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; 
        }
        
        .fixed-print-bg {
          position: fixed; top: 0; left: 0; width: 100%; height: 100vh;
          background-image: ${SECURITY_BACKGROUNDS[bgType] || SECURITY_BACKGROUNDS["none"]};
          background-size: 100% 100%; background-repeat: no-repeat; background-position: center; z-index: -10;
        }

        .page-container { 
          width: 100%; box-sizing: border-box; position: relative; page-break-after: always; 
          background-color: transparent !important; box-shadow: none !important;
        }
        
        /* 🚀 الإعدادات السحرية لانقسام الجداول بشكل ذكي */
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 10.5px; page-break-inside: auto; } 
        tr { page-break-inside: avoid; page-break-after: auto; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
        
        /* 🚀 ضمان حماية العناصر المهمة باستخدام important */
        .avoid-break { break-inside: avoid !important; page-break-inside: avoid !important; }
        
        .bg-slate-50 { background-color: #f8fafc; }
        .text-slate-500 { color: #64748b; }
        .text-slate-700 { color: #334155; }
        .text-slate-800 { color: #1e293b; }
        .font-bold { font-weight: bold; }
        .font-black { font-weight: 900; }
        .font-mono { font-family: monospace; }
        .section-title { font-size: 11.5px; font-weight: 900; color: #123f59; margin-bottom: 8px; border-bottom: 2px solid #123f59; padding-bottom: 4px; display: inline-block; page-break-after: avoid; }
      </style>
    </head>
    <body>
      <div class="fixed-print-bg"></div>

      <div class="page-container" style="display: flex; flex-direction: column; min-height: 100vh; box-sizing: border-box; align-items: center; text-align: center; padding: 40px; position: relative;">
        ${
          showSummaryTable
            ? `
        <div style="position: absolute; bottom: 40px; left: 40px; right: 40px; z-index: 20;">
          <table style="width: 100%; border-collapse: collapse; border: 2px solid ${accentColor}; background-color: rgba(255, 255, 255, 0.97); text-align: right; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
            <tbody>
              <tr>
                <td style="width: 30%; padding: 8px; text-align: center; vertical-align: middle; border-left: 2px solid ${accentColor};">
                  <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;">
                    ${
                      verificationQrImage
                        ? `<img src="${verificationQrImage}" alt="QR" style="width: 64px; height: 64px; mix-blend-mode: multiply;" />`
                        : `<div style="width: 56px; height: 56px; border: 1px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; background-color: #f8fafc;"><span style="font-size: 8px; color: #94a3b8; font-weight: 900;">QR</span></div>`
                    }
                    <span style="font-size: 8px; font-weight: 900; color: #123f59; line-height: 1.2;">شركة ديتيلز كونسولتس<br/>للاستشارات الهندسية</span>
                  </div>
                </td>
                <td style="width: 40%; padding: 0; vertical-align: top; border-left: 2px solid ${accentColor};">
                  <div style="display: flex; flex-direction: column; height: 100%;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #cbd5e1; flex: 1;">
                      <span style="font-size: 11px; font-weight: 900; color: #475569;">حالة السريان</span>
                      <span style="font-size: 11px; font-weight: 900; color: ${validityColorHex};">${validityText}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #cbd5e1; flex: 1;">
                      <span style="font-size: 11px; font-weight: 900; color: #475569;">اعتماد الطرف الأول</span>
                      <span style="font-size: 11px; font-weight: 900; color: ${firstPartyStatusColorHex};">${firstPartyStatusText}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; flex: 1;">
                      <span style="font-size: 11px; font-weight: 900; color: #475569;">اعتماد الطرف الثاني</span>
                      <span style="font-size: 11px; font-weight: 900; color: ${secondPartyStatusColorHex};">${secondPartyStatusText}</span>
                    </div>
                  </div>
                </td>
                <td style="width: 30%; padding: 0; vertical-align: top;">
                  <div style="display: flex; flex-direction: column; height: 100%;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #cbd5e1; flex: 1;">
                      <span style="font-size: 11px; font-weight: 900; color: #475569;">اسم الحي</span>
                      <span style="font-size: 11px; font-weight: 900; color: #123f59; max-width: 100px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${propertyDistrict || "---"}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #cbd5e1; flex: 1;">
                      <span style="font-size: 11px; font-weight: 900; color: #475569;">مساحة الأرض</span>
                      <span style="font-size: 11px; font-family: monospace; font-weight: 900; color: #123f59;">${formatArea(totalPlotsArea)} م²</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background-color: #f8fafc; flex: 1;">
                      <span style="font-size: 10px; font-weight: 900; color: #475569;">إجمالي قيمة مع الضريبة</span>
                      <span style="font-size: 12px; font-family: monospace; font-weight: 900; color: #047857;">${formatCurrency(finalPayable)}</span>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>`
            : ""
        }

        <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; width: 100%; flex: 1; padding-bottom: ${showSummaryTable ? "240px" : "40px"};">
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 36px; margin-bottom: 36px; width: 100%;">
            <div style="width: 280px; display: flex; align-items: center; justify-content: center;">
              <img src="${logoUrl}" alt="Logo" style="max-height: 100%; max-width: 100%; mix-blend-mode: multiply; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.1));" />
            </div>
            ${
              address
                ? `
            <div style="display: flex; flex-direction: column; align-items: center; text-align: center; max-width: 768px; padding: 0 24px; gap: 16px;">
              <div style="width: 80px; height: 5px; background-color: ${goldColor}; border-radius: 9999px; opacity: 0.8;"></div>
              <h1 style="font-size: 39px; font-weight: 900; color: #123f59; line-height: 1.4; letter-spacing: 0.025em; margin: 0;">${address}</h1>
              <div style="width: 80px; height: 5px; background-color: ${goldColor}; border-radius: 9999px; opacity: 0.8;"></div>
            </div>`
                : ""
            }
          </div>

          <div style="width: 100%; display: flex; flex-direction: column; align-items: center; margin-bottom: 32px;">
            <div style="width: 85%; border-top: 4px solid ${accentColor}; border-bottom: 4px solid ${accentColor}; padding: 36px 0;">
              <h1 style="font-size: 45px; font-weight: 900; color: ${accentColor}; margin-bottom: 16px; margin-top: 0; line-height: 1.25;">
                ${documentType || "عرض سعر فني ومالي"}
              </h1>
              <h2 style="font-size: 25px; font-weight: bold; color: #475569; margin: 0;">${transactionType || "خدمات هندسية واستشارية استراتيجية"}</h2>
            </div>
          </div>

          <div style="width: 100%; text-align: center; background-color: transparent; padding: 28px 32px; border-radius: 20px; border: 1px solid rgba(216,180,106,0.3); box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); box-sizing: border-box;">
            <p style="font-size: 20px; font-weight: 900; color: #64748b; margin-top: 0; margin-bottom: 12px;">مقدم إلى السادة / الطرف الثاني:</p>
            <p style="font-size: 29px; font-weight: 900; color: ${accentColor}; margin-top: 0; margin-bottom: ${signatureMethod !== "SELF" ? "8px" : "24px"}; line-height: 1.25;">${clientTitle} / ${secondPartyName || clientNameForPreview}</p>
            
            ${
              signatureMethod !== "SELF"
                ? `
            <p style="font-size: 16px; text-align:center; font-weight: 900; color: #e11d48; margin-top: 0; margin-bottom: 24px;">
              ${[
                authDocType === "مستند انتفاع" && customUsufructType
                  ? customUsufructType
                  : authDocType
                    ? `معلومات التفويض: ${authDocType === "مستند انتفاع" && customUsufructType ? customUsufructType : authDocType}`
                    : "",
                authDocNumber ? `رقم المستند: ${authDocNumber}` : "",
                showAuthDocExpiryDate && authDocExpiryDate
                  ? `تاريخ انتهاء المستند: ${formatDateParts(authDocExpiryDate).gregorian}`
                  : "",
              ]
                .filter(Boolean)
                .join(" | ")}
            </p>`
                : ""
            }

            <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 16.5px; font-weight: bold; color: #334155; margin-bottom: 0;">
              <tr>
                <td style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 0 0 4px 0; width: 45%; vertical-align: top;">
                  <div style="display: flex; justify-content: space-between; padding-left: 32px;">
                    <span style="color: #64748b; font-size: 15px;">رقم العرض /الرقم المرجعي:</span> 
                    <span style="color: #0f172a; font-weight: 900; font-size: 15px; font-family: monospace;">${referenceNumber}</span>
                  </div>
                </td>
                <td style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 0 0 4px 0; width: 55%; vertical-align: top;">
                   <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b; font-size: 18px;">تاريخ الإصدار:</span> 
                    <span style="color: #0f172a; font-family: monospace;">${formatDateParts(authDocIssueDate).gregorian}</span>
                   </div>
                </td>
              </tr>
              ${
                transactionRefForPreview || meetingTitleForPreview
                  ? `
              <tr>
                ${
                  transactionRefForPreview
                    ? `
                <td colspan="${meetingTitleForPreview ? "1" : "2"}" style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 8px 0 4px 0; vertical-align: top;">
                   <div style="display: flex; justify-content: space-between; ${meetingTitleForPreview ? "padding-left: 32px;" : ""}">
                    <span style="color: #64748b;">الرقم الداخلي للمعاملة:</span> 
                    <span style="color: #0f172a; font-weight: 900; font-size: 15px; font-family: monospace;">${transactionRefForPreview}</span>
                   </div>
                </td>`
                    : '<td style="border: none; border-bottom: 1px dashed #cbd5e1;"></td>'
                }
                ${
                  meetingTitleForPreview
                    ? `
                <td colspan="${transactionRefForPreview ? "1" : "2"}" style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 8px 0 4px 0; vertical-align: top;">
                   <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">استناداً لمحضر اجتماع:</span> 
                    <span style="color: #0f172a; font-weight: 900; font-family: monospace; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${meetingTitleForPreview}</span>
                   </div>
                </td>`
                    : '<td style="border: none; border-bottom: 1px dashed #cbd5e1;"></td>'
                }
              </tr>`
                  : ""
              }
              ${
                propertyCodeForPreview
                  ? `
              <tr>
                <td colspan="2" style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 8px 0 4px 0;">
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">المشروع/الملكية:</span> 
                    <span style="color: #0f172a; font-weight: 900; font-family: monospace;">${propertyCodeForPreview}</span>
                  </div>
                </td>
              </tr>`
                  : ""
              }
            </table>
          </div>
        </div> 
      </div>

      <div class="page-container" style="padding: 0;">
        <table style="width: 100%; border: none; margin: 0; position: relative; z-index: 1;">
          <div style="position: relative;">

  <div style="position: absolute; top: 50px; right: 60px; width: 240px; border: 1px solid rgba(18,63,89,0.267); display: flex; flex-direction: column; justify-content: center; padding: 12px; background-color: #ffffff; box-sizing: border-box; z-index: 50;">
    <div style="color: #475569; font-size: 15px; margin-bottom: 4px; font-weight: bold;">الموضوع</div>
    <div style="font-size: 18px; font-weight: bold; color: #123f59; line-height: 1.6; word-wrap: break-word;">${subject || "—"}</div>
  </div>

  <table style="width: 100%; border-collapse: collapse;">
    <thead style="display: table-header-group;">
      <tr>
        <td style="border: none; padding: 50px 60px 20px 60px;">
          <div style="display: flex; width: 100%; justify-content: space-between; align-items: stretch; border-bottom: 3px solid ${accentColor}; padding-bottom: 16px; background-color: transparent;">
            
            <div style="width: 240px; flex-shrink: 0; border: 1px solid rgba(18,63,89,0.267); display: flex; flex-direction: column; justify-content: center; padding: 12px; background-color: transparent; box-sizing: border-box;">
              <div style="color: transparent; font-size: 15px; margin-bottom: 4px; font-weight: bold;">الموضوع</div>
              <div style="font-size: 18px; font-weight: bold; color: transparent; line-height: 1.6; word-wrap: break-word;">${subject || "—"}</div>
            </div>

            <div style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 16px; background-color: transparent;">
              <img src="${logoUrl}" alt="Logo" style="height: 64px; width: auto; max-width: 100%; object-fit: contain; mix-blend-mode: multiply;" />
            </div>
            
            <div style="width: 240px; flex-shrink: 0; border: 1px solid rgba(18,63,89,0.267); display: flex; flex-direction: column; background-color: transparent; box-sizing: border-box;">
              <div style="display: flex; flex: 1; border-bottom: 1px solid rgba(18,63,89,0.267); background-color: transparent;">
                <div style="width: 85px; flex-shrink: 0; padding: 6px; border-left: 1px solid rgba(18,63,89,0.267); color: #475569; font-size: 13px; font-weight: bold; display: flex; align-items: center; background-color: transparent; box-sizing: border-box;">
                  التاريخ
                </div>
                
                <div style="flex: 1; padding: 6px; font-size: 10px; font-weight: bold; color: #123f59; display: flex; flex-direction: column; justify-content: center; gap: 2px; background-color: transparent; box-sizing: border-box; line-height: 1.2;">
                  <span>${issueDateParts.dayName}</span>
                  <span style="color: #64748b;">م: <span style="color: #123f59; font-family: monospace; font-size: 11px;">${issueDateParts.gregorian}</span></span>
                  <span style="color: #64748b;">هـ: <span style="color: #123f59; font-family: monospace; font-size: 11px;">${issueDateParts.hijri}</span></span>
                </div>
              </div>
              <div style="display: flex; flex: 1; background-color: transparent;">
                <div style="width: 85px; flex-shrink: 0; padding: 8px; border-left: 1px solid rgba(18,63,89,0.267); color: #475569; font-size: 15px; font-weight: bold; display: flex; align-items: center; background-color: transparent; box-sizing: border-box;">رقم المرجع</div>
                <div style="flex: 1; padding: 8px; font-family: monospace; font-size: 16px; font-weight: 900; color: #123f59; display: flex; align-items: center; background-color: transparent; box-sizing: border-box;">${referenceNumber}</div>
              </div>
            </div>

          </div>
        </td>
      </tr>
    </thead>

          <tbody style="display: table-row-group;">
            <tr>
              <td style="border: none; padding: 20px 60px;">
                
                <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 15px; font-weight: bold; border: 1px solid rgba(18,63,89,0.267); margin-bottom: 24px; margin-top: 16px; background: transparent;">
                  <tr>
                    <td class="bg-slate-50 text-slate-500" style="width: 20%; border: 1px solid rgba(18,63,89,0.267); padding: 8px;">نوع الخدمة</td>
                    <td class="font-black" style="width: 30%; color: ${accentColor}; border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${transactionType || "عرض سعر خدمات فنية"}</td>
                    <td class="bg-slate-50 text-slate-500" style="width: 20%; border: 1px solid rgba(18,63,89,0.267); padding: 8px;">حالة المستند</td>
                    <td class="font-black" style="width: 30%; border: 1px solid rgba(18,63,89,0.267); padding: 8px; color: ${statusDocumentColor};">${statusDocumentText}</td>
                  </tr>
                  <tr>
                    <td class="bg-slate-50 text-slate-500" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">رقم حساب العميل</td>
                    <td class="font-mono text-slate-800" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${clientCodeForPreview || "---"}</td>
                    <td class="bg-slate-50 text-slate-500" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">رمز أرشفة المشروع</td>
                    <td class="font-mono text-slate-800" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${propertyCodeForPreview || "---"}</td>
                  </tr>
                  <tr>
                    <td class="bg-slate-50 text-slate-500" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">مدة صلاحية العرض</td>
                    <td class="text-slate-800" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${validityDays === "unlimited" ? "مفتوح / غير محدد" : `${validityDays} يوماً تبدأ بعد اعتماد مقدم الخدمة`}</td>
                    <td class="bg-slate-50 text-slate-500" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">نسخة الوثيقة</td>
                    <td class="font-mono text-slate-800" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">1.0</td>
                  </tr>
                </table>

                <div class="bg-transparent" style="margin-bottom: 24px;">
                  <h4 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 900; color: ${accentColor}; text-align: right; page-break-after: avoid;">${clientTitle} ${secondPartyName || clientNameForPreview}</h4>
                  <p style="margin: 12px 0; font-size: 17px; font-weight: 900; color: ${accentColor}; text-align: right; page-break-after: avoid;">السلام عليكم ورحمة الله وبركاته ،،,</p>
                  <div style="font-size: 16.5px; font-weight: bold; color: #475569; line-height: 24px; text-align: right; white-space: pre-wrap; margin-bottom: 16px; page-break-after: avoid;">${introText}</div>
                </div>

                <div class="bg-transparent" style="margin-bottom: 24px;">
                  <h4 style="margin: 0 0 8px 0; font-size: 16.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: ${accentColor}; page-break-after: avoid;">
                      ${icons.userCheck} أولاً: بيانات العميل والمالك وصاحب العلاقة الأصلي
                  </h4>
                  <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 15.5px; border: 1px solid ${accentColor}; margin-bottom: 0; background-color: transparent;">
                    <tbody class="font-bold text-[#123f59]">
                      <tr>
                        <td class="bg-slate-50 w-1/4" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">تصنيف العميل الكياني</td>
                        <td class="w-1/4" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${(clientType || "فرد").replace(/_/g, " ")}</td>
                        <td class="bg-slate-50 w-1/4" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">اسم المالك المسجل بالتسجيل</td>
                        <td class="w-1/4 font-black" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px; color: ${accentColor};">${clientNameForPreview}</td>
                      </tr>
                      <tr>
                        <td class="bg-slate-50" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px; font-size: 15px;">الصفة الرسمية للتعامل و الاعتماد</td>
                        <td style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${handlingMethod}</td>
                        <td class="bg-slate-50" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">رقم الجوال للاتصال</td>
                        <td class="font-mono text-blue-700" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${repPhone || "---"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                ${
                  signatureMethod !== "SELF"
                    ? `
                <div class="bg-transparent" style="margin-bottom: 24px;">
                  <div class="section-title" style="page-break-after: avoid;">ثانياً: بيانات التمثيل النظامي والمفوض بالتوقيع الشرعي</div>
                  <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 15.5px; border: 1px solid ${accentColor}; margin-bottom: 0;">
                    <tbody class="font-bold text-[#123f59]">
                      <tr>
                        <td class="bg-slate-50 w-1/4" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">اسم المفوض / الممثل</td>
                        <td class="w-1/4 font-black" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${repName || "---"}</td>
                        <td class="bg-slate-50 w-1/4" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">رقم السجل المدني / الهوية</td>
                        <td class="w-1/4 font-mono font-black" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${repIdNumber || "---"}</td>
                      </tr>
                      <tr>
                        <td class="bg-slate-50" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">الصفة القانونية للتمثيل</td>
                        <td style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${signatureMethod === "AGENT" ? "وكيل شرعي" : signatureMethod === "AUTHORIZED" ? "مفوض نظامي" : "مستفيد"}</td>
                        <td class="bg-slate-50" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">رقم جوال الممثل</td>
                        <td class="font-mono text-blue-700" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${repPhone || "---"}</td>
                      </tr>
                      <tr>
                        <td class="bg-slate-50" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">نوع مستند التفويض والصفة</td>
                        <td class="font-black text-slate-700" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">${authDocType === "مستند انتفاع" && customUsufructType ? customUsufructType : authDocType || "---"}</td>
                        <td class="bg-slate-50" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px;">بيانات المستند المعتمد</td>
                        <td class="font-mono font-bold text-cyan-800" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px; line-height: 1.6;">
                          <div style="display: flex; flex-direction: column; gap: 2px;">
                            <span>${authDocNumber ? `رقم: ${authDocNumber}` : "رقم: ---"}</span>
                            ${showAuthDocIssueDate && authDocIssueDate ? `<span style="font-size: 14px; color: #64748b;">إصدار: ${formatDateParts(authDocIssueDate).gregorian}</span>` : ""}
                            ${showAuthDocExpiryDate && authDocExpiryDate ? `<span style="font-size: 14px; color: #e11d48;">انتهاء: ${formatDateParts(authDocExpiryDate).gregorian}</span>` : ""}
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>`
                    : ""
                }

                <div class="bg-transparent" style="margin-bottom: 24px;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px; page-break-after: avoid;">
                    <h4 style="margin: 0; font-size: 16.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: ${accentColor};">
                      ${icons.building} ${signatureMethod !== "SELF" ? "ثالثاً" : "ثانياً"}: بيانات المشروع والملكية العقارية
                    </h4>
                    ${
                      plots && plots.length > 0
                        ? `
                    <span style="font-size: 15px; font-weight: bold; color: #64748b; background-color: #fff; padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
                      عدد القطع: ${plots.length} | إجمالي المساحة: ${formatArea(totalPlotsArea)} م² | رمز الملف: ${propertyCodeForPreview || "---"}
                    </span>`
                        : ""
                    }
                  </div>

                  ${
                    plots && plots.length > 0
                      ? `
                  <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 15.5px; border: 1px solid ${accentColor}; background-color: transparent; margin-bottom: 0;">
                    <thead style="background-color: ${accentColor}; color: #fff; font-weight: 900;">
                      <tr>
                        <th style="padding: 8px; border: 1px solid ${accentColor}; width: 40px;">م</th>
                        <th style="padding: 8px; border: 1px solid ${accentColor};">رقم القطعة</th>
                        <th style="padding: 8px; border: 1px solid ${accentColor};">الحي</th>
                        <th style="padding: 8px; border: 1px solid ${accentColor};">رقم المخطط التنظيمي</th>
                        <th style="padding: 8px; border: 1px solid ${accentColor};">رقم وثيقة الملكية</th>
                        <th style="padding: 8px; border: 1px solid ${accentColor};">تاريخ الوثيقة</th>
                        <th style="padding: 8px; border: 1px solid ${accentColor};">مساحة القطعة</th>
                      </tr>
                    </thead>
                    <tbody class="font-bold text-[#123f59]">
                      ${plots
                        .map(
                          (plot, i) => `
                      <tr>
                        <td style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); background-color: rgba(248, 250, 252, 0.5);">${i + 1}</td>
                        <td class="font-mono" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267);">${plot.plotNumber || "---"}</td>
                        ${rowSpans.district[i] > 0 ? `<td rowspan="${rowSpans.district[i]}" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); vertical-align: middle;">${plot.district || propertyDistrict || "---"}</td>` : ""}
                        ${rowSpans.plan[i] > 0 ? `<td rowspan="${rowSpans.plan[i]}" class="font-mono text-slate-700" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); vertical-align: middle;">${plot.planNumber || propertyPlanNumber || "---"}</td>` : ""}
                        ${rowSpans.deed[i] > 0 ? `<td rowspan="${rowSpans.deed[i]}" class="font-mono text-emerald-800 font-black" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); vertical-align: middle;">${plot.deedNumber || deedNumber || "---"}</td>` : ""}
                        ${rowSpans.date[i] > 0 ? `<td rowspan="${rowSpans.date[i]}" class="font-mono text-slate-600" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); vertical-align: middle;">${plot.deedDate || deedDate ? formatDateParts(plot.deedDate || deedDate).gregorian : "---"}</td>` : ""}
                        <td class="font-mono" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267);">${formatArea(plot.area)} م²</td>
                      </tr>`,
                        )
                        .join("")}
                      <tr class="bg-slate-50">
                        <td colspan="6" class="text-left font-black" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267);">إجمالي مساحة الموقع:</td>
                        <td class="font-mono font-black text-[17px] text-emerald-800" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267);">${formatArea(totalPlotsArea)} م²</td>
                      </tr>
                    </tbody>
                  </table>`
                      : `
                  <div style="padding: 16px; border: 1px dashed #cbd5e1; border-radius: 12px; text-align: center; color: #94a3b8; font-size: 17px; font-weight: bold;">لا توجد قطع مضافة في ملف الملكية المرفق</div>`
                  }
                  
                  ${
                    licenseNumber || serviceNumber
                      ? `
                  <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 15.5px; border: 1px solid ${accentColor}; background-color: transparent; margin-top: 12px; margin-bottom: 0;">
                    <tbody class="font-bold text-[#123f59]">
                      <tr>
                        ${licenseNumber ? `<td class="bg-slate-50" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px; width: 25%;">رقم وتاريخ رخصة البناء</td><td class="font-mono" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px; width: ${licenseNumber && serviceNumber ? "25%" : "75%"};">${licenseNumber} لعام ${licenseYear}هـ</td>` : ""}
                        ${serviceNumber ? `<td class="bg-slate-50" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px; width: 25%;">رقم وتاريخ المعاملة / الطلب</td><td class="font-mono" style="border: 1px solid rgba(18,63,89,0.267); padding: 8px; width: ${licenseNumber && serviceNumber ? "25%" : "75%"};">${serviceNumber} لعام ${serviceYear}هـ</td>` : ""}
                      </tr>
                    </tbody>
                  </table>`
                      : ""
                  }
                </div>

                <div class="bg-transparent" style="margin-bottom: 24px;">
                  <h4 style="margin: 0 0 8px 0; font-size: 16.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: ${accentColor}; page-break-after: avoid;">
                    ${icons.fileText} ${signatureMethod !== "SELF" ? "رابعاً" : "ثالثاً"}: نطاق الأعمال و التكلفة
                  </h4>
                  <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 15.5px; border: 1px solid ${accentColor}; margin-bottom: 0; table-layout: fixed; background-color: transparent;">
                    <thead style="background-color: ${accentColor}; color: #fff; font-weight: 900;">
                      <tr>
                        <th style="padding: 10px; border: 1px solid ${accentColor}; width: 5%;">م</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid ${accentColor}; width: 95%;">وصف الخدمة</th>
                      </tr>
                    </thead>
                    <tbody class="font-bold text-[#123f59]">
                      ${
                        items.length === 0
                          ? `<tr><td colspan="2" style="padding: 24px; color: #94a3b8; text-align: center;">لا توجد بنود فنية مسجلة حتى الآن</td></tr>`
                          : items
                              .map(
                                (item, index) => `
                      <tr>
                        <td class="font-mono" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); vertical-align: top; text-align: center;">${index + 1}</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid rgba(18,63,89,0.267); line-height: 1.625; word-wrap: break-word; white-space: pre-wrap;">${item.title}</td>
                      </tr>`,
                              )
                              .join("")
                      }
                    </tbody>
                    
                    <tbody class="avoid-break font-bold text-[#123f59]">
                      <tr class="bg-slate-50" style="background-color: rgba(248, 250, 252, 0.5);">
                        <td colspan="2" style="padding: 0; border: 1px solid rgba(18,63,89,0.267);">
                          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 10px 16px; box-sizing: border-box;">
                            <span class="font-black">المجموع الفرعي</span>
                            <span class="font-mono font-black text-slate-800" style="font-size: 17px;">${formatCurrency(subtotal)} ر.س</span>
                          </div>
                        </td>
                      </tr>
                      <tr class="bg-transparent">
                        <td colspan="2" style="padding: 0; border: 1px solid rgba(18,63,89,0.267);">
                          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 10px 16px; box-sizing: border-box;">
                            <span style="font-weight: bold; color: #64748b;">ضريبة القيمة المضافة ${taxRate || 15}% ${officeTaxBearing > 0 ? ` (يتحمل المكتب ${officeTaxBearing}%)` : ""}</span>
                            <span class="font-mono font-bold text-slate-700" style="font-size: 17px;">${formatCurrency(taxAmount)} ر.س</span>
                          </div>
                        </td>
                      </tr>
                      ${
                        officeTaxBearing > 0
                          ? `
                      <tr class="bg-transparent text-emerald-700">
                        <td colspan="2" style="padding: 0; border: 1px solid rgba(18,63,89,0.267);">
                          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 8px 16px; box-sizing: border-box;">
                            <span style="font-weight: bold; color: #047857;">خصم إعفاء ضريبي ضِمني (المكتب يتحمل نسبة ${officeTaxBearing}%)</span>
                            <span class="font-mono font-black" style="font-size: 17px; color: #047857;">- ${formatCurrency(calculatedOfficeDiscount)} ر.س</span>
                          </div>
                        </td>
                      </tr>`
                          : ""
                      }
                      <tr class="font-black" style="background-color: ${accentColor}; color: #ffffff;">
                        <td colspan="2" style="padding: 0; border: 1px solid rgba(18,63,89,0.267);">
                          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 12px 16px; box-sizing: border-box;">
                            <span style="font-size: 17.5px;">الإجمالي النهائي المستحق الصافي للدفع</span>
                            <span class="font-mono" style="font-size: 18.5px;">${formatCurrency(finalPayable)} ر.س</span>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                ${timelineHTML}

                ${
                  (paymentsList && paymentsList.length > 0) ||
                  (acceptedMethodsList && acceptedMethodsList.length > 0)
                    ? `
                <div class="bg-transparent" style="margin-bottom: 24px;">
                  <h4 style="margin: 0 0 8px 0; font-size: 16.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: ${accentColor}; page-break-after: avoid;">
                     ${icons.dollarSign} ${signatureMethod !== "SELF" ? "سادساً" : "خامساً"}: الجدول الزمني للدفعات المالية
                  </h4>
                  <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 15.5px; border: 1px solid ${accentColor}; background-color: transparent; margin-bottom: 0;">
                    <thead style="background-color: ${accentColor}; color: #fff; font-weight: 900;">
                      <tr>
                        <th style="padding: 10px; border: 1px solid ${accentColor}; width: 20%;">الدفعة</th>
                        <th style="padding: 10px; border: 1px solid ${accentColor}; width: 15%;">النسبة (%)</th>
                        <th style="padding: 10px; border: 1px solid ${accentColor}; width: 25%;">المبلغ (شامل الضريبة)</th>
                        <th style="padding: 10px; border: 1px solid ${accentColor}; width: 40%;">الاستحقاق</th>
                      </tr>
                    </thead>
                    <tbody class="font-bold text-[#123f59]">
                      ${paymentsList
                        .map(
                          (payment, index) => `
                      <tr>
                        <td style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); background-color: rgba(248,250,252,0.5);">${payment.label || `الدفعة ${index + 1}`}</td>
                        <td class="font-mono text-slate-700" style="padding: 8px; border: 1px solid rgba(18,63,89,0.267); text-align: center;">${payment.percentage || Math.round(100 / paymentsList.length)}%</td>
                        <td class="font-mono font-black text-emerald-800" style="background-color: rgba(236,253,245,0.2); padding: 8px; border: 1px solid rgba(18,63,89,0.267); text-align: center;">${formatCurrency(payment.amount)} ر.س</td>
                        <td class="text-right text-[#556575]" style="padding: 8px 12px; border: 1px solid rgba(18,63,89,0.267); line-height: 1.5;">${payment.condition || "حسب الاتفاق وجداول إنجاز الأعمال الفنية"}</td>
                      </tr>`,
                        )
                        .join("")}
                      
                      ${
                        acceptedMethodsList && acceptedMethodsList.length > 0
                          ? `
                      <tr class="bg-transparent">
                        <td colspan="4" class="text-right text-[15.5px] text-[#475569]" style="padding: 12px; border: 1px solid rgba(18,63,89,0.267);">
                          <div style="margin-bottom: 4px; display: flex; flex-direction: column; gap: 12px;">
                            <div>
                              <span class="font-black text-slate-800 ml-2">طرق السداد المتاحة:</span>
                              ${acceptedMethodsList.map((m) => paymentMethodsLabels[m] || m).join(" ، ")}
                            </div>
                            ${bankAccountsHTML}
                          </div>
                        </td>
                      </tr>`
                          : ""
                      }
                    </tbody>
                  </table>
                </div>`
                    : ""
                }

                ${
                  showMissingDocs && missingDocs && missingDocs.trim() !== ""
                    ? `
                <div class="avoid-break bg-transparent" style="margin-bottom: 24px;">
                  <h4 style="margin: 0 0 12px 0; font-size: 15.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: ${accentColor};">
                     ${icons.folderOpen} ${signatureMethod !== "SELF" ? "سابعاً" : "سادساً"}: المستندات والمسوغات المطلوب توفيرها من طرفكم لبدء العمل
                  </h4>
                  <div style="border: 1px solid rgba(18,63,89,0.2); border-radius: 14px; background-color: transparent; overflow: hidden; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
                    <div style="background-color: rgba(18,63,89,0.04); padding: 10px 16px; border-bottom: 1px solid rgba(18,63,89,0.13); display: flex; align-items: center; gap: 8px;">
                      ${icons.alertTriangle}
                      <span style="color: ${accentColor}; font-weight: 900; font-size: 15px;">نأمل منكم التكرم بتجهيز المستندات التالية وتسليمها إلي الطرف الأول ليتسنى لنا البدء في تنفيذ الأعمال:</span>
                    </div>
                    <div style="padding: 16px;">
                      <div style="display: block;">
                        ${missingDocs
                          .split(/\r?\n/)
                          .filter((d) => d.trim() !== "")
                          .map(
                            (doc, idx) => `
                          <div style="display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 8px; background-color: transparent; border: 1px solid rgba(241,245,249,0.5); margin-bottom: 8px; page-break-inside: avoid;">
                            <span style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; font-size: 14px; font-weight: bold; color: #fff; background-color: ${accentColor}; margin-top: 2px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
                              ${idx + 1}
                            </span>
                            <span style="font-size: 16px; font-weight: bold; color: #334155; line-height: 1.375;">${doc.replace(/^- /, "").trim()}</span>
                          </div>`,
                          )
                          .join("")}
                      </div>
                    </div>
                  </div>
                </div>`
                    : ""
                }

                <div class="bg-transparent" style="margin-bottom: 32px;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; page-break-after: avoid;">
                    <h4 style="margin: 0; font-size: 16.5px; font-weight: 900; color: ${accentColor};">
                       ${signatureMethod !== "SELF" ? "ثامناً" : "سابعاً"}: الشروط والأحكام والالتزامات العامة
                    </h4>
                  </div>
                  <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 15.5px; border: 1px solid ${accentColor}; background-color: transparent; margin-bottom: 0;">
                    <thead style="background-color: ${accentColor}; color: white; font-weight: 900;">
                      <tr>
                        <th style="padding: 8px; border: 1px solid ${accentColor}; width: 6%; text-align: center;">م</th>
                        <th style="padding: 8px; border: 1px solid ${accentColor}; width: 94%;">وصف الشرط / الالتزام</th>
                      </tr>
                    </thead>
                    <tbody style="font-weight: bold; color: #123f59;">
                      ${termsHtmlRows}
                    </tbody>
                  </table>
                </div>

                ${
                  conclusion && conclusion.trim() !== ""
                    ? `
                <div class="avoid-break bg-transparent" style="margin-bottom: 32px;">
                  <div style="padding: 16px 32px; background-color: rgba(248, 250, 252, 0.4); border: 1px dashed ${accentColor}44; border-radius: 8px; font-size: 16px; font-weight: bold; color: #475569; line-height: 26px; white-space: pre-wrap; text-align: center;">
                    ${conclusion}
                  </div>
                </div>`
                    : ""
                }

                <div class="avoid-break bg-transparent" style="margin-top: 32px; padding-top: 16px;">
                  <h4 style="text-align: center; font-size: 17.5px; font-weight: 900; color: ${accentColor}; margin-bottom: 16px;">صيغة الاعتماد والموافقة النهائية والتواقيع الرسمية</h4>
                  <table style="border: 2px solid ${accentColor}; font-size: 15px; width: 100%; table-layout: fixed; background: transparent;">
                    <thead style="background-color: ${accentColor}; color: #fff; font-weight: 900; font-size: 16.5px; text-align: center;">
                      <tr>
                        <th style="width: 50%; padding: 10px; border-left: 1px solid rgba(18,63,89,0.267);">الطرف الثاني: اعتماد المالك أو المستفيد أو من يمثله</th>
                        <th style="width: 50%; padding: 10px;">الطرف الأول: اعتماد مقدم الخدمة</th>
                      </tr>
                    </thead>
                    <tbody class="font-bold text-[#123f59]">
                      <tr>
                        <td style="padding: 12px; vertical-align: top; border-left: 1px solid rgba(18,63,89,0.267); border-bottom: none;">
                          <div style="display: flex; flex-direction: column; gap: 12px; line-height: 1.6;">
                            <div><span style="color: #64748b; font-weight: bold;">اسم الجهة / العميل:</span> <span style="font-weight: 900; color: #1e293b;">${clientNameForPreview || "---"}</span></div>
                            <div><span style="color: #64748b; font-weight: bold;">يمثلها في التوقيع:</span> <span style="font-weight: 900; color: #1e293b;">${signatureMethod === "SELF" ? "المالك الفعلي ذو العلاقة" : repName || "............................"}</span></div>
                            <div><span style="color: #64748b; font-weight: bold;">الصفة والتمثيل الكياني:</span> <span style="font-weight: 900; color: #1e293b;">${signatureMethod === "SELF" ? "عن نفسه (المالك الأصلي)" : signatureMethod === "AGENT" ? "وكيل شرعي" : signatureMethod === "AUTHORIZED" ? "مفوض نظامي" : "مستفيد"}</span></div>
                            
                            ${
                              signatureMethod !== "SELF"
                                ? `
                            <div><span style="color: #64748b; font-weight: bold;">رقم الهوية / السجل:</span> <span class="font-mono" style="font-weight: 900; color: #1e293b;">${repIdNumber || "............................"}</span></div>
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                              <div>
                                <span style="color: #64748b; font-weight: bold;">مستند التمثيل (${authDocType === "مستند انتفاع" && customUsufructType ? customUsufructType : authDocType || "الوكالة/التفويض"}):</span> 
                                <span class="font-mono" style="font-weight: 900; color: #164e63;">${authDocNumber ? `${authDocNumber}` : "............................"}</span>
                              </div>
                              ${
                                showAuthDocIssueDate || showAuthDocExpiryDate
                                  ? `
                              <div style="display: flex; align-items: center; gap: 16px; font-size: 14px; margin-top: 2px;">
                                ${showAuthDocIssueDate && authDocIssueDate ? `<span style="color: #64748b;">تاريخ الإصدار: <span class="font-mono" style="color: #334155; font-weight: bold;">${formatDateParts(authDocIssueDate).gregorian}</span></span>` : ""}
                                ${showAuthDocExpiryDate && authDocExpiryDate ? `<span style="color: #64748b;">تاريخ الانتهاء: <span class="font-mono" style="color: #e11d48; font-weight: bold;">${formatDateParts(authDocExpiryDate).gregorian}</span></span>` : ""}
                              </div>`
                                  : ""
                              }
                            </div>`
                                : ""
                            }
                            
                            <div><span style="color: #64748b; font-weight: bold;">رقم الجوال:</span> <span class="font-mono" style="font-weight: 900; color: #1e293b;">${repPhone || "............................"}</span></div>
                            <div style="margin-top: 24px; text-align: center; color: #94a3b8; font-weight: bold;">التوقيع الشخصي والختم:<br/><span style="display: inline-block; margin-top: 16px;">........................................</span></div>
                          </div>
                        </td>
                        <td style="padding: 12px; vertical-align: top; border-bottom: none;">
                          <div style="display: flex; flex-direction: column; gap: 12px; line-height: 1.6;">
                            <div><span style="color: #64748b; font-weight: bold;">اسم المنشأة الهندسية:</span> <span style="font-weight: 900; color: #1e293b;">شركة ديتيلز كونسولتس | Details consults</span></div>
                            <div><span style="color: #64748b; font-weight: bold;">إسم ممثل مقدم الخدمة:</span> <span style="font-weight: 900; color: #1e293b;">${firstPartyRep || "__________________"}</span></div>
                            <div><span style="color: #64748b; font-weight: bold;">صفة ممثل مقدم الخدمة:</span> <span style="font-weight: 900; color: #1e293b;">${firstPartyRepCapacity || "__________________"}</span></div>
                            ${showFirstPartyEmpId ? `<div><span style="color: #64748b; font-weight: bold;">الرقم الوظيفي:</span> <span class="font-mono" style="font-weight: 900; color: #1e293b;">${firstPartyEmpCode || "__________________"}</span></div>` : ""}
                            
                            <div style="margin-top: 24px; text-align: center; color: #94a3b8; font-weight: bold;">
                              التوقيع الشخصي :<br/>
                              ${firstPartySignatureType === "SYSTEM" && employeeSignatureUrl ? `<img src="${employeeSignatureUrl}" style="height: 64px; margin-top: 8px; margin-left: auto; margin-right: auto; mix-blend-mode: multiply; object-fit: contain;" />` : `<span style="display: inline-block; margin-top: 16px;">........................................</span>`}
                            </div>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

              </td>
            </tr>
            <tr style="height: 100%;">
              <td colspan="10" style="border: none; padding: 0;"></td>
            </tr>
          </tbody>
          <tfoot style="display: table-footer-group;">
            <tr>
              <td colspan="10" style="border: none; height: 120px; background-color: transparent;"></td>
            </tr>
          </tfoot>
          
        </table>
      </div>
    </body>
    </html>
  `;
};
// ============================================================================
// 🌟 دالة مساعدة لتوليد قالب الفوتر الثابت أسفل كل صفحة لـ Gotenberg (بدون QR Code)
// ============================================================================
const buildFooterHtml = (accentColor = "#123f59", fontFamily = "tajawal") => {
  const safeFontFamily = fontFamily.toLowerCase();
  const selectedFontBase64 = fontsBase64[safeFontFamily] || fontsBase64.tajawal;

  // 🚀 تنظيف الـ Base64 للفوتر
  const cleanBase64 = selectedFontBase64.replace(/[\r\n\s]+/g, "");

  return `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <style>
        @font-face {
          font-family: '${fontFamily}';
          src: url("data:font/ttf;base64,${cleanBase64}") format("truetype");
          font-weight: normal;
          font-style: normal;
        }

        body {
          direction: rtl;
          text-align: right;
          margin: 0;
          padding: 0;
          width: 100%;
          font-family: '${fontFamily}', sans-serif !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        
        .footer-container {
          width: 100%;
          padding: 0 40px;
          box-sizing: border-box;
        }
        
        .footer-content {
          border-top: 2.5px solid ${accentColor};
          padding-top: 12px;
          display: flex;
          width: 100%;
        }

        .text-box {
          flex: 1; 
          display: flex; 
          flex-direction: column; 
          gap: 6px;
        }

        .row-1 {
          display: flex; 
          align-items: center; 
          justify-content: space-between; /* النص يمين، ورقم الصفحة يسار */
          direction: rtl;
        }

        .address-text {
          color: ${accentColor};
          font-size: 9.5px; 
          font-weight: 900; 
          line-height: 1.4;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .page-numbers {
          font-size: 9px;
          font-weight: 900;
          color: #64748b;
          background: #f8fafc;
          padding: 3px 10px;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
          direction: rtl;
        }

        .row-2 {
          display: flex; 
          align-items: center; 
          justify-content: flex-end; /* النص الإنجليزي يبدأ من اليمين (تحت العربي) */
          gap: 8px;
          font-size: 9px; 
          font-weight: 900; 
          color: #475569;
          direction: ltr; /* اتجاه الكتابة إنجليزي */
        }

        .dot {
          opacity: 0.5;
        }
      </style>
    </head>
    <body>
      <div class="footer-container">
        <div class="footer-content">
          
          <div class="text-box">
            <div class="row-1">
              <div class="address-text">
                <span>📍 حي الملك فهد - الرياض - المملكة العربية السعودية - الرمز البريدي : ١٢٢٧٤</span>
                <span class="dot">•</span>
                <span>جوال : ٠٥٩٠٧٢٢٨٢٧</span>
                <span class="dot">•</span>
                <span>الرقم الوطني الموحد : ٧٠٥٢٣٠٣٨٢٨</span>
              </div>
              <div class="page-numbers">
                صفحة <span class="pageNumber"></span> من <span class="totalPages"></span>
              </div>
            </div>
            
            <div class="row-2">
              <span>📍 King Fahd Dist - RIYADH - Kingdom of Saudi Arabia - POSTAL CODE : 12274</span>
              <span class="dot">•</span>
              <span>📱 0590722827</span>
              <span class="dot">•</span>
              <span>🏢 N.N: 7052303828</span>
              <span class="dot">•</span>
              <span>✉ info@details-consults.sa</span>
            </div>
          </div>

        </div>
      </div>
      <script>
        // سكريبت لتحويل أرقام الصفحات إلى أرقام عربية (هندية)
        const arabicDigits = (str) => String(str).replace(/[0-9]/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
        setTimeout(() => {
          document.querySelectorAll('.pageNumber, .totalPages').forEach(el => {
            el.textContent = arabicDigits(el.textContent);
          });
        }, 0);
      </script>
    </body>
    </html>
  `;
};

// ============================================================================

const generatePdfPreview = async (req, res) => {
  try {
    const data = req.body;

    if (!data.signatureMethod) {
      data.signatureMethod =
        data.client?.representative || data.repName ? "AUTHORIZED" : "SELF";
    }
    // إنشاء قالب الـ HTML (مسودة - بدون QR)
    const htmlContent = buildQuotationHtmlTemplate(data, "", data.employeeName);

    const footerHtml = buildFooterHtml("#123f59", data.fontFamily || "tajawal");

    const form = new FormData();
    form.append("files", Buffer.from(htmlContent, "utf-8"), {
      filename: "index.html",
      contentType: "text/html",
    });
    form.append("files", Buffer.from(footerHtml, "utf-8"), {
      filename: "footer.html",
      contentType: "text/html",
    });
    form.append("paperWidth", "8.27");
    form.append("paperHeight", "11.69");
    form.append("marginTop", "0");
    form.append("marginLeft", "0");
    form.append("marginRight", "0");

    form.append("marginBottom", "1.18");
    form.append("printBackground", "true");

    const response = await axios.post(
      "http://127.0.0.1:3000/forms/chromium/convert/html", // 👈 تم التعديل هنا
      form,
      {
        headers: { ...form.getHeaders() },
        responseType: "arraybuffer",
      },
    );

    const pdfBuffer = Buffer.from(response.data);

    // 🚀 استخدام الاسم الديناميكي
    const dynamicFileName = generateQuotationFileName(data);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": pdfBuffer.length,
      // استخدام encodeURIComponent ضروري جداً لدعم اللغة العربية في أسماء الملفات المحملة للمتصفح
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(dynamicFileName)}`,
    });
    res.send(pdfBuffer);
  } catch (error) {
    console.error(
      "Error generating PDF with Gotenberg:",
      error?.response?.data?.toString() || error.message,
    );
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء توليد ملف الـ PDF عبر Gotenberg",
    });
  }
};
// ============================================================================
// دالة: توليد وحفظ الـ PDF تلقائياً (تُستدعى عند حفظ مسودة أو عرض جديد)
// ============================================================================
const generateAndSavePdf = async (req, res) => {
  try {
    const data = req.body;
    const quotationId = data.quotationId;

    if (!quotationId) {
      return res
        .status(400)
        .json({ success: false, message: "معرف العرض غير موجود" });
    }

    // 🚀 1. تطبيق نفس المعالجات الموجودة في دالة Preview لضمان عدم نقص البيانات
    if (!data.signatureMethod) {
      data.signatureMethod =
        data.client?.representative || data.repName ? "AUTHORIZED" : "SELF";
    }
    data.bgType = data.bgType || "official1";
    data.fontFamily = data.fontFamily || "tajawal";
    data.firstPartyRep =
      data.firstPartyRep || data.employeeName || "__________________";

    // توليد صورة الـ QR في حال كان العرض معتمداً
    let verificationQrImage = "";
    if (
      ["APPROVED", "SENT", "ACCEPTED", "PARTIALLY_PAID"].includes(data.status)
    ) {
      const verifyUrl =
        data.qrVerificationUrl ||
        `${process.env.FRONTEND_URL || "https://details-worksystem1.com"}/verify/quote/${data.barcodeData || quotationId}`;
      try {
        verificationQrImage = await QRCode.toDataURL(verifyUrl, {
          width: 150,
          margin: 1,
          color: { dark: "#123f59", light: "#ffffff" },
        });
      } catch (qrErr) {
        console.error("فشل توليد صورة الـ QR:", qrErr);
      }
    }

    let bankWhereClause = {};
    if (data.selectedBankAccounts && data.selectedBankAccounts.length > 0) {
      bankWhereClause = { id: { in: data.selectedBankAccounts } };
    }

    const allBanks = await prisma.bankAccount.findMany({
      where: bankWhereClause,
    });
    data.bankAccountsData = allBanks;

    // إنشاء قالب الـ HTML
    const htmlContent = buildQuotationHtmlTemplate(
      data,
      verificationQrImage,
      data.employeeName,
    );

    const footerHtml = buildFooterHtml("#123f59", data.fontFamily);

    const form = new FormData();
    form.append("files", Buffer.from(htmlContent, "utf-8"), {
      filename: "index.html",
      contentType: "text/html",
    });
    form.append("files", Buffer.from(footerHtml, "utf-8"), {
      filename: "footer.html",
      contentType: "text/html",
    });
    form.append("paperWidth", "8.27");
    form.append("paperHeight", "11.69");
    form.append("marginTop", "0");
    form.append("marginLeft", "0");
    form.append("marginRight", "0");
    form.append("marginBottom", "1.18");
    form.append("printBackground", "true");

    const response = await axios.post(
      "http://127.0.0.1:3000/forms/chromium/convert/html",
      form,
      { headers: { ...form.getHeaders() }, responseType: "arraybuffer" },
    );

    const pdfBuffer = Buffer.from(response.data);
    const uploadsDir = path.join(__dirname, "../../uploads/quotations");
    if (!fs.existsSync(uploadsDir))
      fs.mkdirSync(uploadsDir, { recursive: true });

    // 🚀 استخدام الاسم الديناميكي مع إضافة طابع زمني لمنع تكرار الاسم في نفس اليوم
    const baseFileName = generateQuotationFileName(data);
    const fileName = baseFileName.replace(".pdf", `_${Date.now()}.pdf`);

    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, pdfBuffer);

    const fileUrl = `/uploads/quotations/${fileName}`;
    await prisma.quotation.update({
      where: { id: quotationId },
      data: { pdfUrl: fileUrl },
    });

    res.json({
      success: true,
      pdfUrl: fileUrl,
      message: "تم توليد وحفظ الوثيقة بنجاح",
    });
  } catch (error) {
    console.error(
      "❌ [BACKEND - CRITICAL ERROR]:",
      error.response?.data?.toString() || error.message,
    );
    res.status(500).json({
      success: false,
      message: "فشل توليد وحفظ الملف",
      error: error.message,
    });
  }
};
// 🚀 دوال مساعدة لترجمة البيانات القديمة المحفوظة بالإنجليزية قبل الطباعة
const translateTitle = (val) => {
  if (!val) return "المواطن";
  const upper = val.toUpperCase();
  if (upper === "MR") return "المواطن";
  if (upper === "MRS") return "المواطنة";
  if (upper === "COMPANY") return "الشركة";
  if (upper === "INSTITUTION") return "المؤسسة";
  return val; // إذا كان لقباً مخصصاً بالعربي، سيتركه كما هو
};

const translateHandling = (val) => {
  if (!val) return "المالك مباشرة";
  const upper = val.toUpperCase();
  if (upper === "DIRECT") return "المالك مباشرة";
  if (upper === "AGENT") return "وكيل بموجب وكالة";
  if (upper === "AUTHORIZED") return "مفوض بموجب تفويض";
  if (upper === "BENEFICIARY") return "ناظر وقف / مستفيد";
  return val; // إذا كانت صفة مخصصة بالعربي، سيتركها كما هي
};

const approveQuotationWorkflow = async (req, res) => {
  console.log("=========================================");
  console.log("▶️ [BACKEND - APPROVAL] بدء الاعتماد وتوليد الـ PDF الاحترافي");

  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userName = req.user?.name || "المشرف";
    const reqData = req.body || {};

    const quote = await prisma.quotation.findUnique({
      where: { id },
      include: {
        client: true,
        ownership: true,
        transaction: true,
        meetingMinute: true,
        transactionType: true,
        firstPartyEmployee: true,
        items: { orderBy: { order: "asc" } },
        payments: { orderBy: { installmentNumber: "asc" } },
      },
    });

    if (!quote || quote.status !== "PENDING_APPROVAL") {
      return res.status(400).json({
        success: false,
        message: "العرض ليس قيد المراجعة أو تم اعتماده مسبقاً",
      });
    }

    const randomStr = crypto.randomBytes(3).toString("hex").toUpperCase();
    const barcodeData = `815-${quote.number}-${randomStr}`;
    const qrVerificationUrl = `${process.env.FRONTEND_URL || "https://details-worksystem1.com"}/verify/quote/${barcodeData}`;
    const securityHash = crypto
      .createHash("sha256")
      .update(`${quote.number}-${quote.total}`)
      .digest("hex");

    let verificationQrImage = "";
    try {
      verificationQrImage = await QRCode.toDataURL(qrVerificationUrl, {
        width: 150,
        margin: 1,
        color: { dark: "#123f59", light: "#ffffff" },
      });
    } catch (err) {}

    const updatedQuote = await prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.update({
        where: { id },
        data: {
          status: "APPROVED",
          isStamped: true,
          stampType: "SECURE_QR",
          stampedAt: new Date(),
          approvedBy: { connect: { id: userId } },
          barcodeData,
          qrVerificationUrl,
          securityHash,
          ...(reqData.clientTitle && {
            clientTitle: translateTitle(reqData.clientTitle),
          }),
          ...(reqData.handlingMethod && {
            handlingMethod: translateHandling(reqData.handlingMethod),
          }),
          ...(reqData.secondPartyName && {
            secondPartyName: reqData.secondPartyName,
          }),
          ...(reqData.secondPartyRep && {
            secondPartyRep: reqData.secondPartyRep,
          }),
          ...(reqData.transactionTypeName && {
            transactionTypeName: reqData.transactionTypeName,
          }),
        },
      });
      await tx.quotationLog.create({
        data: {
          quotationId: id,
          action: "APPROVE",
          fromStatus: quote.status,
          toStatus: "APPROVED",
          userId,
          userName,
          notes: "تم الاعتماد وتوليد الـ PDF",
        },
      });
      return updated;
    });

    let parsedPlots = [];
    try {
      if (quote.ownership?.plots)
        parsedPlots =
          typeof quote.ownership.plots === "string"
            ? JSON.parse(quote.ownership.plots)
            : quote.ownership.plots;
    } catch (e) {}

    let parsedStartConditions = ["DOCUMENTS_RECEIVED"];
    try {
      if (quote.startConditions)
        parsedStartConditions =
          typeof quote.startConditions === "string"
            ? JSON.parse(quote.startConditions)
            : quote.startConditions;
    } catch (e) {}

    const allBanks = await prisma.bankAccount.findMany();
    const parsedAcceptedMethods =
      typeof quote.acceptedMethods === "string"
        ? JSON.parse(quote.acceptedMethods)
        : quote.acceptedMethods || ["bank"];

    const mappedTimelineItems = (reqData.items || quote.items || [])
      .filter(
        (i) =>
          i.executionDuration !== null && i.executionDuration !== undefined,
      )
      .map((i, idx) => ({
        id: `time_${Date.now()}_${idx}`,
        itemId: String(i.id),
        duration: i.executionDuration,
        unit: i.durationUnit || quote.durationUnit || "WORKING_DAY",
        notes: i.timelineNotes || "",
        showInQuote: i.showInTimeline !== false,
      }));

    const timelineState = reqData.timelineState || {
      showTimeline: reqData.showTimeline ?? quote.showTimeline ?? true,
      totalDuration: reqData.totalDuration || quote.totalDuration || 20,
      durationUnit: reqData.durationUnit || quote.durationUnit || "WORKING_DAY",
      startConditions: reqData.startConditions || parsedStartConditions,
      customStartDate:
        reqData.customStartDate ||
        (quote.customStartDate ? quote.customStartDate.toISOString() : ""),
      showEndDate: reqData.showEndDate ?? quote.showEndDate ?? false,
      timelineItems: mappedTimelineItems,
      showTimelineNotes:
        reqData.showTimelineNotes ?? quote.showTimelineNotes ?? true,
      timelineNotes:
        reqData.timelineNotes ||
        quote.timelineNotes ||
        "المدة الموضحة أعلاه تقديرية...",
    };

    // 💡 سحب اسم النموذج الفعلي
    let templateTitle =
      quote.templateType === "DETAILED"
        ? "عرض سعر تفصيلي"
        : "عرض سعر فني ومالي";
    if (quote.templateId) {
      try {
        const tpl = await prisma.quotationTemplate.findUnique({
          where: { id: quote.templateId },
        });
        if (tpl && tpl.title) templateTitle = tpl.title;
      } catch (e) {}
    }

    // 5. 🌟 تجهيز البيانات النهائية
    const data = {
      ...reqData,
      quotationId: quote.id,

      documentType:
        reqData.documentTitle ||
        quote.documentTitle ||
        reqData.documentType ||
        templateTitle,
      transactionType:
        reqData.transactionTypeName ||
        reqData.transactionType ||
        quote.transactionTypeName ||
        quote.transactionType?.name ||
        "خدمات هندسية واستشارية استراتيجية",

      showSummaryTable:
        reqData.showSummaryTable ?? quote.showSummaryTable ?? true,
      showPropertyCode: reqData.showPropertyCode ?? quote.showPropertyCode,
      showMissingDocs: reqData.showMissingDocs ?? quote.showMissingDocs,
      showFirstPartyEmpId:
        reqData.showFirstPartyEmpId ?? quote.showFirstPartyEmpId ?? true,

      licenseNumber: reqData.licenseNumber || quote.licenseNumber,
      subject: reqData.subject || quote.subject,
      address: reqData.address || quote.address,
      licenseYear: reqData.licenseYear || quote.licenseYear,
      serviceNumber: reqData.serviceNumber || quote.serviceNumber,
      serviceYear: reqData.serviceYear || quote.serviceYear,

      clientTitle: translateTitle(reqData.clientTitle || quote.clientTitle),
      handlingMethod: translateHandling(
        reqData.handlingMethod || quote.handlingMethod,
      ),

      clientNameForPreview:
        reqData.clientNameForPreview ||
        reqData.secondPartyName ||
        quote.secondPartyName ||
        quote.client?.name?.ar ||
        quote.client?.name ||
        "عميل غير محدد",
      clientCodeForPreview:
        reqData.clientCodeForPreview || quote.client?.clientCode || "---",
      validityDays: reqData.validityDays || quote.validityDays,
      propertyCodeForPreview:
        reqData.propertyCodeForPreview || quote.ownership?.code || "---",
      termsText: reqData.termsText || quote.terms,
      conclusion: reqData.conclusion || quote.conclusion,

      items:
        reqData.items?.length > 0
          ? reqData.items
          : quote.items.map((i) => ({ ...i, qty: i.quantity })),
      subtotal: reqData.subtotal || quote.subtotal,
      taxAmount: reqData.taxAmount || quote.taxAmount,
      grandTotal: reqData.grandTotal || quote.total,
      officeTaxBearing: reqData.officeTaxBearing || quote.officeTaxBearing,
      paymentsList:
        reqData.paymentsList?.length > 0
          ? reqData.paymentsList
          : quote.payments.map((p) => ({
              percentage: p.percentage,
              amount: p.amount,
              condition: p.dueCondition,
              label: `الدفعة ${p.installmentNumber}`,
            })),

      showQuantity: true,
      plots: reqData.plots?.length > 0 ? reqData.plots : parsedPlots,
      employeeName: reqData.employeeName || userName,
      employeeId: reqData.employeeId || userId,
      taxRate: reqData.taxRate || quote.taxRate * 100,
      acceptedMethods:
        reqData.acceptedMethods?.length > 0
          ? reqData.acceptedMethods
          : parsedAcceptedMethods,
      missingDocs: reqData.missingDocs || quote.missingDocs,
      deedNumber: reqData.deedNumber || quote.ownership?.deedNumber,

      clientType:
        reqData.clientType || quote.clientType || quote.client?.type || "فرد",
      signatureMethod:
        reqData.signatureMethod ||
        quote.signatureMethod ||
        (quote.client?.representative ? "AUTHORIZED" : "SELF"),
      repName:
        reqData.repName ||
        quote.repName ||
        quote.client?.representative?.name ||
        "",
      repIdNumber:
        reqData.repIdNumber ||
        quote.repIdNumber ||
        quote.client?.representative?.idNumber ||
        "",
      repPhone:
        reqData.repPhone ||
        quote.repPhone ||
        quote.client?.mobile ||
        quote.client?.contact?.mobile ||
        "",
      repCapacity:
        reqData.repCapacity ||
        quote.repCapacity ||
        quote.client?.representative?.type ||
        "",

      authDocType:
        reqData.authDocType ||
        quote.authDocType ||
        (quote.client?.representative?.type === "وكيل" ? "وكالة" : "تفويض"),
      authDocNumber:
        reqData.authDocNumber ||
        quote.authDocNumber ||
        quote.client?.representative?.docNumber ||
        "",
      authDocDate: reqData.authDocDate || quote.authDocDate || "",
      authDocIssueDate: reqData.authDocIssueDate || quote.authDocIssueDate,
      showAuthDocIssueDate:
        reqData.showAuthDocIssueDate ?? quote.showAuthDocIssueDate,
      authDocExpiryDate: reqData.authDocExpiryDate || quote.authDocExpiryDate,
      showAuthDocExpiryDate:
        reqData.showAuthDocExpiryDate ?? quote.showAuthDocExpiryDate,
      customUsufructType:
        reqData.customUsufructType || quote.customUsufructType,

      issueDate: reqData.issueDate || quote.issueDate,

      // 🚀 ربط الأسماء والأرقام بشكل ذكي مع القيم المطلوبة
      firstPartyName: reqData.firstPartyName || quote.firstPartyName,
      firstPartyRep:
        reqData.firstPartyRep ||
        quote.firstPartyRep ||
        quote.firstPartyEmployee?.name ||
        quote.firstPartyEmployee?.fullName ||
        "المدير العام",
      firstPartyRepCapacity:
        reqData.firstPartyRepCapacity ||
        quote.firstPartyRepCapacity ||
        "إدارة المشاريع وعقود العملاء",
      firstPartyEmpCode:
        reqData.firstPartyEmpCode ||
        quote.firstPartyEmployee?.employeeCode ||
        "EMP-ADMIN-01",

      secondPartyName:
        reqData.secondPartyName ||
        quote.secondPartyName ||
        quote.client?.name?.ar ||
        quote.client?.name,
      secondPartyRep: reqData.secondPartyRep || quote.secondPartyRep || "",
      selectedBankAccounts:
        reqData.selectedBankAccounts?.length > 0
          ? reqData.selectedBankAccounts
          : allBanks.map((b) => b.id),
      bankAccountsData: allBanks,
      propertyDistrict:
        reqData.propertyDistrict || quote.ownership?.district || "---",
      propertyPlanNumber:
        reqData.propertyPlanNumber || quote.ownership?.planNumber || "---",

      status: "APPROVED",
      transactionRefForPreview:
        reqData.transactionRefForPreview ||
        quote.transaction?.transactionCode ||
        "",
      meetingTitleForPreview:
        reqData.meetingTitleForPreview || quote.meetingMinute?.title || "",
      firstPartySignatureType:
        reqData.firstPartySignatureType ||
        quote.firstPartySignatureType ||
        "MANUAL",
      employeeSignatureUrl:
        reqData.employeeSignatureUrl ||
        quote.firstPartyEmployee?.signatureUrl ||
        null,
      bgType: reqData.bgType || quote.bgType || "official1",
      fontFamily: reqData.fontFamily || quote.fontFamily || "tajawal",
      referenceNumber: reqData.referenceNumber || quote.number,
      timelineState: timelineState,
    };

    const htmlContent = buildQuotationHtmlTemplate(
      data,
      verificationQrImage,
      userName,
    );
    const footerHtml = buildFooterHtml("#123f59", data.fontFamily);

    const form = new FormData();
    form.append("files", Buffer.from(htmlContent, "utf-8"), {
      filename: "index.html",
      contentType: "text/html",
    });
    form.append("files", Buffer.from(footerHtml, "utf-8"), {
      filename: "footer.html",
      contentType: "text/html",
    });
    form.append("paperWidth", "8.27");
    form.append("paperHeight", "11.69");
    form.append("marginTop", "0");
    form.append("marginLeft", "0");
    form.append("marginRight", "0");
    form.append("marginBottom", "1.18");
    form.append("printBackground", "true");

    const response = await axios.post(
      "http://127.0.0.1:3000/forms/chromium/convert/html",
      form,
      { headers: { ...form.getHeaders() }, responseType: "arraybuffer" },
    );

    const uploadsDir = path.join(__dirname, "../../uploads/quotations");
    if (!fs.existsSync(uploadsDir))
      fs.mkdirSync(uploadsDir, { recursive: true });

    // 🚀 استخدام الاسم الديناميكي للاعتماد النهائي
    const baseFileName = generateQuotationFileName(data);
    const fileName = baseFileName.replace(".pdf", `_${Date.now()}.pdf`);

    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(response.data));
    const fileUrl = `/uploads/quotations/${fileName}`;

    console.log(`✅ [BACKEND - APPROVAL] تم توليد وحفظ الـ PDF في: ${fileUrl}`);

    // 1. تحديث مسار الملف في قاعدة البيانات
    const finalUpdate = await prisma.quotation.update({
      where: { id },
      data: { pdfUrl: fileUrl },
    });

    // 2. إرسال الاستجابة (تأكد أن هذا هو السطر الوحيد لـ res.json في نهاية الدالة)
    return res.json({
      success: true,
      message: "تم الاعتماد وتوليد الـ PDF والختم بنجاح",
      data: finalUpdate,
    });
  } catch (error) {
    console.error("❌ [BACKEND - APPROVAL ERROR]:", error);

    // 3. 🛡️ حماية ذكية: لا ترسل استجابة خطأ إذا تم إرسال استجابة سابقة بالفعل
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: error.message || "حدث خطأ أثناء الاعتماد والتوليد",
      });
    }
  }
};

// ===============================================
// 6. جلب الإحصائيات (للداشبورد)
// GET /api/quotations/stats
// ===============================================
const getQuotationStats = async (req, res) => {
  try {
    // 👈 لا تحسب العروض التي في سلة المحذوفات
    const allQuotes = await prisma.quotation.findMany({
      where: {
        status: { not: "TRASHED" },
      },
    });

    let stats = {
      totalQuotations: allQuotes?.length || 0,
      pendingApproval: 0,
      awaitingSignature: 0,
      approvedPendingPayment: 0,
      partiallyPaid: 0,
      fullyPaid: 0,
      expired: 0,
      cancelled: 0,
      totalValue: 0,
      totalCollected: 0,
      avgApprovalDays: 0,
      approvalRate: 0,
      noResponseRate: 0,
      totalSent: 0,
    };

    if (!allQuotes || allQuotes.length === 0) {
      return res.status(200).json({ success: true, data: stats });
    }

    let approvedCount = 0;

    allQuotes.forEach((q) => {
      // (باقي كود حساب الإحصائيات يبقى كما هو بدون تغيير)
      if (q.status === "PENDING_APPROVAL") {
        stats.pendingApproval++;
      } else if (q.status === "SENT") {
        stats.awaitingSignature++;
        stats.totalSent++;
      } else if (q.status === "APPROVED") {
        stats.approvedPendingPayment++;
        approvedCount++;
        stats.totalSent++;
      } else if (q.status === "PARTIALLY_PAID") {
        stats.partiallyPaid++;
        approvedCount++;
        stats.totalSent++;
      } else if (q.status === "ACCEPTED") {
        stats.fullyPaid++;
        approvedCount++;
        stats.totalSent++;
      } else if (q.status === "EXPIRED") {
        stats.expired++;
        stats.totalSent++;
      } else if (
        ["REJECTED", "CANCELLED", "REFUND_IN_PROGRESS", "REFUNDED"].includes(
          q.status,
        )
      ) {
        stats.cancelled++;
        if (q.status === "REJECTED") stats.totalSent++;
      }

      if (
        [
          "PENDING_APPROVAL",
          "APPROVED",
          "SENT",
          "ACCEPTED",
          "PARTIALLY_PAID",
        ].includes(q.status)
      ) {
        stats.totalValue += Number(q.total) || 0;
      }

      stats.totalCollected += Number(q.collectedAmount) || 0;
    });

    if (stats.totalSent > 0) {
      stats.approvalRate = Math.round((approvedCount / stats.totalSent) * 100);
      stats.noResponseRate = Math.round(
        (stats.expired / stats.totalSent) * 100,
      );
    }

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error("Stats Error:", error);
    res.status(500).json({ success: false, message: "خطأ في حساب الإحصائيات" });
  }
};

// ===============================================
// 7. تسجيل دفعة مالية لعرض السعر
// POST /api/quotations/:id/payments
// ===============================================
const recordPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body; // نستقبل المبلغ المدفوع من الواجهة

    // 1. البحث عن العرض
    const quotation = await prisma.quotation.findUnique({ where: { id } });
    if (!quotation) {
      return res
        .status(404)
        .json({ success: false, message: "عرض السعر غير موجود" });
    }

    // 2. حساب المبلغ المحصل الجديد
    const currentCollected = Number(quotation.collectedAmount) || 0;
    const paymentAmount = Number(amount) || 0;
    const newCollected = currentCollected + paymentAmount;

    // 3. تحديد الحالة الجديدة (مسدد جزئياً أو كلياً)
    let newStatus = quotation.status;
    if (newCollected >= Number(quotation.total)) {
      newStatus = "ACCEPTED"; // مسدد بالكامل
    } else if (newCollected > 0) {
      newStatus = "PARTIALLY_PAID"; // مسدد جزئياً
    }

    // 4. تحديث العرض في قاعدة البيانات
    const updatedQuotation = await prisma.quotation.update({
      where: { id },
      data: {
        collectedAmount: newCollected,
        status: newStatus,
      },
    });

    res.status(200).json({
      success: true,
      message: "تم تسجيل الدفعة بنجاح",
      data: updatedQuotation,
    });
  } catch (error) {
    console.error("Payment Record Error:", error);
    res.status(500).json({ success: false, message: "فشل تسجيل الدفعة" });
  }
};

// ===============================================
// 8. تطبيق الختم على العرض
// PATCH /api/quotations/:id/stamp
// ===============================================
const stampQuotation = async (req, res) => {
  try {
    const { id } = req.params;

    const updatedQuotation = await prisma.quotation.update({
      where: { id },
      data: {
        isStamped: true,
        stampedAt: new Date(),
        stampedBy: req.user?.id || "System", // يفترض أن لديك نظام Auth
        status: "APPROVED", // غالباً الختم يعني اعتماد العرض
      },
    });

    res.status(200).json({
      success: true,
      message: "تم ختم العرض بنجاح",
      data: updatedQuotation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل ختم العرض" });
  }
};

// ===============================================
// 9. تطبيق التوقيع الإلكتروني على العرض
// PATCH /api/quotations/:id/sign
// ===============================================
const signQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const { signatureHash } = req.body;

    const updatedQuotation = await prisma.quotation.update({
      where: { id },
      data: {
        isSigned: true,
        signedAt: new Date(),
        signedBy: req.user?.id || "System",
        signatureHash: signatureHash || "N/A",
        status: "SENT", // التوقيع غالباً يجهز العرض للإرسال للمالك
      },
    });

    res.status(200).json({
      success: true,
      message: "تم التوقيع الإلكتروني بنجاح",
      data: updatedQuotation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل التوقيع" });
  }
};

const toArabicDigits = (value) =>
  String(value ?? "").replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);

const getDatePart = (formatter, date, type) =>
  formatter.formatToParts(date).find((part) => part.type === type)?.value || "";

const formatDateParts = (value) => {
  const date = value ? new Date(value) : new Date();
  const dayName = new Intl.DateTimeFormat("ar-SA", { weekday: "long" }).format(
    date,
  );
  if (Number.isNaN(date.getTime()))
    return { gregorian: value, hijri: value, combined: value };
  const gregorianFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const hijriFormatter = new Intl.DateTimeFormat(
    "ar-SA-u-ca-islamic-umalqura",
    { year: "numeric", month: "2-digit", day: "2-digit" },
  );
  const gregorian = `${getDatePart(gregorianFormatter, date, "day")}/${getDatePart(gregorianFormatter, date, "month")}/${getDatePart(gregorianFormatter, date, "year")}`;

  const hijri = toArabicDigits(
    `${getDatePart(hijriFormatter, date, "day")}/${getDatePart(hijriFormatter, date, "month")}/${getDatePart(hijriFormatter, date, "year")}`,
  );
  return {
    gregorian,
    hijri,
    combined: `${dayName}، ميلادي: ${gregorian} / هجري: ${hijri}`,
    dayName,
  };
};

// ===============================================
// 🌟 التحقق من صحة العرض (Public Endpoint)
// ===============================================
const verifyQuotation = async (req, res) => {
  try {
    const { barcode } = req.params;
    console.log("🔍 [VERIFY API] Barcode received:", barcode);

    if (!barcode) {
      return res
        .status(400)
        .json({ success: false, message: "رمز التحقق مفقود" });
    }

    // 🌟 تنظيف الباركود من أي مسافات أو علامات غير مرغوبة
    const cleanBarcode = barcode.trim();

    // 🌟 البحث الذكي: نبحث بالباركود، وإذا لم نجده نبحث بالـ ID (دعم للملفات القديمة)
    const quote = await prisma.quotation.findFirst({
      where: {
        OR: [{ barcodeData: cleanBarcode }, { id: cleanBarcode }],
      },
      select: {
        number: true,
        issueDate: true,
        total: true,
        status: true,
        stampedAt: true,
        pdfUrl: true,
        client: { select: { name: true } },
        transactionType: { select: { name: true } },
      },
    });

    if (!quote) {
      console.log("❌ [VERIFY API] No quotation found for:", cleanBarcode);
      return res.status(404).json({
        success: false,
        message: "وثيقة غير صالحة أو غير مسجلة بالنظام",
      });
    }

    console.log("✅ [VERIFY API] Quotation Valid:", quote.number);
    res.json({ success: true, data: quote });
  } catch (error) {
    console.error("❌ [VERIFY API Error]:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ في السيرفر أثناء التحقق" });
  }
};

module.exports = {
  createQuotation,
  getAllQuotations,
  getQuotationById,
  updateQuotation,
  deleteQuotation,
  hardDeleteQuotation,
  restoreFromTrash,
  getQuotationStats,
  recordPayment,
  stampQuotation,
  signQuotation,
  generatePdfPreview,
  generateAndSavePdf,
  submitForApproval, // جديد
  requestModification, // جديد
  rejectQuotationWorkflow, // جديد
  approveQuotationWorkflow, // جديد
  verifyQuotation,
  uploadTempAttachments,
};

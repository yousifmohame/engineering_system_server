// src/controllers/quotationController.js
const prisma = require("../utils/prisma");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

// ==========================================
// دالة مساعدة: حفظ المرفقات (Base64 إلى ملفات)
// ==========================================
const processAndSaveAttachments = (attachments, userId) => {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0)
    return [];

  const uploadDir = path.join(
    __dirname,
    "../../uploads/quotations/attachments",
  );
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const processedFiles = [];

  for (const att of attachments) {
    // 1. إذا كان الملف موجوداً مسبقاً (في حالة التحديث)
    if (att.filePath || !att.fileData) continue;

    // 2. معالجة الـ Base64
    const matches = att.fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) continue;

    const fileType = matches[1];
    const buffer = Buffer.from(matches[2], "base64");

    // استخراج الامتداد الأصلي أو توليده
    const extension = att.name.includes(".")
      ? att.name.split(".").pop()
      : fileType.split("/")[1];
    const safeName = att.name.replace(/[^a-zA-Z0-9.\-]/g, "_");
    const fileName = `ATT_${Date.now()}_${Math.round(Math.random() * 1000)}.${extension}`;
    const filePath = path.join(uploadDir, fileName);

    // كتابة الملف في السيرفر
    fs.writeFileSync(filePath, buffer);

    processedFiles.push({
      fileName: att.name,
      filePath: `/uploads/quotations/attachments/${fileName}`,
      fileType: att.type || fileType,
      fileSize: buffer.length,
      notes: att.description || null,
      uploadedById: userId,
    });
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

// ===============================================
// 1. إنشاء عرض سعر (محدث ومصحح لخطأ Prisma + زيادة عداد النموذج)
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

    // 👇 متغيرات حساب الإجماليات
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

      // 👇 حساب ضريبة هذا البند تحديداً
      const itemTaxRate =
        item.taxRate !== undefined ? parseFloat(item.taxRate) / 100 : 0.15;
      const itemTaxAmount = subtotal * itemTaxRate;
      calcTaxAmount += itemTaxAmount; // تجميع الضريبة الكلية

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
        taxRate: itemTaxRate, // حفظ نسبة ضريبة البند
        taxAmount: itemTaxAmount, // حفظ قيمة ضريبة البند
      };
    });

    const calcTotal = calcSubtotal + calcTaxAmount;

    // نسبة الضريبة العامة (كمرجعية للجدول الرئيسي)
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

    // 🔥 الحماية الأمنية: التحقق من وجود نوع المعاملة في الداتا بيز قبل الربط
    let validTransactionTypeId = undefined;
    if (data.transactionTypeId && data.transactionTypeId.length > 20) {
      const existingType = await prisma.transactionType.findUnique({
        where: { id: data.transactionTypeId },
      });
      if (existingType) validTransactionTypeId = existingType.id;
    }

    const attachmentsToCreate = processAndSaveAttachments(
      data.ownerAttachments,
      req.user?.id,
    );
    // التنفيذ داخل معاملة (Transaction) لضمان حفظ العرض والسجل معاً
    const newQuotation = await prisma.$transaction(async (tx) => {
      const createdQuote = await tx.quotation.create({
        data: {
          number: quotationNumber,

          // 🔗 علاقات العملاء والأملاك والمعاملات
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

          issueDate,
          validityDays: parseInt(data.validityDays) || 30,
          expiryDate,
          templateType: data.templateType || "SUMMARY",
          templateId: data.templateId || null,
          showClientCode: data.showClientCode ?? true,
          showPropertyCode: data.showPropertyCode ?? true,

          // ✅ التعديل الأول: ربط الموظف الطرف الأول باستخدام connect
          firstPartyEmployee: data.firstPartyEmployeeId
            ? { connect: { id: data.firstPartyEmployeeId } }
            : undefined,

          firstPartyRepCapacity: data.firstPartyRepCapacity,
          showFirstPartyEmpId: data.showFirstPartyEmpId ?? true,
          firstPartySignatureType: data.firstPartySignatureType || "MANUAL",

          serviceNumber: data.serviceNumber || null,
          serviceYear: data.serviceYear || null,
          licenseNumber: data.licenseNumber || null,
          licenseYear: data.licenseYear || null,

          // 👇 تسجيل الإجماليات
          subtotal: calcSubtotal,
          taxRate: globalTaxRateFloat,
          officeTaxBearing: parseInt(data.officeTaxBearing) || 0,
          taxAmount: calcTaxAmount,
          total: calcTotal,

          missingDocs: data.missingDocs,
          showMissingDocs: data.showMissingDocs || false,
          terms: data.terms,
          conclusion: data.conclusion,
          clientTitle: data.clientTitle || "MR",
          handlingMethod: data.handlingMethod || "DIRECT",
          acceptedMethods: data.acceptedMethods || ["bank"],

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

          // ✅ التعديل الثاني: ربط الموظف منشئ العرض (creator) باستخدام connect
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
          attachments: {
            create: attachmentsToCreate,
          },
        },
      });

      // 2. إنشاء سجل التتبع الأولي فوراً داخل نفس المعاملة
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

    // =========================================================
    // 🔥 تحديث عداد مرات استخدام النموذج (usesCount)
    // =========================================================
    if (data.templateId) {
      try {
        const templateExists = await prisma.quotationTemplate.findUnique({
          where: { code: data.templateId },
        });

        if (templateExists) {
          await prisma.quotationTemplate.update({
            where: { code: data.templateId },
            data: { usesCount: { increment: 1 } },
          });
        } else {
          await prisma.quotationTemplate.update({
            where: { id: data.templateId },
            data: { usesCount: { increment: 1 } },
          });
        }
      } catch (templateError) {
        console.error("Failed to increment template usesCount:", templateError);
      }
    }

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
// 2. تحديث عرض سعر (مصحح وآمن مع سجل التتبع)
// ===============================================
const updateQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existingQuote = await prisma.quotation.findUnique({ where: { id } });
    if (!existingQuote) {
      return res
        .status(404)
        .json({ success: false, message: "عرض السعر غير موجود" });
    }

    // 1. التحقق من حالة القفل
    const isLockedStatus = ["APPROVED", "ACCEPTED", "PARTIALLY_PAID"].includes(
      existingQuote.status,
    );
    if (isLockedStatus && (data.items || data.payments)) {
      return res.status(400).json({
        success: false,
        message:
          "لا يمكن تعديل البنود المالية أو الدفعات لعرض معتمد. يُرجى إنشاء نسخة جديدة.",
      });
    }

    // 2. تجهيز التواريخ
    let issueDate = existingQuote.issueDate;
    let expiryDate = existingQuote.expiryDate;
    let validityDays = existingQuote.validityDays;

    if (data.issueDate || data.validityDays) {
      issueDate = data.issueDate
        ? new Date(data.issueDate)
        : existingQuote.issueDate;
      validityDays = data.validityDays
        ? parseInt(data.validityDays)
        : existingQuote.validityDays;
      expiryDate = new Date(issueDate);
      expiryDate.setDate(expiryDate.getDate() + validityDays);
    }

    // 3. تجهيز بيانات التحديث الأساسية
    const baseUpdateData = {
      ...(data.status && { status: data.status }),
      ...(data.notes !== undefined && { notes: data.notes }),
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
      ...(data.officeTaxBearing !== undefined && {
        officeTaxBearing: parseInt(data.officeTaxBearing),
      }),

      issueDate,
      validityDays,
      expiryDate,

      // الحقول المباشرة للطرف الأول (بدون Id)
      firstPartyRepCapacity:
        data.firstPartyRepCapacity !== undefined
          ? data.firstPartyRepCapacity
          : existingQuote.firstPartyRepCapacity,
      showFirstPartyEmpId:
        data.showFirstPartyEmpId ?? existingQuote.showFirstPartyEmpId,
      firstPartySignatureType:
        data.firstPartySignatureType || existingQuote.firstPartySignatureType,
    };

    // 4. معالجة العلاقات المترابطة (Relations) بشكل آمن
    if (data.transactionTypeId && data.transactionTypeId.length > 20) {
      baseUpdateData.transactionType = {
        connect: { id: data.transactionTypeId },
      };
    }
    if (data.clientId)
      baseUpdateData.client = { connect: { id: data.clientId } };
    if (data.propertyId)
      baseUpdateData.ownership = { connect: { id: data.propertyId } };
    if (data.transactionId)
      baseUpdateData.transaction = { connect: { id: data.transactionId } };
    if (data.meetingId)
      baseUpdateData.meetingMinute = { connect: { id: data.meetingId } };

    // 🌟 الإصلاح الأساسي لمشكلة firstPartyEmployeeId
    if (data.firstPartyEmployeeId) {
      baseUpdateData.firstPartyEmployee = {
        connect: { id: data.firstPartyEmployeeId },
      };
    } else if (
      data.firstPartyEmployeeId === null ||
      data.firstPartyEmployeeId === ""
    ) {
      baseUpdateData.firstPartyEmployee = { disconnect: true };
    }

    const newAttachmentsToCreate = processAndSaveAttachments(
      data.ownerAttachments,
      req.user?.id,
    );

    // 5. التنفيذ الشامل داخل معاملة (Transaction) لضمان التوثيق
    const updatedQuotation = await prisma.$transaction(async (tx) => {
      let calcSubtotal = existingQuote.subtotal;
      let calcTaxAmount = existingQuote.taxAmount;
      let calcTotal = existingQuote.total;
      let globalTaxRateFloat =
        data.taxRate !== undefined
          ? parseFloat(data.taxRate) / 100
          : existingQuote.taxRate;

      // تحديث البنود إن وجدت
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
          };
        });

        calcTotal = calcSubtotal + calcTaxAmount;

        if (itemsToCreate.length > 0) {
          await tx.quotationItem.createMany({ data: itemsToCreate });
        }
      }

      // تحديث الدفعات إن وجدت
      if (data.payments) {
        await tx.quotationPayment.deleteMany({ where: { quotationId: id } });
        const paymentsToCreate = data.payments.map((p, idx) => ({
          quotationId: id,
          installmentNumber: idx + 1,
          percentage: parseFloat(p.percentage),
          amount: parseFloat(p.amount),
          dueCondition: p.condition || "حسب الاتفاق",
        }));
        if (paymentsToCreate.length > 0) {
          await tx.quotationPayment.createMany({ data: paymentsToCreate });
        }
      }

      if (newAttachmentsToCreate && newAttachmentsToCreate.length > 0) {
        await tx.attachment.createMany({
          data: newAttachmentsToCreate.map((att) => ({
            ...att,
            quotationId: id, // ربط المرفق برقم العرض الحالي
          })),
        });
      }

      // 🌟 التحديث الفعلي للعرض
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

      // 🌟 توثيق حدث التحديث في السجل التاريخي (Audit Log)
      await tx.quotationLog.create({
        data: {
          quotationId: id,
          action: "UPDATE",
          fromStatus: existingQuote.status,
          toStatus: result.status,
          userId: req.user?.id || "SYSTEM",
          userName: req.user?.name || "النظام",
          notes: "قام المستخدم بتحديث بيانات أو بنود عرض السعر",
        },
      });

      return result;
    });

    res.status(200).json({
      success: true,
      message: "تم التحديث وحفظ السجل بنجاح",
      data: updatedQuotation,
    });
  } catch (error) {
    console.error("Update Quotation Error:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث العرض",
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

// ===============================================
// دورة الاعتماد: 4. الاعتماد النهائي (بديل لـ stamp العادي)
// ===============================================
const approveQuotationWorkflow = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userName = req.user?.name || "المشرف";

    await prisma.$transaction(async (tx) => {
      const quote = await tx.quotation.findUnique({ where: { id } });
      if (!quote || quote.status !== "PENDING_APPROVAL")
        throw new Error("العرض ليس قيد المراجعة");

      await tx.quotation.update({
        where: { id },
        data: {
          status: "APPROVED",
          isStamped: true,
          stampedAt: new Date(),
          stampedBy: userId,
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
          notes: "تم اعتماد وختم العرض",
        },
      });
    });
    res.json({ success: true, message: "تم اعتماد العرض وختمه بنجاح" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
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

const generatePdfPreview = async (req, res) => {
  try {
    const data = req.body;

    const {
      transactionType,
      licenseNumber,
      licenseYear,
      serviceNumber,
      serviceYear,
      clientTitle,
      clientNameForPreview,
      clientCodeForPreview,
      validityDays,
      showPropertyCode,
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
      boundaries = [],
      employeeName = "إدارة المشاريع وعقود العملاء",
      employeeId = "SYS-109",
      taxRate = 15,
      acceptedMethods = [],
      missingDocs = "",
      showMissingDocs = false,
      deedNumber,
      clientType = "فرد",
      signatureMethod = "SELF",
      repName,
      repIdNumber,
      repPhone,
      repCapacity,
      authDocType,
      authDocNumber,
      authDocDate,
      issueDate,
      handlingMethod = "المالك مباشرة",
      firstPartyName,
      firstPartyRep,
      secondPartyName,
      secondPartyRep,
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

      // 🚀 الحقول الجديدة
      authDocIssueDate,
      showAuthDocIssueDate,
      authDocExpiryDate,
      showAuthDocExpiryDate,
      customUsufructType,
      documentType,
    } = data;

    // حساب الحالة واللون للـ PDF
    let badgeText = "مسودة غير معتمدة";
    let badgeColor = "#b45309";
    let badgeBg = "#fffbeb";
    let badgeBorder = "#fde68a";

    const isFullyApproved =
      status === "ACCEPTED" || status === "PARTIALLY_PAID";
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
      badgeColor = "#334155";
      badgeBg = "#f1f5f9";
      badgeBorder = "#cbd5e1";
    } else if (isCancelled) {
      badgeText = "ملغي";
      badgeColor = "#b91c1c";
      badgeBg = "#fef2f2";
      badgeBorder = "#fecaca";
    } else if (isFullyApproved) {
      badgeText = "معتمد من جميع الأطراف";
      badgeColor = "#047857";
      badgeBg = "#ecfdf5";
      badgeBorder = "#a7f3d0";
    } else if (isOfficeApproved) {
      badgeText = "معتمد من مقدم الخدمة فقط";
      badgeColor = "#1d4ed8";
      badgeBg = "#eff6ff";
      badgeBorder = "#bfdbfe";
    }

    const referenceNumber =
      data.referenceNumber || `QT-${Date.now().toString().slice(-5)}`;
    const formatCurrency = (value) =>
      Number(value || 0).toLocaleString("ar-SA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const formatArea = (value) =>
      Number(value || 0).toLocaleString("en-US", {
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

    const calculatedOfficeDiscount = (taxAmount * officeTaxBearing) / 100;
    const finalPayable =
      (grandTotal || subtotal + taxAmount) - calculatedOfficeDiscount;

    const issueDateParts = formatDateParts(issueDate);

    let introText = `إشارة إلى طلبكم بخصوص تقديم عرض سعر خدمات (${transactionType || "الخدمات الهندسية والاستشارية"})`;
    if (handlingMethod)
      introText += `، بناءً على أسلوب التعامل والتفويض المعتمد (${handlingMethod})`;
    introText +=
      "، فإنه يسرنا تقديم العرض المالي والفني لإنهاء الأعمال المطلوبة وفقاً لنطاق العمل والاشتراطات والملاحظات التالية:";

    // الأيقونات كـ SVG مباشر للمطابقة مع الواجهة الأمامية
    const icons = {
      scale: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #059669; margin-top: 2px;"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>`,
      userCheck: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c5983c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>`,
      building: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c5983c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>`,
      fileText: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c5983c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
      dollarSign: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c5983c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
      folderOpen: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c5983c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/></svg>`,
      alertTriangle: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    };

    const logoUrl = "https://details-worksystem1.com/logo.svg"; // تأكد من استخدام الرابط المناسب
    const SECURITY_BACKGROUNDS = {
      none: "none",
      official1:
        "url('https://details-worksystem1.com/safe_background/1.webp')",
      official2:
        "url('https://details-worksystem1.com/safe_background/2.webp')",
      official3:
        "url('https://details-worksystem1.com/safe_background/3.webp')",
    };
    const finalBgUrl =
      SECURITY_BACKGROUNDS[bgType] || SECURITY_BACKGROUNDS["official1"];

    let clientRepresentationHTML = "";
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

      clientRepresentationHTML = `
      <div style="margin-top: 8px; margin-bottom: 16px; display: flex; align-items: flex-start; gap: 8px; font-size: 12px; font-weight: bold; color: #334155; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
        <div style="flex-shrink: 0;">${icons.scale}</div>
        <p style="margin: 0; line-height: 1.6;">${clientRepText}</p>
      </div>`;
    }

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
        if (plots[i].deedDate === plots[i - 1].deedDate) {
          rowSpans.date[currentIdx.date] += 1;
          rowSpans.date[i] = 0;
        } else {
          rowSpans.date[i] = 1;
          currentIdx.date = i;
        }
      }
    }

    const paymentMethodsLabels = {
      bank: "تحويل بنكي",
      cash: "نقدي",
      sadad: "رقم سداد",
      pos: "دفع الكترونى POS",
    };

    let bankAccountsHTML = "";
    if (acceptedMethods.includes("bank") && selectedBankAccounts.length > 0) {
      const bankPromises = selectedBankAccounts.map(async (bankId) => {
        const bank = bankAccountsData.find((b) => b.id === bankId);
        if (!bank) return "";

        return `
        <tr style="background-color: #ffffff;">
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">
             <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;">
                ${bank.logo ? `<img src="${bank.logo}" style="width: 24px; height: 24px; object-fit: contain; flex-shrink: 0;" />` : `<div style="width: 20px; height: 20px;">${icons.building}</div>`}
                <span style="font-weight: 900; color: #123f59; font-size: 10.5px;">${bank.name}</span>
             </div>
          </td>
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle; color: #475569; font-size: 10.5px; line-height: 1.6;">
             <div style="font-weight: bold; color: #1e293b;">${bank.accountNameAr || bank.accountName || "---"}</div>
             <div style="direction: ltr; margin-top: 2px;">${bank.accountNameEn || "---"}</div>
          </td>
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">
             <div style="font-family: monospace; font-weight: bold; color: #1e293b; font-size: 10.5px; direction: ltr; letter-spacing: 1px;">
               ${bank.accountNumber || "---"}
             </div>
          </td>
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">
             <div style="font-family: monospace; font-weight: 900; color: #3730a3; font-size: 10.5px; direction: ltr; letter-spacing: 1.5px;">
               ${formatIBAN(bank.iban)}
             </div>
          </td>
          <td style="padding: 4px; border: 1px solid #123f5944; text-align: center; vertical-align: middle;">
            <div style="display: flex; flex-direction: column; align-items: center;">
                <img 
                  src="${bank.qrCodeData}" 
                  alt="Bank QR"
                  style="width: 60px; height: 60px; object-fit: contain; margin-bottom: 2px; border: 1px solid #f1f5f9; padding: 2px; border-radius: 4px; background: #fff; image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;" 
                />
            </div>
          </td>
        </tr>`;
      });
      const resolvedBanks = await Promise.all(bankPromises);

      bankAccountsHTML = `
      <div style="border-top: 1px solid #d8b46a33; margin-top: 4px; padding-top: 12px;">
        <span style="font-weight: 900; color: #123f59; display: block; margin-bottom: 8px; text-align: right; font-size: 11px;">البيانات البنكية المعتمدة للسداد:</span>
        <table style="width: 100%; border-collapse: collapse; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); text-align: center;">
          <thead style="background-color: rgba(241, 245, 249, 0.8);">
            <tr>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">البنك</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">اسم المستفيد</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">رقم الحساب</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">الآيبان / IBAN</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 8px; font-weight: 900; color: #475569; width: 15%;">QR للنسخ والمشاركة</th>
            </tr>
          </thead>
          <tbody>
            ${resolvedBanks.join("")}
          </tbody>
        </table>
      </div>`;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
        <style>
          @page { size: A4; margin: 0; }
          body { 
            font-family: 'Tajawal', sans-serif; 
            margin: 0; padding: 0; color: #123f59; 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important;
            background-color: #e8edf0;
          }
          /* التعديل هنا: تغيير min-height */
          .page-container {
            width: 794px; min-height: 100vh; padding: 60px 70px;
            box-sizing: border-box; background-color: #ffffff;
            position: relative; page-break-after: always;
            overflow: hidden;
            background-image: ${finalBgUrl};
            background-size: 794px 1123px;
            background-repeat: repeat-y;
            background-position: top center;
          }
          .content { position: relative; z-index: 1; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 11px; }
          th, td { border: 1px solid #123f59; padding: 8px; text-align: center; }
          th { background-color: #123f59; color: #fff; font-weight: 900; }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
          
          .bg-slate-50 { background-color: #f8fafc; }
          .text-slate-500 { color: #64748b; }
          .text-slate-700 { color: #334155; }
          .text-slate-800 { color: #1e293b; }
          .text-emerald-800 { color: #065f46; }
          .font-bold { font-weight: bold; }
          .font-black { font-weight: 900; }
          .font-mono { font-family: monospace; }
          .section-title { 
            font-size: 11.5px; font-weight: 900; color: #123f59; margin-bottom: 8px; 
            border-bottom: 2px solid #123f59; padding-bottom: 4px; display: inline-block;
          }
        </style>
      </head>
      <body>
        
        <div class="page-container" style="display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
          <div style="position: absolute; top: 32px; left: 32px; z-index: 20;">
            <div style="padding: 8px 16px; border-radius: 12px; border: 2px solid ${badgeBorder}; background-color: ${badgeBg}; color: ${badgeColor}; font-weight: 900; font-size: 12px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
              ${badgeText}
            </div>
          </div>
          <div class="content" style="width: 100%; padding: 80px 0;">
            <div style="width: 300px; margin: 0 auto 60px auto;">
              <img src="${logoUrl}" alt="Logo" style="max-width: 100%; mix-blend-mode: multiply;" />
            </div>

            <div style="width: 80%; margin: 0 auto; border-top: 5px solid #123f59; border-bottom: 5px solid #123f59; padding: 48px 0; margin-bottom: 32px;">
              <h1 style="font-size: 42px; font-weight: 900; color: #123f59; margin-bottom: 24px; margin-top: 0; line-height: 1.2;">
                ${documentType || "عرض سعر فني ومالي"}
              </h1>
              <h2 style="font-size: 22px; font-weight: bold; color: #475569; margin: 0;">${transactionType || "خدمات هندسية واستشارية استراتيجية"}</h2>
            </div>

            <div style="width: 100%; text-align: right; background-color: transparent; padding: 32px; border-radius: 24px; border: 1px solid rgba(216,180,106,0.3); box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); box-sizing: border-box;">
              <p style="font-size: 16px; font-weight: 900; color: #64748b; margin-top: 0; margin-bottom: 12px;">مقدم إلى السادة / الطرف الثاني:</p>
              <p style="font-size: 34px; font-weight: 900; color: #123f59; margin-top: 0; margin-bottom: 32px; line-height: 1.2;">${clientTitle} / ${secondPartyName || clientNameForPreview}</p>

              <table style="border: none; font-size: 14px; font-weight: bold; color: #334155; margin-bottom: 0;">
                <tr>
                  <td style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 4px 0; width: 50%;"><span style="color: #64748b; font-size: 12px;">رقم العرض /الرقم المرجعي:</span> <span style="color: #0f172a; font-weight: 900; font-size: 12px; font-family: monospace;">${referenceNumber}</span></td>
                  <td style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 4px 0; width: 50%;"><span style="color: #64748b;">تاريخ الإصدار:</span> <span style="color: #0f172a; font-family: monospace;">${issueDateParts.gregorian}</span></td>
                </tr>
                ${
                  transactionRefForPreview || meetingTitleForPreview
                    ? `
                <tr>
                  ${transactionRefForPreview ? `<td colspan="${meetingTitleForPreview ? "1" : "2"}" style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 4px 0;"><span style="color: #64748b;"> الرقم الداخلي للمعاملة:</span> <span style="color: #0f172a; font-weight: 900; font-family: monospace;">${transactionRefForPreview}</span></td>` : '<td style="border: none; border-bottom: 1px dashed #cbd5e1;"></td>'}
                  ${meetingTitleForPreview ? `<td colspan="${transactionRefForPreview ? "1" : "2"}" style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 4px 0;"><span style="color: #64748b;">استناداً لمحضر اجتماع:</span> <span style="color: #0f172a; font-weight: 900; font-family: monospace;">${meetingTitleForPreview}</span></td>` : '<td style="border: none; border-bottom: 1px dashed #cbd5e1;"></td>'}
                </tr>`
                    : ""
                }
                ${
                  propertyCodeForPreview
                    ? `
                <tr>
                  <td colspan="2" style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 4px 0;"><span style="color: #64748b;">المشروع/الملكية:</span> <span style="color: #0f172a; font-weight: 900; font-family: monospace;">${propertyCodeForPreview}</span></td>
                </tr>`
                    : ""
                }
              </table>
            </div>
            
            <div style="margin-top: 32px;">
              <p style="font-size: 13px; font-weight: 900; color: #94a3b8;">${firstPartyName || "شركة ديتيلز كونسولتس للاستشارات الهندسية"}</p>
            </div>
          </div>
        </div>

        <div class="page-container" style="padding: 0;">
          <table style="width: 100%; border: none; margin: 0; position: relative; z-index: 1;">
            <thead style="display: table-header-group;">
              <tr>
                <td style="border: none; padding: 60px 70px 20px 70px;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #123f59; padding-bottom: 16px;">
                    <div style="height: 64px; width: 192px;">
                      <img src="${logoUrl}" alt="Logo" style="max-height: 100%; max-width: 100%; mix-blend-mode: multiply;" />
                    </div>
                    <div style="width: 280px;">
                      <table style="width: 100%; text-align: right; border-collapse: collapse; font-size: 10px; font-weight: bold; border: 1px solid #123f5944; margin: 0; background: transparent;">
<tr><td style="border: 1px solid #123f5944; width: 35%; color: #475569; padding: 8px;">نوع المستند</td><td style="border: 1px solid #123f5944; color: #123f59; font-weight: 900; font-size: 12px; padding: 8px;">${documentType || "عرض سعر فني ومالي"}</td></tr>                        <tr><td style="border: 1px solid #123f5944; color: #475569; padding: 8px;">التاريخ</td><td style="border: 1px solid #123f5944; color: #123f59; font-size: 9px; font-weight: bold; padding: 7px;">${issueDateParts.combined}</td></tr>
                        <tr><td style="border: 1px solid #123f5944; color: #475569; padding: 8px;">رقم المرجع</td><td style="border: 1px solid #123f5944; font-weight: 900; color: #123f59; font-family: monospace; font-size: 11px; padding: 8px;">${referenceNumber}</td></tr>
                      </table>
                    </div>
                  </div>
                </td>
              </tr>
            </thead>

            <tbody style="display: table-row-group;">
              <tr>
                <td style="border: none; padding: 0px 70px 20px 70px;">
                  
                  <table style="width: 100%; text-align: right; border-collapse: collapse; font-size: 10px; font-weight: bold; border: 1px solid #123f5944; margin: 16px 0 24px 0; background: transparent;">
                    <tr>
                      <td class="bg-slate-50 text-slate-500" style="width: 20%; border: 1px solid #123f5944; padding: 8px;">نوع الخدمة</td>
                      <td class="font-black" style="width: 30%; color: #123f59; border: 1px solid #123f5944; padding: 8px;">${transactionType || "عرض سعر خدمات فنية"}</td>
                      <td class="bg-slate-50 text-slate-500" style="width: 20%; border: 1px solid #123f5944; padding: 8px;">حالة المستند</td>
                      <td class="font-black" style="width: 30%; border: 1px solid #123f5944; padding: 8px; color: #b45309;">مسودة مراجعة داخلية</td>
                    </tr>
                    <tr>
                      <td class="bg-slate-50 text-slate-500" style="border: 1px solid #123f5944; padding: 8px;">رقم حساب العميل</td>
                      <td class="font-mono text-slate-800" style="border: 1px solid #123f5944; padding: 8px;">${clientCodeForPreview || "---"}</td>
                      <td class="bg-slate-50 text-slate-500" style="border: 1px solid #123f5944; padding: 8px;">رمز أرشفة المشروع</td>
                      <td class="font-mono text-slate-800" style="border: 1px solid #123f5944; padding: 8px;">${propertyCodeForPreview || "---"}</td>
                    </tr>
                    <tr>
                      <td class="bg-slate-50 text-slate-500" style="border: 1px solid #123f5944; padding: 8px;">مدة صلاحية العرض</td>
                      <td class="text-slate-800" style="border: 1px solid #123f5944; padding: 8px;">${validityDays === "unlimited" ? "مفتوح / غير محدد" : `${validityDays} يوماً تبدأ بعد اعتماد مقدم الخدمة`}</td>
                      <td class="bg-slate-50 text-slate-500" style="border: 1px solid #123f5944; padding: 8px;">نسخة الوثيقة</td>
                      <td class="font-mono text-slate-800" style="border: 1px solid #123f5944; padding: 8px;">v1.0</td>
                    </tr>
                  </table>

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin: 0 0 16px 0; font-size: 13px; font-weight: 900; color: #123f59;">${clientTitle} ${secondPartyName || clientNameForPreview}</h4>
                    ${clientRepresentationHTML}
                    <p style="margin: 0 0 12px 0; font-size: 12px; font-weight: 900; color: #123f59;">السلام عليكم ورحمة الله وبركاته ،،,</p>
                    <p style="margin: 0; font-size: 11.5px; font-weight: bold; color: #475569; line-height: 24px; text-align: right; white-space: pre-wrap; letter-spacing: 0px;">${introText}</p>
                  </div>

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin-bottom: 8px; font-size: 11.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: #123f59;">
                       ${icons.userCheck} أولاً: بيانات العميل والمالك وصاحب العلاقة الأصلي
                    </h4>
                    <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 10.5px; border: 1px solid #123f59; margin-bottom: 0;">
                      <tbody class="font-bold text-[#123f59]">
                        <tr>
                          <td class="bg-slate-50 w-1/4" style="border: 1px solid #123f5944; padding: 8px;">تصنيف العميل الكياني</td>
                          <td class="w-1/4" style="border: 1px solid #123f5944; padding: 8px;">${(clientType || "فرد").replace(/_/g, " ")}</td>
                          <td class="bg-slate-50 w-1/4" style="border: 1px solid #123f5944; padding: 8px;">اسم المالك المسجل بالتسجيل</td>
                          <td class="w-1/4 font-black text-[#123f59]" style="border: 1px solid #123f5944; padding: 8px;">${clientNameForPreview}</td>
                        </tr>
                        <tr>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">الصفة الرسمية للتعامل و الإعتماد</td>
                          <td style="border: 1px solid #123f5944; padding: 8px;">${handlingMethod}</td>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">رقم الجوال للاتصال</td>
                          <td class="font-mono text-blue-700" style="border: 1px solid #123f5944; padding: 8px;">${repPhone || "---"}</td>
                        </tr>
                        
                      </tbody>
                    </table>
                  </div>

                  ${
                    signatureMethod !== "SELF"
                      ? `
                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <div class="section-title">ثانياً: بيانات التمثيل النظامي والمفوض بالتوقيع الشرعي</div>
                    <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 10.5px; border: 1px solid #123f59; margin-bottom: 0;">
                      <tbody class="font-bold text-[#123f59]">
                        <tr>
                          <td class="bg-slate-50 w-1/4" style="border: 1px solid #123f5944; padding: 8px;">اسم المفوض / الممثل</td>
                          <td class="w-1/4 font-black" style="border: 1px solid #123f5944; padding: 8px;">${repName || "---"}</td>
                          <td class="bg-slate-50 w-1/4" style="border: 1px solid #123f5944; padding: 8px;">رقم السجل المدني / الهوية</td>
                          <td class="w-1/4 font-mono font-black" style="border: 1px solid #123f5944; padding: 8px;">${repIdNumber || "---"}</td>
                        </tr>
                        <tr>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">الصفة القانونية للتمثيل</td>
                          <td style="border: 1px solid #123f5944; padding: 8px;">
                            ${signatureMethod === "AGENT" ? "وكيل شرعي" : signatureMethod === "AUTHORIZED" ? "مفوض نظامي" : "مستفيد"}
                          </td>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">رقم جوال الممثل</td>
                          <td class="font-mono text-blue-700" style="border: 1px solid #123f5944; padding: 8px;">${repPhone || "---"}</td>
                        </tr>
                        <tr>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">نوع مستند التفويض والصفة</td>
                          <td class="font-black text-slate-700" style="border: 1px solid #123f5944; padding: 8px;">
                             ${authDocType === "مستند انتفاع" && customUsufructType ? customUsufructType : authDocType || "---"}
                          </td>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">بيانات المستند المعتمد</td>
                          <td class="font-mono font-bold text-cyan-800" style="border: 1px solid #123f5944; padding: 8px; line-height: 1.6;">
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                              <span>${authDocNumber ? `رقم: ${authDocNumber}` : "رقم: ---"}</span>
                              ${showAuthDocIssueDate && authDocIssueDate ? `<span style="font-size: 9px; color: #64748b;">إصدار: ${formatDateParts(authDocIssueDate).gregorian}</span>` : ""}
                              ${showAuthDocExpiryDate && authDocExpiryDate ? `<span style="font-size: 9px; color: #e11d48;">انتهاء: ${formatDateParts(authDocExpiryDate).gregorian}</span>` : ""}
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>`
                      : ""
                  }

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px;">
                      <h4 style="margin: 0; font-size: 11.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: #123f59;">
                        ${icons.building} ${signatureMethod !== "SELF" ? "ثالثاً" : "ثانياً"}: بيانات المشروع والملكية العقارية
                      </h4>
                      ${
                        plots && plots.length > 0
                          ? `
                      <span style="font-size: 10px; font-weight: bold; color: #64748b; background-color: #fff; padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 6px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
                        عدد القطع: ${plots.length} | إجمالي المساحة: ${formatArea(totalPlotsArea)} م² | كود الملف: ${propertyCodeForPreview || "---"}
                      </span>
                      `
                          : ""
                      }
                    </div>

                    ${
                      plots && plots.length > 0
                        ? `
                    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 10.5px; border: 1px solid #123f59; margin-bottom: 0;">
                      <thead style="background-color: #123f59; color: #fff; font-weight: 900;">
                        <tr><th style="padding: 8px; border: 1px solid #123f59; width: 5%;">م</th><th style="padding: 8px; border: 1px solid #123f59;">رقم القطعة</th><th style="padding: 8px; border: 1px solid #123f59;">الحي</th><th style="padding: 8px; border: 1px solid #123f59;">رقم المخطط التنظيمي</th><th style="padding: 8px; border: 1px solid #123f59;">رقم وثيقة الملكية</th><th style="padding: 8px; border: 1px solid #123f59;">تاريخ الوثيقة</th><th style="padding: 8px; border: 1px solid #123f59;">مساحة القطعة</th></tr>
                      </thead>
                      <tbody style="font-weight: bold; color: #123f59;">
                        ${plots
                          .map(
                            (plot, i) => `
                        <tr>
                          <td style="padding: 8px; border: 1px solid #123f5944; background-color: rgba(248, 250, 252, 0.5);">${i + 1}</td>
                          <td class="font-mono" style="padding: 8px; border: 1px solid #123f5944;">${plot.plotNumber || "---"}</td>
                          ${rowSpans.district[i] > 0 ? `<td rowspan="${rowSpans.district[i]}" style="padding: 8px; border: 1px solid #123f5944; vertical-align: middle;">${plot.district || propertyDistrict || "---"}</td>` : ""}
                          ${rowSpans.plan[i] > 0 ? `<td rowspan="${rowSpans.plan[i]}" class="font-mono text-slate-700" style="padding: 8px; border: 1px solid #123f5944; vertical-align: middle;">${plot.planNumber || propertyPlanNumber || "---"}</td>` : ""}
                          ${rowSpans.deed[i] > 0 ? `<td rowspan="${rowSpans.deed[i]}" class="font-mono text-emerald-800 font-black" style="padding: 8px; border: 1px solid #123f5944; vertical-align: middle;">${plot.deedNumber || deedNumber || "---"}</td>` : ""}
                          ${rowSpans.date[i] > 0 ? `<td rowspan="${rowSpans.date[i]}" class="font-mono text-slate-600" style="padding: 8px; border: 1px solid #123f5944; vertical-align: middle;">${plot.deedDate ? formatDateParts(plot.deedDate).gregorian : "---"}</td>` : ""}
                          <td class="font-mono" style="padding: 8px; border: 1px solid #123f5944;">${formatArea(plot.area)} م²</td>
                        </tr>`,
                          )
                          .join("")}
                        <tr class="bg-slate-50">
                          <td colspan="6" class="text-left font-black" style="padding: 8px; border: 1px solid #123f5944;">إجمالي مساحة الموقع:</td>
                          <td class="font-mono font-black text-[12px] text-emerald-800" style="padding: 8px; border: 1px solid #123f5944;">${formatArea(totalPlotsArea)} م²</td>
                        </tr>
                      </tbody>
                    </table>`
                        : `
                    <div style="padding: 16px; border: 1px dashed #cbd5e1; border-radius: 12px; text-align: center; color: #94a3b8; font-size: 12px; font-weight: bold;">
                      لا توجد قطع مضافة في ملف الملكية المرفق
                    </div>`
                    }
                    
                    ${
                      licenseNumber || serviceNumber
                        ? `
                  <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 10.5px; border: 1px solid #123f59; margin-top: 12px; margin-bottom: 0;">
                    <tbody class="font-bold text-[#123f59]">
                      <tr>
                        ${
                          licenseNumber
                            ? `
                        <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px; width: 25%;">رقم وتاريخ رخصة البناء</td>
                        <td class="font-mono" style="border: 1px solid #123f5944; padding: 8px; width: ${licenseNumber && serviceNumber ? "25%" : "75%"};">${licenseNumber} لعام ${licenseYear}هـ</td>`
                            : ""
                        }
                        ${
                          serviceNumber
                            ? `
                        <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px; width: 25%;">رقم وتاريخ المعاملة / الطلب</td>
                        <td class="font-mono" style="border: 1px solid #123f5944; padding: 8px; width: ${licenseNumber && serviceNumber ? "25%" : "75%"};">${serviceNumber} لعام ${serviceYear}هـ</td>`
                            : ""
                        }
                      </tr>
                    </tbody>
                  </table>`
                        : ""
                    }
                  </div>

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin-bottom: 8px; font-size: 11.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: #123f59;">
                       ${icons.fileText} ${signatureMethod !== "SELF" ? "رابعاً" : "ثالثاً"}: نطاق الأعمال وقائمة التكاليف المالية
                    </h4>
                    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 10.5px; border: 1px solid #123f59; margin-bottom: 0; table-layout: fixed;">
                      <thead style="background-color: #123f59; color: #fff; font-weight: 900;">
                        <tr>
                          <th style="padding: 10px; border: 1px solid #123f59; width: 5%;">م</th>
                          <th style="padding: 10px; text-align: right; border: 1px solid #123f59; width: ${showQuantity ? "80%" : "95%"};">وصف الخدمة الاستشارية / نطاق العمل الفني</th>
                          ${showQuantity ? `<th style="padding: 10px; border: 1px solid #123f59; width: 15%;">الكمية</th>` : ""}
                        </tr>
                      </thead>
                      <tbody class="font-bold text-[#123f59]">
                        ${
                          items.length === 0
                            ? `<tr><td colspan="${showQuantity ? "3" : "2"}" style="padding: 24px; color: #94a3b8;">لا توجد بنود فنية مسجلة حتى الآن</td></tr>`
                            : items
                                .map(
                                  (item, index) => `
                        <tr>
                          <td class="font-mono" style="padding: 8px; border: 1px solid #123f5944; vertical-align: top;">${index + 1}</td>
                          <td class="text-right" style="padding: 8px; border: 1px solid #123f5944; line-height: 1.6; word-wrap: break-word; white-space: pre-wrap;">${item.title}</td>
                          ${showQuantity ? `<td class="font-mono" style="padding: 8px; border: 1px solid #123f5944; vertical-align: top;">${item.qty || item.quantity || 1} ${item.unit || ""}</td>` : ""}
                        </tr>`,
                                )
                                .join("")
                        }
                        
                        <tr class="bg-slate-50">
                          <td colspan="${showQuantity ? "3" : "2"}" style="padding: 0; border: 1px solid #123f5944;">
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; box-sizing: border-box;">
                              <span class="font-black">المجموع الفرعي</span>
                              <span class="font-mono font-black" style="font-size: 12px; color: #1e293b;">${formatCurrency(subtotal)} ر.س</span>
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td colspan="${showQuantity ? "3" : "2"}" style="padding: 0; border: 1px solid #123f5944;">
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; box-sizing: border-box;">
                              <span style="font-weight: bold; color: #64748b;">ضريبة القيمة المضافة ${taxRate || 15}% ${officeTaxBearing > 0 ? `(يتحمل المكتب ${officeTaxBearing}%)` : ""}</span>
                              <span class="font-mono font-bold" style="font-size: 12px; color: #334155;">${formatCurrency(taxAmount)} ر.س</span>
                            </div>
                          </td>
                        </tr>
                        ${
                          officeTaxBearing > 0
                            ? `
                        <tr>
                          <td colspan="${showQuantity ? "3" : "2"}" style="padding: 0; border: 1px solid #123f5944;">
                             <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; box-sizing: border-box; color: #047857;">
                              <span style="font-weight: bold;">خصم إعفاء ضريبي ضِمني (المكتب يتحمل نسبة ${officeTaxBearing}%)</span>
                              <span class="font-mono font-black" style="font-size: 12px;">- ${formatCurrency(calculatedOfficeDiscount)} ر.س</span>
                             </div>
                          </td>
                        </tr>`
                            : ""
                        }
                        <tr class="font-black text-white" style="background-color: #123f59;">
                          <td colspan="${showQuantity ? "3" : "2"}" style="padding: 0; border: 1px solid #123f5944;">
                             <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; box-sizing: border-box;">
                              <span style="font-size: 12.5px;">الإجمالي النهائي المستحق الصافي للدفع</span>
                              <span class="font-mono" style="font-size: 13.5px;">${formatCurrency(finalPayable)} ر.س</span>
                             </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  ${
                    (paymentsList && paymentsList.length > 0) ||
                    (acceptedMethods && acceptedMethods.length > 0)
                      ? `
                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin-bottom: 8px; font-size: 11.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: #123f59;">
                       ${icons.dollarSign} ${signatureMethod !== "SELF" ? "خامساً" : "رابعاً"}: الجدول الزمني للدفعات المالية
                    </h4>
                    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 10.5px; border: 1px solid #123f59; margin-bottom: 0;">
                      <thead style="background-color: #123f59; color: #fff; font-weight: 900;">
                        <tr><th style="padding: 10px; border: 1px solid #123f59; width: 20%;">الدفعة</th><th style="padding: 10px; border: 1px solid #123f59; width: 15%;">النسبة (%)</th><th style="padding: 10px; border: 1px solid #123f59; width: 25%;">المبلغ (شامل الضريبة)</th><th style="padding: 10px; border: 1px solid #123f59; width: 40%;">الاستحقاق</th></tr>
                      </thead>
                      <tbody class="font-bold text-[#123f59]">
                        ${paymentsList
                          .map(
                            (payment, index) => `
                        <tr>
                          <td style="padding: 8px; border: 1px solid #123f5944; background-color: rgba(248,250,252,0.5);">${payment.label || `الدفعة ${index + 1}`}</td>
                          <td class="font-mono text-slate-700" style="padding: 8px; border: 1px solid #123f5944;">${payment.percentage || Math.round(100 / paymentsList.length)}%</td>
                          <td class="font-mono font-black text-emerald-800" style="background-color: rgba(236,253,245,0.2); padding: 8px; border: 1px solid #123f5944;">${formatCurrency(payment.amount)} ر.س</td>
                          <td class="text-right text-[#556575]" style="padding: 8px 12px; border: 1px solid #123f5944; line-height: 1.5;">${payment.condition || "حسب الاتفاق وجداول إنجاز الأعمال الفنية"}</td>
                        </tr>`,
                          )
                          .join("")}
                        
                        ${
                          acceptedMethods && acceptedMethods.length > 0
                            ? `
                        <tr class="bg-slate-50">
                          <td colspan="4" class="text-right text-[10.5px] text-[#475569]" style="padding: 12px; border: 1px solid #123f5944;">
                            <div style="margin-bottom: 4px;">
                              <span class="font-black text-slate-800 ml-2">طرق السداد المتاحة:</span>
                              ${acceptedMethods.map((m) => paymentMethodsLabels[m] || m).join(" ، ")}
                            </div>
                            ${bankAccountsHTML}
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
                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin-bottom: 12px; font-size: 11.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: #123f59;">
                       ${icons.folderOpen} ${signatureMethod !== "SELF" ? "سادساً" : "خامساً"}: المستندات والمسوغات المطلوب توفيرها من طرفكم لبدء العمل
                    </h4>
                    <div style="border: 1px solid rgba(18,63,89,0.2); border-radius: 14px; background-color: #fff; overflow: hidden;">
                      <div style="background-color: rgba(18,63,89,0.04); padding: 10px 16px; border-bottom: 1px solid rgba(18,63,89,0.13); display: flex; align-items: center; gap: 8px;">
                        ${icons.alertTriangle}
                        <span style="color: #123f59; font-weight: 900; font-size: 10px;">نأمل منكم التكرم بتجهيز المستندات التالية وتسليمها للمكتب ليتسنى لنا البدء في تنفيذ الأعمال:</span>
                      </div>
                      <div style="padding: 16px;">
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                          ${missingDocs
                            // 🌟 التعديل هنا: استخدام تعبير نمطي قوي لالتقاط الأسطر الجديدة في جميع المتصفحات والأنظمة
                            .split(/\r?\n/)
                            .filter((d) => d.trim() !== "")
                            .map(
                              (doc, idx) => `
                            <div style="display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 8px; background-color: rgba(248,250,252,0.5); border: 1px solid rgba(241,245,249,0.8);">
                              <span style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; font-size: 10px; font-weight: bold; color: #fff; background-color: #123f59; margin-top: 2px;">
                                ${idx + 1}
                              </span>
                              <span style="font-size: 11px; font-weight: bold; color: #334155; line-height: 1.6;">${doc.replace(/^- /, "").trim()}</span>
                            </div>`,
                            )
                            .join("")}
                        </div>
                      </div>
                    </div>
                  </div>`
                      : ""
                  }

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin-bottom: 8px; font-size: 11.5px; font-weight: 900; color: #123f59;">
                       ${signatureMethod !== "SELF" ? "سابعاً" : "سادساً"}: الشروط والأحكام والالتزامات العامة
                    </h4>
                    <div style="background-color: rgba(248, 250, 252, 0.3); padding: 8px; border-radius: 4px; border: 1px solid #f1f5f9; font-size: 11px; font-weight: bold; color: #475569; line-height: 24px; white-space: pre-wrap; text-align: right;">${termsText || "خاضع للشروط العامة المسجلة بالمكتب."}</div>
                  </div>

                  ${
                    conclusion && conclusion.trim() !== ""
                      ? `
                  <div class="avoid-break" style="margin-bottom: 32px;">
                    <div style="padding: 0 32px; font-size: 12px; font-weight: bold; color: #475569; line-height: 26px; white-space: pre-wrap; text-align: center;">${conclusion}</div>
                  </div>`
                      : ""
                  }

                  <div class="avoid-break" style="margin-top: 32px; padding-top: 16px;">
                    <h4 style="text-align: center; font-size: 12.5px; font-weight: 900; color: #123f59; margin-bottom: 16px;">صيغة الاعتماد والموافقة النهائية والتواقيع الرسمية</h4>
                    <table style="border: 2px solid #123f59; font-size: 10px; width: 100%; table-layout: fixed; background: transparent;">
                      <thead style="background-color: #123f59; color: #fff; font-weight: 900; font-size: 11.5px;">
                        <tr>
                          <th style="width: 50%; padding: 10px; border-left: 1px solid #123f5944;">الطرف الثاني: قبول وتوقيع العميل / ${signatureMethod === "AUTHORIZED" ? "المفوض" : signatureMethod === "AGENT" ? "الوكيل" : signatureMethod === "BENEFICIARY" ? "المستفيد" : "المالك"}</th>
                          <th style="width: 50%; padding: 10px;">الطرف الأول: اعتماد وختم مقدم الخدمة (المكتب)</th>
                        </tr>
                      </thead>
                      <tbody class="font-bold text-[#123f59]">
                        <tr>
                          <td style="padding: 12px; vertical-align: top; border-left: 1px solid #123f5944; border-bottom: none;">
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">اسم الجهة / العميل:</span> <span style="font-weight: 900; color: #1e293b;">${clientNameForPreview}</span></div>
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">يمثلها في التوقيع:</span> <span style="font-weight: 900; color: #1e293b;">${signatureMethod === "SELF" ? "المالك الفعلي ذو العلاقة" : repName || "............................"}</span></div>
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">الصفة والتمثيل الكياني:</span> <span style="font-weight: 900; color: #1e293b;">${signatureMethod === "SELF" ? "عن نفسه (المالك الأصلي)" : signatureMethod === "AGENT" ? "وكيل شرعي" : signatureMethod === "AUTHORIZED" ? "مفوض نظامي" : "مستفيد"}</span></div>
                            
                            ${
                              signatureMethod !== "SELF"
                                ? `
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">رقم الهوية / السجل:</span> <span class="font-mono" style="font-weight: 900; color: #1e293b;">${repIdNumber || "............................"}</span></div>
                            <div style="margin-bottom: 4px; line-height: 1.6;">
                              <span style="color: #64748b;">مستند التمثيل (${authDocType === "مستند انتفاع" && customUsufructType ? customUsufructType : authDocType || "الوكالة/التفويض"}):</span> 
                              <span class="font-mono" style="font-weight: 900; color: #164e63;">${authDocNumber ? `رقم (${authDocNumber})` : "............................"}</span>
                              ${
                                showAuthDocIssueDate || showAuthDocExpiryDate
                                  ? `
                                <div style="font-size: 9px; margin-top: 2px; display: flex; gap: 16px;">
                                  ${showAuthDocIssueDate && authDocIssueDate ? `<span style="color: #64748b;">تاريخ الإصدار: <span class="font-mono" style="color: #334155; font-weight: bold;">${formatDateParts(authDocIssueDate).gregorian}</span></span>` : ""}
                                  ${showAuthDocExpiryDate && authDocExpiryDate ? `<span style="color: #64748b;">تاريخ الانتهاء: <span class="font-mono" style="color: #e11d48; font-weight: bold;">${formatDateParts(authDocExpiryDate).gregorian}</span></span>` : ""}
                                </div>
                              `
                                  : ""
                              }
                            </div>
                            `
                                : ""
                            }
                            
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">رقم الجوال:</span> <span class="font-mono" style="font-weight: 900; color: #1e293b;">${repPhone || "............................"}</span></div>
                            <div style="margin-top: 24px; text-align: center; color: #94a3b8; font-weight: bold;">التوقيع الشخصي والختم:<br/><span style="display: inline-block; margin-top: 16px;">........................................</span></div>
                          </td>
                          <td style="padding: 12px; vertical-align: top; border-bottom: none;">
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">اسم المنشأة الهندسية:</span> <span style="font-weight: 900; color: #1e293b;">شركة ديتيلز كونسولتس | Details consults</span></div>
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">إسم ممثل مقدم الخدمة:</span> <span style="font-weight: 900; color: #1e293b;">${firstPartyRep || "__________________"}</span></div>
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">صفة ممثل مقدم الخدمة:</span> <span style="font-weight: 900; color: #1e293b;">${firstPartyRepCapacity || "__________________"}</span></div>
                            ${showFirstPartyEmpId ? `<div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">الرقم الوظيفي:</span> <span class="font-mono" style="font-weight: 900; color: #1e293b;">${firstPartyEmpCode || "__________________"}</span></div>` : ""}
                            
                            <div style="margin-top: 24px; text-align: center; color: #94a3b8; font-weight: bold;">
                              التوقيع الشخصي والختم:<br/>
                              ${firstPartySignatureType === "SYSTEM" && employeeSignatureUrl ? `<img src="${employeeSignatureUrl}" style="height: 64px; margin-top: 8px; mix-blend-mode: multiply; object-fit: contain;" />` : `<span style="display: inline-block; margin-top: 16px;">........................................</span>`}
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                </td>
              </tr>
            </tbody>

            <tfoot style="display: table-footer-group;">
              <tr>
                <td style="border: none; padding: 20px 60px 40px 60px;">
                  <div style="border-top: 2.5px solid #123f59; padding-top: 12px; direction: ltr;">
                    <div style="display: flex; align-items: flex-start; gap: 12px; color: #123f59;">
                      
                      <div style="height: 16mm; width: 16mm; flex-shrink: 0; border: 1px dashed #cbd5e1; border-radius: 8px; background-color: rgba(248, 250, 252, 0.5); display: flex; align-items: center; justify-content: center; box-sizing: border-box;">
                        <span style="font-size: 7px; color: #94a3b8; font-weight: 900; text-align: center; line-height: 1.2;">QR<br/>للتحقق</span>
                      </div>
                      
                      <div style="min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; padding-top: 4px;">
                        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px; white-space: nowrap; font-size: 10.5px; font-weight: 900; line-height: 1.4; direction: rtl;">
                          <span>📍</span>
                          <span>حي الملك فهد - الرياض - المملكة العربية السعودية - الرمز البريدي : ١٢٢٧٤</span>
                          <span style="opacity: 0.5;">·</span>
                          <span>جوال : ٠٥٩٠٧٢٢٨٢٧</span>
                          <span style="opacity: 0.5;">·</span>
                          <span>الرقم الوطني الموحد : ٧٠٥٢٣٠٣٨٢٨</span>
                        </div>
                        <div style="margin-top: 4px; display: flex; align-items: center; justify-content: flex-start; gap: 4px; white-space: nowrap; font-size: 10px; font-weight: 900; line-height: 1.4; direction: ltr;">
                          <span>📍</span>
                          <span>King Fahd Dist - RIYADH - Kingdom of Saudi Arabia - POSTAL CODE : 12274</span>
                          <span style="margin-left: 4px;">☎</span>
                          <span>0590722827</span>
                          <span style="margin-left: 4px;">- N.N:</span>
                          <span>7052303828</span>
                          <span style="margin-left: 4px;">✉</span>
                          <span>info@details-consults.sa</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </tfoot>
            
          </table>
        </div>

      </body>
      </html>
    `;

    const form = new FormData();
    form.append("files", Buffer.from(htmlContent, "utf-8"), {
      filename: "index.html",
      contentType: "text/html",
    });
    form.append("paperWidth", "8.27");
    form.append("paperHeight", "11.69");
    form.append("marginTop", "0");
    form.append("marginBottom", "0");
    form.append("marginLeft", "0");
    form.append("marginRight", "0");
    form.append("printBackground", "true");
    form.append("waitDelay", "1.5s");

    const response = await axios.post(
      "http://127.0.0.1:3000/forms/chromium/convert/html",
      form,
      {
        headers: { ...form.getHeaders() },
        responseType: "arraybuffer",
      },
    );

    const pdfBuffer = Buffer.from(response.data);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": pdfBuffer.length,
      "Content-Disposition": `attachment; filename="${referenceNumber}.pdf"`,
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

// الدالة الجديدة
const generateAndSavePdf = async (req, res) => {
  console.log("=========================================");
  console.log("▶️ [BACKEND - 1] تم استلام طلب توليد الـ PDF");

  try {
    const data = req.body;

    const {
      transactionType,
      licenseNumber,
      licenseYear,
      serviceNumber,
      serviceYear,
      clientTitle,
      clientNameForPreview,
      clientCodeForPreview,
      validityDays,
      showPropertyCode,
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
      boundaries = [],
      employeeName = "إدارة المشاريع وعقود العملاء",
      employeeId = "SYS-109",
      taxRate = 15,
      acceptedMethods = [],
      missingDocs = "",
      showMissingDocs = false,
      deedNumber,
      clientType = "فرد",
      signatureMethod = "SELF",
      repName,
      repIdNumber,
      repPhone,
      repCapacity,
      authDocType,
      authDocNumber,
      authDocDate,
      issueDate,
      handlingMethod = "المالك مباشرة",
      firstPartyName,
      firstPartyRep,
      secondPartyName,
      secondPartyRep,
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

      // 🚀 الحقول الجديدة
      authDocIssueDate,
      showAuthDocIssueDate,
      authDocExpiryDate,
      showAuthDocExpiryDate,
      customUsufructType,
      documentType,
    } = data;

    const quotationId = data.quotationId;

    if (!quotationId) {
      console.log("❌ [BACKEND - ERROR] معرف العرض غير موجود!");
      return res
        .status(400)
        .json({ success: false, message: "معرف العرض غير موجود" });
    }

    // حساب الحالة واللون للـ PDF
    let badgeText = "مسودة غير معتمدة";
    let badgeColor = "#b45309";
    let badgeBg = "#fffbeb";
    let badgeBorder = "#fde68a";

    const isFullyApproved =
      status === "ACCEPTED" || status === "PARTIALLY_PAID";
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
      badgeColor = "#334155";
      badgeBg = "#f1f5f9";
      badgeBorder = "#cbd5e1";
    } else if (isCancelled) {
      badgeText = "ملغي";
      badgeColor = "#b91c1c";
      badgeBg = "#fef2f2";
      badgeBorder = "#fecaca";
    } else if (isFullyApproved) {
      badgeText = "معتمد من جميع الأطراف";
      badgeColor = "#047857";
      badgeBg = "#ecfdf5";
      badgeBorder = "#a7f3d0";
    } else if (isOfficeApproved) {
      badgeText = "معتمد من مقدم الخدمة فقط";
      badgeColor = "#1d4ed8";
      badgeBg = "#eff6ff";
      badgeBorder = "#bfdbfe";
    }

    const referenceNumber =
      data.referenceNumber || `QT-${Date.now().toString().slice(-5)}`;
    const formatCurrency = (value) =>
      Number(value || 0).toLocaleString("ar-SA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const formatArea = (value) =>
      Number(value || 0).toLocaleString("en-US", {
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

    const calculatedOfficeDiscount = (taxAmount * officeTaxBearing) / 100;
    const finalPayable =
      (grandTotal || subtotal + taxAmount) - calculatedOfficeDiscount;

    const issueDateParts = formatDateParts(issueDate);

    let introText = `إشارة إلى طلبكم بخصوص تقديم عرض سعر خدمات (${transactionType || "الخدمات الهندسية والاستشارية"})`;
    if (handlingMethod)
      introText += `، بناءً على أسلوب التعامل والتفويض المعتمد (${handlingMethod})`;
    introText +=
      "، فإنه يسرنا تقديم العرض المالي والفني لإنهاء الأعمال المطلوبة وفقاً لنطاق العمل والاشتراطات والملاحظات التالية:";

    // الأيقونات كـ SVG مباشر للمطابقة مع الواجهة الأمامية
    const icons = {
      scale: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #059669; margin-top: 2px;"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>`,
      userCheck: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c5983c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>`,
      building: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c5983c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>`,
      fileText: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c5983c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
      dollarSign: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c5983c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
      folderOpen: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c5983c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/></svg>`,
      alertTriangle: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    };

    const logoUrl = "https://details-worksystem1.com/logo.svg"; // تأكد من استخدام الرابط المناسب
    const SECURITY_BACKGROUNDS = {
      none: "none",
      official1:
        "url('https://details-worksystem1.com/safe_background/1.webp')",
      official2:
        "url('https://details-worksystem1.com/safe_background/2.webp')",
      official3:
        "url('https://details-worksystem1.com/safe_background/3.webp')",
    };
    const finalBgUrl =
      SECURITY_BACKGROUNDS[bgType] || SECURITY_BACKGROUNDS["official1"];

    let clientRepresentationHTML = "";
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

      clientRepresentationHTML = `
      <div style="margin-top: 8px; margin-bottom: 16px; display: flex; align-items: flex-start; gap: 8px; font-size: 12px; font-weight: bold; color: #334155; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
        <div style="flex-shrink: 0;">${icons.scale}</div>
        <p style="margin: 0; line-height: 1.6;">${clientRepText}</p>
      </div>`;
    }

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
        if (plots[i].deedDate === plots[i - 1].deedDate) {
          rowSpans.date[currentIdx.date] += 1;
          rowSpans.date[i] = 0;
        } else {
          rowSpans.date[i] = 1;
          currentIdx.date = i;
        }
      }
    }

    const paymentMethodsLabels = {
      bank: "تحويل بنكي",
      cash: "نقدي",
      sadad: "رقم سداد",
      pos: "دفع الكترونى POS",
    };

    let bankAccountsHTML = "";
    if (acceptedMethods.includes("bank") && selectedBankAccounts.length > 0) {
      const bankPromises = selectedBankAccounts.map(async (bankId) => {
        const bank = bankAccountsData.find((b) => b.id === bankId);
        if (!bank) return "";

        return `
        <tr style="background-color: #ffffff;">
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">
             <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;">
                ${bank.logo ? `<img src="${bank.logo}" style="width: 24px; height: 24px; object-fit: contain; flex-shrink: 0;" />` : `<div style="width: 20px; height: 20px;">${icons.building}</div>`}
                <span style="font-weight: 900; color: #123f59; font-size: 10.5px;">${bank.name}</span>
             </div>
          </td>
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle; color: #475569; font-size: 10.5px; line-height: 1.6;">
             <div style="font-weight: bold; color: #1e293b;">${bank.accountNameAr || bank.accountName || "---"}</div>
             <div style="direction: ltr; margin-top: 2px;">${bank.accountNameEn || "---"}</div>
          </td>
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">
             <div style="font-family: monospace; font-weight: bold; color: #1e293b; font-size: 10.5px; direction: ltr; letter-spacing: 1px;">
               ${bank.accountNumber || "---"}
             </div>
          </td>
          <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; vertical-align: middle;">
             <div style="font-family: monospace; font-weight: 900; color: #3730a3; font-size: 10.5px; direction: ltr; letter-spacing: 1.5px;">
               ${formatIBAN(bank.iban)}
             </div>
          </td>
          <td style="padding: 4px; border: 1px solid #123f5944; text-align: center; vertical-align: middle;">
            <div style="display: flex; flex-direction: column; align-items: center;">
                <img 
                  src="${bank.qrCodeData}" 
                  alt="Bank QR"
                  style="width: 60px; height: 60px; object-fit: contain; margin-bottom: 2px; border: 1px solid #f1f5f9; padding: 2px; border-radius: 4px; background: #fff; image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;" 
                />
            </div>
          </td>
        </tr>`;
      });
      const resolvedBanks = await Promise.all(bankPromises);

      bankAccountsHTML = `
      <div style="border-top: 1px solid #d8b46a33; margin-top: 4px; padding-top: 12px;">
        <span style="font-weight: 900; color: #123f59; display: block; margin-bottom: 8px; text-align: right; font-size: 11px;">البيانات البنكية المعتمدة للسداد:</span>
        <table style="width: 100%; border-collapse: collapse; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); text-align: center;">
          <thead style="background-color: rgba(241, 245, 249, 0.8);">
            <tr>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">البنك</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">اسم المستفيد</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">رقم الحساب</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 9px; font-weight: 900; color: #475569;">الآيبان / IBAN</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0; font-size: 8px; font-weight: 900; color: #475569; width: 15%;">QR للنسخ والمشاركة</th>
            </tr>
          </thead>
          <tbody>
            ${resolvedBanks.join("")}
          </tbody>
        </table>
      </div>`;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
        <style>
          @page { size: A4; margin: 0; }
          body { 
            font-family: 'Tajawal', sans-serif; 
            margin: 0; padding: 0; color: #123f59; 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important;
            background-color: #e8edf0;
          }
          /* التعديل هنا: تغيير min-height */
          .page-container {
            width: 794px; min-height: 100vh; padding: 60px 70px;
            box-sizing: border-box; background-color: #ffffff;
            position: relative; page-break-after: always;
            overflow: hidden;
            background-image: ${finalBgUrl};
            background-size: 794px 1123px;
            background-repeat: repeat-y;
            background-position: top center;
          }
          .content { position: relative; z-index: 1; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 11px; }
          th, td { border: 1px solid #123f59; padding: 8px; text-align: center; }
          th { background-color: #123f59; color: #fff; font-weight: 900; }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
          
          .bg-slate-50 { background-color: #f8fafc; }
          .text-slate-500 { color: #64748b; }
          .text-slate-700 { color: #334155; }
          .text-slate-800 { color: #1e293b; }
          .text-emerald-800 { color: #065f46; }
          .font-bold { font-weight: bold; }
          .font-black { font-weight: 900; }
          .font-mono { font-family: monospace; }
          .section-title { 
            font-size: 11.5px; font-weight: 900; color: #123f59; margin-bottom: 8px; 
            border-bottom: 2px solid #123f59; padding-bottom: 4px; display: inline-block;
          }
        </style>
      </head>
      <body>
        
        <div class="page-container" style="display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
          <div style="position: absolute; top: 32px; left: 32px; z-index: 20;">
            <div style="padding: 8px 16px; border-radius: 12px; border: 2px solid ${badgeBorder}; background-color: ${badgeBg}; color: ${badgeColor}; font-weight: 900; font-size: 12px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
              ${badgeText}
            </div>
          </div>
          <div class="content" style="width: 100%; padding: 80px 0;">
            <div style="width: 300px; margin: 0 auto 60px auto;">
              <img src="${logoUrl}" alt="Logo" style="max-width: 100%; mix-blend-mode: multiply;" />
            </div>

            <div style="width: 80%; margin: 0 auto; border-top: 5px solid #123f59; border-bottom: 5px solid #123f59; padding: 48px 0; margin-bottom: 32px;">
              <h1 style="font-size: 42px; font-weight: 900; color: #123f59; margin-bottom: 24px; margin-top: 0; line-height: 1.2;">
                ${documentType || "عرض سعر فني ومالي"}
              </h1>
              <h2 style="font-size: 22px; font-weight: bold; color: #475569; margin: 0;">${transactionType || "خدمات هندسية واستشارية استراتيجية"}</h2>
            </div>

            <div style="width: 100%; text-align: right; background-color: transparent; padding: 32px; border-radius: 24px; border: 1px solid rgba(216,180,106,0.3); box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); box-sizing: border-box;">
              <p style="font-size: 16px; font-weight: 900; color: #64748b; margin-top: 0; margin-bottom: 12px;">مقدم إلى السادة / الطرف الثاني:</p>
              <p style="font-size: 34px; font-weight: 900; color: #123f59; margin-top: 0; margin-bottom: 32px; line-height: 1.2;">${clientTitle} / ${secondPartyName || clientNameForPreview}</p>

              <table style="border: none; font-size: 14px; font-weight: bold; color: #334155; margin-bottom: 0;">
                <tr>
                  <td style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 4px 0; width: 50%;"><span style="color: #64748b; font-size: 12px;">رقم العرض /الرقم المرجعي:</span> <span style="color: #0f172a; font-weight: 900; font-size: 12px; font-family: monospace;">${referenceNumber}</span></td>
                  <td style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 4px 0; width: 50%;"><span style="color: #64748b;">تاريخ الإصدار:</span> <span style="color: #0f172a; font-family: monospace;">${issueDateParts.gregorian}</span></td>
                </tr>
                ${
                  transactionRefForPreview || meetingTitleForPreview
                    ? `
                <tr>
                  ${transactionRefForPreview ? `<td colspan="${meetingTitleForPreview ? "1" : "2"}" style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 4px 0;"><span style="color: #64748b;"> الرقم الداخلي للمعاملة:</span> <span style="color: #0f172a; font-weight: 900; font-family: monospace;">${transactionRefForPreview}</span></td>` : '<td style="border: none; border-bottom: 1px dashed #cbd5e1;"></td>'}
                  ${meetingTitleForPreview ? `<td colspan="${transactionRefForPreview ? "1" : "2"}" style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 4px 0;"><span style="color: #64748b;">استناداً لمحضر اجتماع:</span> <span style="color: #0f172a; font-weight: 900; font-family: monospace;">${meetingTitleForPreview}</span></td>` : '<td style="border: none; border-bottom: 1px dashed #cbd5e1;"></td>'}
                </tr>`
                    : ""
                }
                ${
                  propertyCodeForPreview
                    ? `
                <tr>
                  <td colspan="2" style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 4px 0;"><span style="color: #64748b;">المشروع/الملكية:</span> <span style="color: #0f172a; font-weight: 900; font-family: monospace;">${propertyCodeForPreview}</span></td>
                </tr>`
                    : ""
                }
              </table>
            </div>
            
            <div style="margin-top: 32px;">
              <p style="font-size: 13px; font-weight: 900; color: #94a3b8;">${firstPartyName || "شركة ديتيلز كونسولتس للاستشارات الهندسية"}</p>
            </div>
          </div>
        </div>

        <div class="page-container" style="padding: 0;">
          <table style="width: 100%; border: none; margin: 0; position: relative; z-index: 1;">
            <thead style="display: table-header-group;">
              <tr>
                <td style="border: none; padding: 60px 70px 20px 70px;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #123f59; padding-bottom: 16px;">
                    <div style="height: 64px; width: 192px;">
                      <img src="${logoUrl}" alt="Logo" style="max-height: 100%; max-width: 100%; mix-blend-mode: multiply;" />
                    </div>
                    <div style="width: 280px;">
                      <table style="width: 100%; text-align: right; border-collapse: collapse; font-size: 10px; font-weight: bold; border: 1px solid #123f5944; margin: 0; background: transparent;">
<tr><td style="border: 1px solid #123f5944; width: 35%; color: #475569; padding: 8px;">نوع المستند</td><td style="border: 1px solid #123f5944; color: #123f59; font-weight: 900; font-size: 12px; padding: 8px;">${documentType || "عرض سعر فني ومالي"}</td></tr>                        <tr><td style="border: 1px solid #123f5944; color: #475569; padding: 8px;">التاريخ</td><td style="border: 1px solid #123f5944; color: #123f59; font-size: 9px; font-weight: bold; padding: 7px;">${issueDateParts.combined}</td></tr>
                        <tr><td style="border: 1px solid #123f5944; color: #475569; padding: 8px;">رقم المرجع</td><td style="border: 1px solid #123f5944; font-weight: 900; color: #123f59; font-family: monospace; font-size: 11px; padding: 8px;">${referenceNumber}</td></tr>
                      </table>
                    </div>
                  </div>
                </td>
              </tr>
            </thead>

            <tbody style="display: table-row-group;">
              <tr>
                <td style="border: none; padding: 0px 70px 20px 70px;">
                  
                  <table style="width: 100%; text-align: right; border-collapse: collapse; font-size: 10px; font-weight: bold; border: 1px solid #123f5944; margin: 16px 0 24px 0; background: transparent;">
                    <tr>
                      <td class="bg-slate-50 text-slate-500" style="width: 20%; border: 1px solid #123f5944; padding: 8px;">نوع الخدمة</td>
                      <td class="font-black" style="width: 30%; color: #123f59; border: 1px solid #123f5944; padding: 8px;">${transactionType || "عرض سعر خدمات فنية"}</td>
                      <td class="bg-slate-50 text-slate-500" style="width: 20%; border: 1px solid #123f5944; padding: 8px;">حالة المستند</td>
                      <td class="font-black" style="width: 30%; border: 1px solid #123f5944; padding: 8px; color: #b45309;">مسودة مراجعة داخلية</td>
                    </tr>
                    <tr>
                      <td class="bg-slate-50 text-slate-500" style="border: 1px solid #123f5944; padding: 8px;">رقم حساب العميل</td>
                      <td class="font-mono text-slate-800" style="border: 1px solid #123f5944; padding: 8px;">${clientCodeForPreview || "---"}</td>
                      <td class="bg-slate-50 text-slate-500" style="border: 1px solid #123f5944; padding: 8px;">رمز أرشفة المشروع</td>
                      <td class="font-mono text-slate-800" style="border: 1px solid #123f5944; padding: 8px;">${propertyCodeForPreview || "---"}</td>
                    </tr>
                    <tr>
                      <td class="bg-slate-50 text-slate-500" style="border: 1px solid #123f5944; padding: 8px;">مدة صلاحية العرض</td>
                      <td class="text-slate-800" style="border: 1px solid #123f5944; padding: 8px;">${validityDays === "unlimited" ? "مفتوح / غير محدد" : `${validityDays} يوماً تبدأ بعد اعتماد مقدم الخدمة`}</td>
                      <td class="bg-slate-50 text-slate-500" style="border: 1px solid #123f5944; padding: 8px;">نسخة الوثيقة</td>
                      <td class="font-mono text-slate-800" style="border: 1px solid #123f5944; padding: 8px;">v1.0</td>
                    </tr>
                  </table>

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin: 0 0 16px 0; font-size: 13px; font-weight: 900; color: #123f59;">${clientTitle} ${secondPartyName || clientNameForPreview}</h4>
                    ${clientRepresentationHTML}
                    <p style="margin: 0 0 12px 0; font-size: 12px; font-weight: 900; color: #123f59;">السلام عليكم ورحمة الله وبركاته ،،,</p>
                    <p style="margin: 0; font-size: 11.5px; font-weight: bold; color: #475569; line-height: 24px; text-align: right; white-space: pre-wrap; letter-spacing: 0px;">${introText}</p>
                  </div>

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin-bottom: 8px; font-size: 11.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: #123f59;">
                       ${icons.userCheck} أولاً: بيانات العميل والمالك وصاحب العلاقة الأصلي
                    </h4>
                    <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 10.5px; border: 1px solid #123f59; margin-bottom: 0;">
                      <tbody class="font-bold text-[#123f59]">
                        <tr>
                          <td class="bg-slate-50 w-1/4" style="border: 1px solid #123f5944; padding: 8px;">تصنيف العميل الكياني</td>
                          <td class="w-1/4" style="border: 1px solid #123f5944; padding: 8px;">${(clientType || "فرد").replace(/_/g, " ")}</td>
                          <td class="bg-slate-50 w-1/4" style="border: 1px solid #123f5944; padding: 8px;">اسم المالك المسجل بالتسجيل</td>
                          <td class="w-1/4 font-black text-[#123f59]" style="border: 1px solid #123f5944; padding: 8px;">${clientNameForPreview}</td>
                        </tr>
                        <tr>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">الصفة الرسمية للتعامل و الإعتماد</td>
                          <td style="border: 1px solid #123f5944; padding: 8px;">${handlingMethod}</td>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">رقم الجوال للاتصال</td>
                          <td class="font-mono text-blue-700" style="border: 1px solid #123f5944; padding: 8px;">${repPhone || "---"}</td>
                        </tr>
                        
                      </tbody>
                    </table>
                  </div>

                  ${
                    signatureMethod !== "SELF"
                      ? `
                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <div class="section-title">ثانياً: بيانات التمثيل النظامي والمفوض بالتوقيع الشرعي</div>
                    <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 10.5px; border: 1px solid #123f59; margin-bottom: 0;">
                      <tbody class="font-bold text-[#123f59]">
                        <tr>
                          <td class="bg-slate-50 w-1/4" style="border: 1px solid #123f5944; padding: 8px;">اسم المفوض / الممثل</td>
                          <td class="w-1/4 font-black" style="border: 1px solid #123f5944; padding: 8px;">${repName || "---"}</td>
                          <td class="bg-slate-50 w-1/4" style="border: 1px solid #123f5944; padding: 8px;">رقم السجل المدني / الهوية</td>
                          <td class="w-1/4 font-mono font-black" style="border: 1px solid #123f5944; padding: 8px;">${repIdNumber || "---"}</td>
                        </tr>
                        <tr>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">الصفة القانونية للتمثيل</td>
                          <td style="border: 1px solid #123f5944; padding: 8px;">
                            ${signatureMethod === "AGENT" ? "وكيل شرعي" : signatureMethod === "AUTHORIZED" ? "مفوض نظامي" : "مستفيد"}
                          </td>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">رقم جوال الممثل</td>
                          <td class="font-mono text-blue-700" style="border: 1px solid #123f5944; padding: 8px;">${repPhone || "---"}</td>
                        </tr>
                        <tr>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">نوع مستند التفويض والصفة</td>
                          <td class="font-black text-slate-700" style="border: 1px solid #123f5944; padding: 8px;">
                             ${authDocType === "مستند انتفاع" && customUsufructType ? customUsufructType : authDocType || "---"}
                          </td>
                          <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px;">بيانات المستند المعتمد</td>
                          <td class="font-mono font-bold text-cyan-800" style="border: 1px solid #123f5944; padding: 8px; line-height: 1.6;">
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                              <span>${authDocNumber ? `رقم: ${authDocNumber}` : "رقم: ---"}</span>
                              ${showAuthDocIssueDate && authDocIssueDate ? `<span style="font-size: 9px; color: #64748b;">إصدار: ${formatDateParts(authDocIssueDate).gregorian}</span>` : ""}
                              ${showAuthDocExpiryDate && authDocExpiryDate ? `<span style="font-size: 9px; color: #e11d48;">انتهاء: ${formatDateParts(authDocExpiryDate).gregorian}</span>` : ""}
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>`
                      : ""
                  }

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px;">
                      <h4 style="margin: 0; font-size: 11.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: #123f59;">
                        ${icons.building} ${signatureMethod !== "SELF" ? "ثالثاً" : "ثانياً"}: بيانات المشروع والملكية العقارية
                      </h4>
                      ${
                        plots && plots.length > 0
                          ? `
                      <span style="font-size: 10px; font-weight: bold; color: #64748b; background-color: #fff; padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 6px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
                        عدد القطع: ${plots.length} | إجمالي المساحة: ${formatArea(totalPlotsArea)} م² | كود الملف: ${propertyCodeForPreview || "---"}
                      </span>
                      `
                          : ""
                      }
                    </div>

                    ${
                      plots && plots.length > 0
                        ? `
                    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 10.5px; border: 1px solid #123f59; margin-bottom: 0;">
                      <thead style="background-color: #123f59; color: #fff; font-weight: 900;">
                        <tr><th style="padding: 8px; border: 1px solid #123f59; width: 5%;">م</th><th style="padding: 8px; border: 1px solid #123f59;">رقم القطعة</th><th style="padding: 8px; border: 1px solid #123f59;">الحي</th><th style="padding: 8px; border: 1px solid #123f59;">رقم المخطط التنظيمي</th><th style="padding: 8px; border: 1px solid #123f59;">رقم وثيقة الملكية</th><th style="padding: 8px; border: 1px solid #123f59;">تاريخ الوثيقة</th><th style="padding: 8px; border: 1px solid #123f59;">مساحة القطعة</th></tr>
                      </thead>
                      <tbody style="font-weight: bold; color: #123f59;">
                        ${plots
                          .map(
                            (plot, i) => `
                        <tr>
                          <td style="padding: 8px; border: 1px solid #123f5944; background-color: rgba(248, 250, 252, 0.5);">${i + 1}</td>
                          <td class="font-mono" style="padding: 8px; border: 1px solid #123f5944;">${plot.plotNumber || "---"}</td>
                          ${rowSpans.district[i] > 0 ? `<td rowspan="${rowSpans.district[i]}" style="padding: 8px; border: 1px solid #123f5944; vertical-align: middle;">${plot.district || propertyDistrict || "---"}</td>` : ""}
                          ${rowSpans.plan[i] > 0 ? `<td rowspan="${rowSpans.plan[i]}" class="font-mono text-slate-700" style="padding: 8px; border: 1px solid #123f5944; vertical-align: middle;">${plot.planNumber || propertyPlanNumber || "---"}</td>` : ""}
                          ${rowSpans.deed[i] > 0 ? `<td rowspan="${rowSpans.deed[i]}" class="font-mono text-emerald-800 font-black" style="padding: 8px; border: 1px solid #123f5944; vertical-align: middle;">${plot.deedNumber || deedNumber || "---"}</td>` : ""}
                          ${rowSpans.date[i] > 0 ? `<td rowspan="${rowSpans.date[i]}" class="font-mono text-slate-600" style="padding: 8px; border: 1px solid #123f5944; vertical-align: middle;">${plot.deedDate ? formatDateParts(plot.deedDate).gregorian : "---"}</td>` : ""}
                          <td class="font-mono" style="padding: 8px; border: 1px solid #123f5944;">${formatArea(plot.area)} م²</td>
                        </tr>`,
                          )
                          .join("")}
                        <tr class="bg-slate-50">
                          <td colspan="6" class="text-left font-black" style="padding: 8px; border: 1px solid #123f5944;">إجمالي مساحة الموقع:</td>
                          <td class="font-mono font-black text-[12px] text-emerald-800" style="padding: 8px; border: 1px solid #123f5944;">${formatArea(totalPlotsArea)} م²</td>
                        </tr>
                      </tbody>
                    </table>`
                        : `
                    <div style="padding: 16px; border: 1px dashed #cbd5e1; border-radius: 12px; text-align: center; color: #94a3b8; font-size: 12px; font-weight: bold;">
                      لا توجد قطع مضافة في ملف الملكية المرفق
                    </div>`
                    }
                    
                    ${
                      licenseNumber || serviceNumber
                        ? `
                  <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 10.5px; border: 1px solid #123f59; margin-top: 12px; margin-bottom: 0;">
                    <tbody class="font-bold text-[#123f59]">
                      <tr>
                        ${
                          licenseNumber
                            ? `
                        <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px; width: 25%;">رقم وتاريخ رخصة البناء</td>
                        <td class="font-mono" style="border: 1px solid #123f5944; padding: 8px; width: ${licenseNumber && serviceNumber ? "25%" : "75%"};">${licenseNumber} لعام ${licenseYear}هـ</td>`
                            : ""
                        }
                        ${
                          serviceNumber
                            ? `
                        <td class="bg-slate-50" style="border: 1px solid #123f5944; padding: 8px; width: 25%;">رقم وتاريخ المعاملة / الطلب</td>
                        <td class="font-mono" style="border: 1px solid #123f5944; padding: 8px; width: ${licenseNumber && serviceNumber ? "25%" : "75%"};">${serviceNumber} لعام ${serviceYear}هـ</td>`
                            : ""
                        }
                      </tr>
                    </tbody>
                  </table>`
                        : ""
                    }
                  </div>

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin-bottom: 8px; font-size: 11.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: #123f59;">
                       ${icons.fileText} ${signatureMethod !== "SELF" ? "رابعاً" : "ثالثاً"}: نطاق الأعمال وقائمة التكاليف المالية
                    </h4>
                    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 10.5px; border: 1px solid #123f59; margin-bottom: 0; table-layout: fixed;">
                      <thead style="background-color: #123f59; color: #fff; font-weight: 900;">
                        <tr>
                          <th style="padding: 10px; border: 1px solid #123f59; width: 5%;">م</th>
                          <th style="padding: 10px; text-align: right; border: 1px solid #123f59; width: ${showQuantity ? "80%" : "95%"};">وصف الخدمة الاستشارية / نطاق العمل الفني</th>
                          ${showQuantity ? `<th style="padding: 10px; border: 1px solid #123f59; width: 15%;">الكمية</th>` : ""}
                        </tr>
                      </thead>
                      <tbody class="font-bold text-[#123f59]">
                        ${
                          items.length === 0
                            ? `<tr><td colspan="${showQuantity ? "3" : "2"}" style="padding: 24px; color: #94a3b8;">لا توجد بنود فنية مسجلة حتى الآن</td></tr>`
                            : items
                                .map(
                                  (item, index) => `
                        <tr>
                          <td class="font-mono" style="padding: 8px; border: 1px solid #123f5944; vertical-align: top;">${index + 1}</td>
                          <td class="text-right" style="padding: 8px; border: 1px solid #123f5944; line-height: 1.6; word-wrap: break-word; white-space: pre-wrap;">${item.title}</td>
                          ${showQuantity ? `<td class="font-mono" style="padding: 8px; border: 1px solid #123f5944; vertical-align: top;">${item.qty || item.quantity || 1} ${item.unit || ""}</td>` : ""}
                        </tr>`,
                                )
                                .join("")
                        }
                        
                        <tr class="bg-slate-50">
                          <td colspan="${showQuantity ? "3" : "2"}" style="padding: 0; border: 1px solid #123f5944;">
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; box-sizing: border-box;">
                              <span class="font-black">المجموع الفرعي</span>
                              <span class="font-mono font-black" style="font-size: 12px; color: #1e293b;">${formatCurrency(subtotal)} ر.س</span>
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td colspan="${showQuantity ? "3" : "2"}" style="padding: 0; border: 1px solid #123f5944;">
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; box-sizing: border-box;">
                              <span style="font-weight: bold; color: #64748b;">ضريبة القيمة المضافة ${taxRate || 15}% ${officeTaxBearing > 0 ? `(يتحمل المكتب ${officeTaxBearing}%)` : ""}</span>
                              <span class="font-mono font-bold" style="font-size: 12px; color: #334155;">${formatCurrency(taxAmount)} ر.س</span>
                            </div>
                          </td>
                        </tr>
                        ${
                          officeTaxBearing > 0
                            ? `
                        <tr>
                          <td colspan="${showQuantity ? "3" : "2"}" style="padding: 0; border: 1px solid #123f5944;">
                             <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; box-sizing: border-box; color: #047857;">
                              <span style="font-weight: bold;">خصم إعفاء ضريبي ضِمني (المكتب يتحمل نسبة ${officeTaxBearing}%)</span>
                              <span class="font-mono font-black" style="font-size: 12px;">- ${formatCurrency(calculatedOfficeDiscount)} ر.س</span>
                             </div>
                          </td>
                        </tr>`
                            : ""
                        }
                        <tr class="font-black text-white" style="background-color: #123f59;">
                          <td colspan="${showQuantity ? "3" : "2"}" style="padding: 0; border: 1px solid #123f5944;">
                             <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; box-sizing: border-box;">
                              <span style="font-size: 12.5px;">الإجمالي النهائي المستحق الصافي للدفع</span>
                              <span class="font-mono" style="font-size: 13.5px;">${formatCurrency(finalPayable)} ر.س</span>
                             </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  ${
                    (paymentsList && paymentsList.length > 0) ||
                    (acceptedMethods && acceptedMethods.length > 0)
                      ? `
                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin-bottom: 8px; font-size: 11.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: #123f59;">
                       ${icons.dollarSign} ${signatureMethod !== "SELF" ? "خامساً" : "رابعاً"}: الجدول الزمني للدفعات المالية
                    </h4>
                    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 10.5px; border: 1px solid #123f59; margin-bottom: 0;">
                      <thead style="background-color: #123f59; color: #fff; font-weight: 900;">
                        <tr><th style="padding: 10px; border: 1px solid #123f59; width: 20%;">الدفعة</th><th style="padding: 10px; border: 1px solid #123f59; width: 15%;">النسبة (%)</th><th style="padding: 10px; border: 1px solid #123f59; width: 25%;">المبلغ (شامل الضريبة)</th><th style="padding: 10px; border: 1px solid #123f59; width: 40%;">الاستحقاق</th></tr>
                      </thead>
                      <tbody class="font-bold text-[#123f59]">
                        ${paymentsList
                          .map(
                            (payment, index) => `
                        <tr>
                          <td style="padding: 8px; border: 1px solid #123f5944; background-color: rgba(248,250,252,0.5);">${payment.label || `الدفعة ${index + 1}`}</td>
                          <td class="font-mono text-slate-700" style="padding: 8px; border: 1px solid #123f5944;">${payment.percentage || Math.round(100 / paymentsList.length)}%</td>
                          <td class="font-mono font-black text-emerald-800" style="background-color: rgba(236,253,245,0.2); padding: 8px; border: 1px solid #123f5944;">${formatCurrency(payment.amount)} ر.س</td>
                          <td class="text-right text-[#556575]" style="padding: 8px 12px; border: 1px solid #123f5944; line-height: 1.5;">${payment.condition || "حسب الاتفاق وجداول إنجاز الأعمال الفنية"}</td>
                        </tr>`,
                          )
                          .join("")}
                        
                        ${
                          acceptedMethods && acceptedMethods.length > 0
                            ? `
                        <tr class="bg-slate-50">
                          <td colspan="4" class="text-right text-[10.5px] text-[#475569]" style="padding: 12px; border: 1px solid #123f5944;">
                            <div style="margin-bottom: 4px;">
                              <span class="font-black text-slate-800 ml-2">طرق السداد المتاحة:</span>
                              ${acceptedMethods.map((m) => paymentMethodsLabels[m] || m).join(" ، ")}
                            </div>
                            ${bankAccountsHTML}
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
                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin-bottom: 12px; font-size: 11.5px; font-weight: 900; display: flex; align-items: center; gap: 6px; color: #123f59;">
                       ${icons.folderOpen} ${signatureMethod !== "SELF" ? "سادساً" : "خامساً"}: المستندات والمسوغات المطلوب توفيرها من طرفكم لبدء العمل
                    </h4>
                    <div style="border: 1px solid rgba(18,63,89,0.2); border-radius: 14px; background-color: #fff; overflow: hidden;">
                      <div style="background-color: rgba(18,63,89,0.04); padding: 10px 16px; border-bottom: 1px solid rgba(18,63,89,0.13); display: flex; align-items: center; gap: 8px;">
                        ${icons.alertTriangle}
                        <span style="color: #123f59; font-weight: 900; font-size: 10px;">نأمل منكم التكرم بتجهيز المستندات التالية وتسليمها للمكتب ليتسنى لنا البدء في تنفيذ الأعمال:</span>
                      </div>
                      <div style="padding: 16px;">
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                          ${missingDocs
                            // 🌟 التعديل هنا: استخدام تعبير نمطي قوي لالتقاط الأسطر الجديدة في جميع المتصفحات والأنظمة
                            .split(/\r?\n/)
                            .filter((d) => d.trim() !== "")
                            .map(
                              (doc, idx) => `
                            <div style="display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 8px; background-color: rgba(248,250,252,0.5); border: 1px solid rgba(241,245,249,0.8);">
                              <span style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; font-size: 10px; font-weight: bold; color: #fff; background-color: #123f59; margin-top: 2px;">
                                ${idx + 1}
                              </span>
                              <span style="font-size: 11px; font-weight: bold; color: #334155; line-height: 1.6;">${doc.replace(/^- /, "").trim()}</span>
                            </div>`,
                            )
                            .join("")}
                        </div>
                      </div>
                    </div>
                  </div>`
                      : ""
                  }

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin-bottom: 8px; font-size: 11.5px; font-weight: 900; color: #123f59;">
                       ${signatureMethod !== "SELF" ? "سابعاً" : "سادساً"}: الشروط والأحكام والالتزامات العامة
                    </h4>
                    <div style="background-color: rgba(248, 250, 252, 0.3); padding: 8px; border-radius: 4px; border: 1px solid #f1f5f9; font-size: 11px; font-weight: bold; color: #475569; line-height: 24px; white-space: pre-wrap; text-align: right;">${termsText || "خاضع للشروط العامة المسجلة بالمكتب."}</div>
                  </div>

                  ${
                    conclusion && conclusion.trim() !== ""
                      ? `
                  <div class="avoid-break" style="margin-bottom: 32px;">
                    <div style="padding: 0 32px; font-size: 12px; font-weight: bold; color: #475569; line-height: 26px; white-space: pre-wrap; text-align: center;">${conclusion}</div>
                  </div>`
                      : ""
                  }

                  <div class="avoid-break" style="margin-top: 32px; padding-top: 16px;">
                    <h4 style="text-align: center; font-size: 12.5px; font-weight: 900; color: #123f59; margin-bottom: 16px;">صيغة الاعتماد والموافقة النهائية والتواقيع الرسمية</h4>
                    <table style="border: 2px solid #123f59; font-size: 10px; width: 100%; table-layout: fixed; background: transparent;">
                      <thead style="background-color: #123f59; color: #fff; font-weight: 900; font-size: 11.5px;">
                        <tr>
                          <th style="width: 50%; padding: 10px; border-left: 1px solid #123f5944;">الطرف الثاني: قبول وتوقيع العميل / ${signatureMethod === "AUTHORIZED" ? "المفوض" : signatureMethod === "AGENT" ? "الوكيل" : signatureMethod === "BENEFICIARY" ? "المستفيد" : "المالك"}</th>
                          <th style="width: 50%; padding: 10px;">الطرف الأول: اعتماد وختم مقدم الخدمة (المكتب)</th>
                        </tr>
                      </thead>
                      <tbody class="font-bold text-[#123f59]">
                        <tr>
                          <td style="padding: 12px; vertical-align: top; border-left: 1px solid #123f5944; border-bottom: none;">
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">اسم الجهة / العميل:</span> <span style="font-weight: 900; color: #1e293b;">${clientNameForPreview}</span></div>
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">يمثلها في التوقيع:</span> <span style="font-weight: 900; color: #1e293b;">${signatureMethod === "SELF" ? "المالك الفعلي ذو العلاقة" : repName || "............................"}</span></div>
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">الصفة والتمثيل الكياني:</span> <span style="font-weight: 900; color: #1e293b;">${signatureMethod === "SELF" ? "عن نفسه (المالك الأصلي)" : signatureMethod === "AGENT" ? "وكيل شرعي" : signatureMethod === "AUTHORIZED" ? "مفوض نظامي" : "مستفيد"}</span></div>
                            
                            ${
                              signatureMethod !== "SELF"
                                ? `
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">رقم الهوية / السجل:</span> <span class="font-mono" style="font-weight: 900; color: #1e293b;">${repIdNumber || "............................"}</span></div>
                            <div style="margin-bottom: 4px; line-height: 1.6;">
                              <span style="color: #64748b;">مستند التمثيل (${authDocType === "مستند انتفاع" && customUsufructType ? customUsufructType : authDocType || "الوكالة/التفويض"}):</span> 
                              <span class="font-mono" style="font-weight: 900; color: #164e63;">${authDocNumber ? `رقم (${authDocNumber})` : "............................"}</span>
                              ${
                                showAuthDocIssueDate || showAuthDocExpiryDate
                                  ? `
                                <div style="font-size: 9px; margin-top: 2px; display: flex; gap: 16px;">
                                  ${showAuthDocIssueDate && authDocIssueDate ? `<span style="color: #64748b;">تاريخ الإصدار: <span class="font-mono" style="color: #334155; font-weight: bold;">${formatDateParts(authDocIssueDate).gregorian}</span></span>` : ""}
                                  ${showAuthDocExpiryDate && authDocExpiryDate ? `<span style="color: #64748b;">تاريخ الانتهاء: <span class="font-mono" style="color: #e11d48; font-weight: bold;">${formatDateParts(authDocExpiryDate).gregorian}</span></span>` : ""}
                                </div>
                              `
                                  : ""
                              }
                            </div>
                            `
                                : ""
                            }
                            
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">رقم الجوال:</span> <span class="font-mono" style="font-weight: 900; color: #1e293b;">${repPhone || "............................"}</span></div>
                            <div style="margin-top: 24px; text-align: center; color: #94a3b8; font-weight: bold;">التوقيع الشخصي والختم:<br/><span style="display: inline-block; margin-top: 16px;">........................................</span></div>
                          </td>
                          <td style="padding: 12px; vertical-align: top; border-bottom: none;">
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">اسم المنشأة الهندسية:</span> <span style="font-weight: 900; color: #1e293b;">شركة ديتيلز كونسولتس | Details consults</span></div>
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">إسم ممثل مقدم الخدمة:</span> <span style="font-weight: 900; color: #1e293b;">${firstPartyRep || "__________________"}</span></div>
                            <div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">صفة ممثل مقدم الخدمة:</span> <span style="font-weight: 900; color: #1e293b;">${firstPartyRepCapacity || "__________________"}</span></div>
                            ${showFirstPartyEmpId ? `<div style="margin-bottom: 12px; line-height: 1.6;"><span style="color: #64748b;">الرقم الوظيفي:</span> <span class="font-mono" style="font-weight: 900; color: #1e293b;">${firstPartyEmpCode || "__________________"}</span></div>` : ""}
                            
                            <div style="margin-top: 24px; text-align: center; color: #94a3b8; font-weight: bold;">
                              التوقيع الشخصي والختم:<br/>
                              ${firstPartySignatureType === "SYSTEM" && employeeSignatureUrl ? `<img src="${employeeSignatureUrl}" style="height: 64px; margin-top: 8px; mix-blend-mode: multiply; object-fit: contain;" />` : `<span style="display: inline-block; margin-top: 16px;">........................................</span>`}
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
                <td style="border: none; padding: 20px 60px 40px 60px;">
                  <div style="border-top: 2.5px solid #123f59; padding-top: 12px; direction: ltr;">
                    <div style="display: flex; align-items: flex-start; gap: 12px; color: #123f59;">
                      
                      <div style="height: 16mm; width: 16mm; flex-shrink: 0; border: 1px dashed #cbd5e1; border-radius: 8px; background-color: rgba(248, 250, 252, 0.5); display: flex; align-items: center; justify-content: center; box-sizing: border-box;">
                        <span style="font-size: 7px; color: #94a3b8; font-weight: 900; text-align: center; line-height: 1.2;">QR<br/>للتحقق</span>
                      </div>
                      
                      <div style="min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; padding-top: 4px;">
                        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px; white-space: nowrap; font-size: 10.5px; font-weight: 900; line-height: 1.4; direction: rtl;">
                          <span>📍</span>
                          <span>حي الملك فهد - الرياض - المملكة العربية السعودية - الرمز البريدي : ١٢٢٧٤</span>
                          <span style="opacity: 0.5;">·</span>
                          <span>جوال : ٠٥٩٠٧٢٢٨٢٧</span>
                          <span style="opacity: 0.5;">·</span>
                          <span>الرقم الوطني الموحد : ٧٠٥٢٣٠٣٨٢٨</span>
                        </div>
                        <div style="margin-top: 4px; display: flex; align-items: center; justify-content: flex-start; gap: 4px; white-space: nowrap; font-size: 10px; font-weight: 900; line-height: 1.4; direction: ltr;">
                          <span>📍</span>
                          <span>King Fahd Dist - RIYADH - Kingdom of Saudi Arabia - POSTAL CODE : 12274</span>
                          <span style="margin-left: 4px;">☎</span>
                          <span>0590722827</span>
                          <span style="margin-left: 4px;">- N.N:</span>
                          <span>7052303828</span>
                          <span style="margin-left: 4px;">✉</span>
                          <span>info@details-consults.sa</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </tfoot>
            
          </table>
        </div>

      </body>
      </html>
    `;

    const form = new FormData();
    form.append("files", Buffer.from(htmlContent, "utf-8"), {
      filename: "index.html",
      contentType: "text/html",
    });
    form.append("paperWidth", "8.27");
    form.append("paperHeight", "11.69");
    form.append("marginTop", "0");
    form.append("marginBottom", "0");
    form.append("marginLeft", "0");
    form.append("marginRight", "0");
    form.append("printBackground", "true");
    form.append("waitDelay", "1.5s");

    const response = await axios.post(
      "http://gotenberg:3000/forms/chromium/convert/html",
      form,
      {
        headers: { ...form.getHeaders() },
        responseType: "arraybuffer",
      },
    );

    console.log("✅ [BACKEND - 4] تم استلام ملف الـ PDF من Gotenberg بنجاح!");
    const pdfBuffer = Buffer.from(response.data);

    // إنشاء المجلد
    const uploadsDir = path.join(__dirname, "../../uploads/quotations");
    console.log(`📂 [BACKEND - 5] مسار الحفظ: ${uploadsDir}`);

    if (!fs.existsSync(uploadsDir)) {
      console.log("🛠️ [BACKEND - 6] المجلد غير موجود، جاري إنشاؤه...");
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // تسمية وحفظ الملف
    const fileName = `QT_${quotationId}_${Date.now()}.pdf`;
    const filePath = path.join(uploadsDir, fileName);

    console.log(
      `💾 [BACKEND - 7] جاري كتابة الملف فعلياً في السيرفر: ${fileName}`,
    );
    fs.writeFileSync(filePath, pdfBuffer);

    // تحديث الداتا بيز
    const fileUrl = `/uploads/quotations/${fileName}`;
    console.log(`🔄 [BACKEND - 8] جاري تحديث الداتا بيز بالرابط: ${fileUrl}`);

    await prisma.quotation.update({
      where: { id: quotationId },
      data: { pdfUrl: fileUrl },
    });

    console.log("🎉 [BACKEND - 9] تمت العملية بنجاح تام!");
    res.json({
      success: true,
      pdfUrl: fileUrl,
      message: "تم توليد وحفظ الوثيقة بنجاح",
    });
  } catch (error) {
    console.error("❌ [BACKEND - CRITICAL ERROR] حدث خطأ أثناء العملية:");
    console.error(error.response?.data?.toString() || error.message);
    res.status(500).json({
      success: false,
      message: "فشل توليد وحفظ الملف",
      error: error.message,
    });
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
};

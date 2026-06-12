// src/controllers/quotationController.js
const prisma = require("../utils/prisma");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");
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
// ===============================================
// 1. إنشاء عرض سعر (مع دعم الضريبة المخصصة لكل بند)
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

    const newQuotation = await prisma.quotation.create({
      data: {
        number: quotationNumber,

        client: data.clientId ? { connect: { id: data.clientId } } : undefined,
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
        showClientCode: data.showClientCode ?? true,
        showPropertyCode: data.showPropertyCode ?? true,

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
        createdBy: req.user?.id,

        items: { create: itemsToCreate },
        payments: {
          create: (data.payments || []).map((p, idx) => ({
            installmentNumber: idx + 1,
            percentage: parseFloat(p.percentage),
            amount: parseFloat(p.amount),
            dueCondition: p.condition || "حسب الاتفاق",
          })),
        },
      },
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
// 2. تحديث عرض سعر (مع دعم الضريبة المخصصة لكل بند)
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

    let validTransactionTypeId = undefined;
    if (data.transactionTypeId && data.transactionTypeId.length > 20) {
      const existingType = await prisma.transactionType.findUnique({
        where: { id: data.transactionTypeId },
      });
      if (existingType) validTransactionTypeId = existingType.id;
    }

    const baseUpdateData = {
      ...(data.status && { status: data.status }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.terms !== undefined && { terms: data.terms }),
      ...(data.templateType && { templateType: data.templateType }),
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

      ...(validTransactionTypeId && {
        transactionType: { connect: { id: validTransactionTypeId } },
      }),
      ...(data.clientId && { client: { connect: { id: data.clientId } } }),
      ...(data.propertyId && {
        ownership: { connect: { id: data.propertyId } },
      }),
      ...(data.transactionId && {
        transaction: { connect: { id: data.transactionId } },
      }),
      ...(data.meetingId && {
        meetingMinute: { connect: { id: data.meetingId } },
      }),
    };

    let updatedQuotation;

    if (data.items || data.payments) {
      updatedQuotation = await prisma.$transaction(async (tx) => {
        let calcSubtotal = existingQuote.subtotal;
        let calcTaxAmount = existingQuote.taxAmount;
        let calcTotal = existingQuote.total;
        let globalTaxRateFloat =
          data.taxRate !== undefined
            ? parseFloat(data.taxRate) / 100
            : existingQuote.taxRate;

        if (data.items) {
          await tx.quotationItem.deleteMany({ where: { quotationId: id } });

          // 👇 تصفير الحسابات لحسابها بدقة من البنود الجديدة
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

            // 👇 حساب ضريبة هذا البند
            const itemTaxRate =
              item.taxRate !== undefined
                ? parseFloat(item.taxRate) / 100
                : 0.15;
            const itemTaxAmount = subtotal * itemTaxRate;
            calcTaxAmount += itemTaxAmount; // تجميع الضريبة

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
              taxRate: itemTaxRate, // حفظ نسبة البند
              taxAmount: itemTaxAmount, // حفظ قيمة الضريبة للبند
            };
          });

          calcTotal = calcSubtotal + calcTaxAmount;

          if (itemsToCreate.length > 0) {
            await tx.quotationItem.createMany({ data: itemsToCreate });
          }
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
          if (paymentsToCreate.length > 0) {
            await tx.quotationPayment.createMany({ data: paymentsToCreate });
          }
        }

        return await tx.quotation.update({
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
      });
    } else {
      updatedQuotation = await prisma.quotation.update({
        where: { id },
        data: baseUpdateData,
        include: {
          items: { orderBy: { order: "asc" } },
          payments: { orderBy: { installmentNumber: "asc" } },
          client: { select: { name: true, clientCode: true } },
          ownership: { select: { code: true } },
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "تم التحديث بنجاح",
      data: updatedQuotation,
    });
  } catch (error) {
    console.error("Update Quotation Error:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء تحديث العرض" });
  }
};

// ===============================================
// 2. جلب جميع عروض الأسعار (بدون المحذوفة)
// GET /api/quotations
// ===============================================
const getAllQuotations = async (req, res) => {
  try {
    const quotations = await prisma.quotation.findMany({
      where: {
        status: { not: "TRASHED" }, // 👈 فلترة: جلب كل شيء ما عدا الموجود في سلة المحذوفات
      },
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
        transaction: true, // 👈 إضافة استباقية لمعلومات المعاملة المرتبطة
        meetingMinute: true, // 👈 إضافة استباقية لمعلومات المحضر المرتبط
        items: { orderBy: { order: "asc" } },
        payments: { orderBy: { installmentNumber: "asc" } },
        contract: true,
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

    // 👈 بدلاً من الحذف النهائي، نقوم بتحديث الحالة إلى TRASHED
    const trashedQuotation = await prisma.quotation.update({
      where: { id: id },
      data: {
        status: "TRASHED", // نقل لسلة المحذوفات
        // notes: "تم نقل هذا العرض لسلة المحذوفات", // اختياري
      },
    });

    res.status(200).json({
      success: true,
      message: "تم نقل عرض السعر إلى سلة المحذوفات بنجاح",
      data: trashedQuotation,
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, message: "عرض السعر غير موجود" });
    }
    console.error("Trash Quotation Error:", error);
    res.status(500).json({ success: false, message: "خطأ في حذف العرض" });
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

const generatePdfPreview = async (req, res) => {
  try {
    const data = req.body;

    // استخراج المتغيرات لسهولة الاستخدام
    const {
      transactionType,
      licenseNumber,
      licenseYear,
      serviceNumber,
      serviceYear,
      clientTitle,
      clientNameForPreview,
      clientCodeForPreview,
      showClientCode,
      showPropertyCode,
      propertyCodeForPreview,
      termsText,
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
    } = data;

    // الحسابات والتنسيقات
    const referenceNumber =
      data.referenceNumber || `QT-${Date.now().toString().slice(-5)}`;
    const formatCurrency = (value) =>
      Number(value || 0).toLocaleString("ar-SA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const calculatedOfficeDiscount = (taxAmount * officeTaxBearing) / 100;
    const finalPayable =
      (grandTotal || subtotal + taxAmount) - calculatedOfficeDiscount;

    const displayIssueDate = issueDate
      ? new Date(issueDate).toLocaleDateString("ar-SA")
      : new Date().toLocaleDateString("ar-SA");

    // بناء النص التمهيدي
    let introText = `إشارة إلى طلبكم بخصوص تقديم عرض سعر خدمات (${transactionType || "الخدمات الهندسية والاستشارية"})`;
    if (showPropertyCode && propertyCodeForPreview)
      introText += ` لقطعة الأرض أو الملف رقم (${propertyCodeForPreview})`;
    introText +=
      "، فإنه يسرنا تقديم العرض المالي والفني لإنهاء الأعمال المطلوبة وفقاً لنطاق العمل والاشتراطات والملاحظات التالية:";

    // بناء نص تمثيل العميل
    let repTextHtml = "";
    if (signatureMethod !== "SELF") {
      repTextHtml = `ويمثل العميل (${(clientType || "").replace("_", " ")}) بالتوقيع والاعتماد على هذا العرض السيد/ة: ${repName || "........................"}`;
      if (repIdNumber) repTextHtml += `، (هوية رقم: ${repIdNumber})`;
      if (repCapacity) repTextHtml += `، بصفته: ${repCapacity}`;
      if (authDocType || authDocNumber) {
        repTextHtml += `، بموجب ${authDocType || ""} ${authDocNumber ? `رقم (${authDocNumber})` : ""} ${authDocDate ? `وتاريخ ${new Date(authDocDate).toLocaleDateString("ar-SA")}` : ""}`;
      }
      repTextHtml += ".";
    }

    // 💡 هام: يجب استخدام روابط كاملة للصور في السيرفر
    const logoUrl = "https://engineering-system.com/logo.jpeg"; // ضع الرابط الحقيقي لشعار مكتبك هنا
    const bgUrl = "https://engineering-system.com/safe_background/1.png"; // خلفية الورق

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
          .page-container {
            width: 794px; min-height: 1123px; padding: 60px 70px;
            box-sizing: border-box; background-color: #ffffff;
            position: relative; page-break-after: always;
            overflow: hidden;
          }
          .bg-layer {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0;
            background-image: url('${bgUrl}');
            background-size: 794px 1123px; background-repeat: repeat-y;
            z-index: 0; opacity: 0.1;
          }
          .content { position: relative; z-index: 1; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 11px; }
          th, td { border: 1px solid #123f59; padding: 8px; text-align: center; }
          th { background-color: #123f59; color: #fff; font-weight: 900; }
          .text-right { text-align: right; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
          
          /* Utility Classes */
          .bg-slate-50 { background-color: #f8fafc; }
          .text-slate-500 { color: #64748b; }
          .text-slate-700 { color: #334155; }
          .text-slate-800 { color: #1e293b; }
          .text-emerald-800 { color: #065f46; }
          .font-bold { font-weight: bold; }
          .font-black { font-weight: 900; }
          .section-title { font-size: 12.5px; font-weight: 900; color: #123f59; margin-bottom: 10px; }
        </style>
      </head>
      <body>
        
        <div class="page-container" style="display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
          <div class="bg-layer"></div>
          <div class="content" style="width: 100%; padding: 80px 0;">
            <div style="width: 300px; margin: 0 auto 60px auto;">
              <img src="${logoUrl}" alt="Logo" style="max-width: 100%; mix-blend-mode: multiply;" />
            </div>

            <div style="width: 80%; margin: 0 auto; border-top: 5px solid #123f59; border-bottom: 5px solid #123f59; padding: 40px 0; margin-bottom: 60px;">
              <h1 style="font-size: 42px; font-weight: 900; color: #123f59; margin-bottom: 24px; margin-top: 0;">عرض سعر فني ومالي</h1>
              <h2 style="font-size: 22px; font-weight: bold; color: #475569; margin: 0;">${transactionType || "خدمات هندسية واستشارية استراتيجية"}</h2>
            </div>

            <div style="width: 100%; text-align: right; background-color: rgba(255,255,255,0.8); padding: 30px; border-radius: 24px; border: 1px solid rgba(216,180,106,0.3); box-sizing: border-box;">
              <p style="font-size: 16px; font-weight: 900; color: #64748b; margin-top: 0; margin-bottom: 12px;">مقدم إلى السادة:</p>
              <p style="font-size: 34px; font-weight: 900; color: #123f59; margin-top: 0; margin-bottom: 32px;">${clientTitle} / ${clientNameForPreview}</p>

              <table style="border: none; font-size: 14px; font-weight: bold; color: #334155; margin-bottom: 0;">
                <tr>
                  <td style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 8px 0;"><span style="color: #64748b;">رقم المرجع:</span> <span style="color: #0f172a; font-weight: 900;">${referenceNumber}</span></td>
                  <td style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 8px 0;"><span style="color: #64748b;">تاريخ الإصدار:</span> <span style="color: #0f172a;">${displayIssueDate}</span></td>
                </tr>
                ${
                  propertyCodeForPreview
                    ? `
                <tr>
                  <td colspan="2" style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 8px 0;"><span style="color: #64748b;">المشروع/الملكية:</span> <span style="color: #0f172a; font-weight: 900;">${propertyCodeForPreview}</span></td>
                </tr>`
                    : ""
                }
              </table>
            </div>
            
            <div style="margin-top: 50px;">
              <p style="font-size: 13px; font-weight: 900; color: #94a3b8;">شركة ديتيلز كونسولتس للاستشارات الهندسية</p>
            </div>
          </div>
        </div>

        <div class="page-container" style="padding: 0;">
          <div class="bg-layer"></div>
          
          <table style="width: 100%; border: none; margin: 0; position: relative; z-index: 1;">
            
            <thead style="display: table-header-group;">
              <tr>
                <td style="border: none; padding: 60px 70px 20px 70px;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #123f59; padding-bottom: 16px;">
                    <div style="height: 64px; width: 192px;">
                      <img src="${logoUrl}" alt="Logo" style="max-height: 100%; max-width: 100%; mix-blend-mode: multiply;" />
                    </div>
                    <div style="width: 280px;">
                      <table style="width: 100%; border: 1px solid #123f5944; margin: 0; font-size: 10px; font-weight: bold;">
                        <tr><td style="background: #f8fafc; border: 1px solid #123f5944; width: 35%;">نوع المستند</td><td style="border: 1px solid #123f5944; color: #123f59; font-weight: 900;">عرض سعر خدمات فنية</td></tr>
                        <tr><td style="background: #f8fafc; border: 1px solid #123f5944;">التاريخ</td><td style="border: 1px solid #123f5944;">${displayIssueDate}</td></tr>
                        <tr><td style="background: #f8fafc; border: 1px solid #123f5944;">رقم المرجع</td><td style="border: 1px solid #123f5944; font-weight: 900; color: #123f59;">${referenceNumber}</td></tr>
                      </table>
                    </div>
                  </div>
                </td>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td style="border: none; padding: 0px 70px 20px 70px; text-align: right;">
                  
                  <table style="width: 100%; margin-top: 16px; margin-bottom: 24px; border: 1px solid #123f5944; font-size: 10px; font-weight: bold;">
                    <tr>
                      <td style="background: #f8fafc; width: 20%; border: 1px solid #123f5944;">نوع المستند</td>
                      <td style="width: 30%; font-weight: 900; color: #123f59; border: 1px solid #123f5944;">عرض سعر خدمات هندسية</td>
                      <td style="background: #f8fafc; width: 20%; border: 1px solid #123f5944;">حالة المستند</td>
                      <td style="width: 30%; color: #b45309; font-weight: 900; border: 1px solid #123f5944;">عرض نهائي للعميل</td>
                    </tr>
                    <tr>
                      <td style="background: #f8fafc; border: 1px solid #123f5944;">رقم حساب العميل</td>
                      <td style="border: 1px solid #123f5944;">${clientCodeForPreview || "—"}</td>
                      <td style="background: #f8fafc; border: 1px solid #123f5944;">كود أرشفة المشروع</td>
                      <td style="border: 1px solid #123f5944;">${propertyCodeForPreview || "—"}</td>
                    </tr>
                    <tr>
                      <td style="background: #f8fafc; border: 1px solid #123f5944;">مدة صلاحية العرض</td>
                      <td style="border: 1px solid #123f5944;">30 يوماً من تاريخ التحرير</td>
                      <td style="background: #f8fafc; border: 1px solid #123f5944;">نسخة الوثيقة</td>
                      <td style="border: 1px solid #123f5944;">v1.0</td>
                    </tr>
                  </table>

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <h4 style="margin: 0 0 16px 0; font-size: 13px; font-weight: 900; color: #123f59;">${clientTitle} ${clientNameForPreview}</h4>
                    ${
                      repTextHtml
                        ? `
                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 12px; font-weight: bold; color: #334155;">
                      ⚖️ ${repTextHtml}
                    </div>`
                        : ""
                    }
                    <p style="margin: 0 0 12px 0; font-size: 12px; font-weight: 900; color: #123f59;">السلام عليكم ورحمة الله وبركاته ،،,</p>
                    <p style="margin: 0; font-size: 12px; font-weight: bold; color: #475569; line-height: 2;">${introText}</p>
                  </div>

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <div class="section-title">أولاً: بيانات العميل والمالك وصاحب العلاقة الأصلي</div>
                    <table style="border: 1px solid #123f59; font-size: 11px; font-weight: bold; margin-bottom: 0;">
                      <tr>
                        <td style="background: #f8fafc; width: 25%; border: 1px solid #123f5944;">تصنيف العميل الكياني</td>
                        <td style="width: 25%; border: 1px solid #123f5944;">${(clientType || "").replace("_", " ")}</td>
                        <td style="background: #f8fafc; width: 25%; border: 1px solid #123f5944;">اسم المالك المسجل</td>
                        <td style="width: 25%; border: 1px solid #123f5944; font-weight: 900; color: #123f59;">${clientNameForPreview}</td>
                      </tr>
                      <tr>
                        <td style="background: #f8fafc; border: 1px solid #123f5944;">كود العميل بالنظام</td>
                        <td style="border: 1px solid #123f5944;">${clientCodeForPreview || "---"}</td>
                        <td style="background: #f8fafc; border: 1px solid #123f5944;">رقم الجوال للاتصال</td>
                        <td style="border: 1px solid #123f5944;">${repPhone || "---"}</td>
                      </tr>
                      <tr>
                        <td style="background: #f8fafc; border: 1px solid #123f5944;">الصفة القانونية للتوقيع</td>
                        <td colspan="3" style="border: 1px solid #123f5944;">${signatureMethod === "SELF" ? "المالك الأصلي مباشرة" : "ممثل نظامي بموجب مستند ساري"}</td>
                      </tr>
                    </table>
                  </div>

                  ${
                    signatureMethod !== "SELF"
                      ? `
                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <div class="section-title">ثانياً: بيانات التمثيل النظامي والمفوض بالتوقيع الشرعي</div>
                    <table style="border: 1px solid #123f59; font-size: 11px; font-weight: bold; margin-bottom: 0;">
                      <tr>
                        <td style="background: #f8fafc; width: 25%; border: 1px solid #123f5944;">اسم المفوض</td>
                        <td style="width: 25%; border: 1px solid #123f5944; font-weight: 900;">${repName || "---"}</td>
                        <td style="background: #f8fafc; width: 25%; border: 1px solid #123f5944;">رقم الهوية</td>
                        <td style="width: 25%; border: 1px solid #123f5944;">${repIdNumber || "---"}</td>
                      </tr>
                      <tr>
                        <td style="background: #f8fafc; border: 1px solid #123f5944;">الصفة بالتكليف</td>
                        <td style="border: 1px solid #123f5944;">${repCapacity || "---"}</td>
                        <td style="background: #f8fafc; border: 1px solid #123f5944;">جوال المفوض</td>
                        <td style="border: 1px solid #123f5944;">${repPhone || "---"}</td>
                      </tr>
                      <tr>
                        <td style="background: #f8fafc; border: 1px solid #123f5944;">نوع مستند التفويض</td>
                        <td style="border: 1px solid #123f5944;">${authDocType || "---"}</td>
                        <td style="background: #f8fafc; border: 1px solid #123f5944;">توثيق الصك</td>
                        <td style="border: 1px solid #123f5944; color: #164e63;">${authDocNumber ? `رقم: ${authDocNumber}` : "---"} ${authDocDate ? `بتاريخ: ${new Date(authDocDate).toLocaleDateString("ar-SA")}` : ""}</td>
                      </tr>
                    </table>
                  </div>`
                      : ""
                  }

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <div class="section-title">${signatureMethod !== "SELF" ? "ثالثاً" : "ثانياً"}: بيانات المشروع والملكية العقارية</div>
                    <table style="border: 1px solid #123f59; font-size: 11px; font-weight: bold; margin-bottom: 0;">
                      <tr>
                        <td style="background: #f8fafc; width: 25%; border: 1px solid #123f5944;">رقم صك الملكية</td>
                        <td style="width: 25%; border: 1px solid #123f5944; color: #065f46; font-weight: 900;">${deedNumber || "---"}</td>
                        <td style="background: #f8fafc; width: 25%; border: 1px solid #123f5944;">كود الأرشفة</td>
                        <td style="width: 25%; border: 1px solid #123f5944;">${propertyCodeForPreview || "---"}</td>
                      </tr>
                      ${
                        licenseNumber || serviceNumber
                          ? `
                      <tr>
                        <td style="background: #f8fafc; border: 1px solid #123f5944;">رقم رخصة البناء</td>
                        <td style="border: 1px solid #123f5944;">${licenseNumber ? `${licenseNumber} لعام ${licenseYear}هـ` : "---"}</td>
                        <td style="background: #f8fafc; border: 1px solid #123f5944;">رقم معاملة البلدي</td>
                        <td style="border: 1px solid #123f5944;">${serviceNumber ? `${serviceNumber} لعام ${serviceYear}هـ` : "---"}</td>
                      </tr>`
                          : ""
                      }
                    </table>
                  </div>

                  ${
                    plots && plots.length > 0
                      ? `
                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <table style="border: 1px solid #123f59; font-size: 11px; margin-bottom: 0;">
                      <thead style="background-color: #123f59; color: #fff;">
                        <tr>
                          <th>رقم القطعة</th><th>المساحة</th><th>شمال</th><th>جنوب</th><th>شرق</th><th>غرب</th>
                        </tr>
                      </thead>
                      <tbody style="font-weight: bold;">
                        ${plots
                          .map((plot) => {
                            const n = boundaries.find(
                              (b) =>
                                b.direction === "شمال" && b.plotId === plot.id,
                            );
                            const s = boundaries.find(
                              (b) =>
                                b.direction === "جنوب" && b.plotId === plot.id,
                            );
                            const e = boundaries.find(
                              (b) =>
                                b.direction === "شرق" && b.plotId === plot.id,
                            );
                            const w = boundaries.find(
                              (b) =>
                                b.direction === "غرب" && b.plotId === plot.id,
                            );
                            return `
                          <tr>
                            <td style="border: 1px solid #123f5944;">${plot.plotNumber || "---"}</td>
                            <td style="border: 1px solid #123f5944;">${plot.area || "---"} م²</td>
                            <td style="border: 1px solid #123f5944;">${n?.length || 0} م</td>
                            <td style="border: 1px solid #123f5944;">${s?.length || 0} م</td>
                            <td style="border: 1px solid #123f5944;">${e?.length || 0} م</td>
                            <td style="border: 1px solid #123f5944;">${w?.length || 0} م</td>
                          </tr>`;
                          })
                          .join("")}
                      </tbody>
                    </table>
                  </div>`
                      : ""
                  }

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <div class="section-title">${signatureMethod !== "SELF" ? "رابعاً" : "ثالثاً"}: نطاق الأعمال وقائمة التكاليف المالية</div>
                    <table style="border: 1px solid #123f59; font-size: 11px; margin-bottom: 0;">
                      <thead style="background-color: #123f59; color: #fff;">
                        <tr>
                          <th style="width: 5%;">م</th>
                          <th style="text-align: right;">وصف الخدمة الاستشارية / نطاق العمل</th>
                          ${showQuantity ? `<th style="width: 10%;">الكمية</th>` : ""}
                          <th style="width: 15%;">الفئة (ر.س)</th>
                          <th style="width: 20%;">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody style="font-weight: bold;">
                        ${items
                          .map((item, index) => {
                            const rowTotal = Math.max(
                              0,
                              (item.qty || item.quantity || 1) *
                                (item.price || item.unitPrice || 0) -
                                (item.discount || 0),
                            );
                            return `
                          <tr class="avoid-break">
                            <td style="border: 1px solid #123f5944;">${index + 1}</td>
                            <td style="text-align: right; border: 1px solid #123f5944; line-height: 1.5;">${item.title}</td>
                            ${showQuantity ? `<td style="border: 1px solid #123f5944;">${item.qty || item.quantity || 1} ${item.unit || ""}</td>` : ""}
                            <td style="border: 1px solid #123f5944;">${formatCurrency(item.price || item.unitPrice)}</td>
                            <td style="border: 1px solid #123f5944; color: #123f59;">${formatCurrency(rowTotal)}</td>
                          </tr>`;
                          })
                          .join("")}
                        
                        <tr style="background-color: #f8fafc;">
                          <td colspan="${showQuantity ? "4" : "3"}" style="text-align: left; border: 1px solid #123f5944;">المجموع الفرعي</td>
                          <td style="border: 1px solid #123f5944; font-weight: 900;">${formatCurrency(subtotal)}</td>
                        </tr>
                        <tr>
                          <td colspan="${showQuantity ? "4" : "3"}" style="text-align: left; color: #64748b; border: 1px solid #123f5944;">ضريبة القيمة المضافة ${taxRate || 15}% ${officeTaxBearing > 0 ? `(يتحمل المكتب ${officeTaxBearing}%)` : ""}</td>
                          <td style="border: 1px solid #123f5944; font-weight: 900;">${formatCurrency(taxAmount)}</td>
                        </tr>
                        ${
                          officeTaxBearing > 0
                            ? `
                        <tr>
                          <td colspan="${showQuantity ? "4" : "3"}" style="text-align: left; color: #047857; border: 1px solid #123f5944;">خصم إعفاء ضريبي (المكتب يتحمل ${officeTaxBearing}%)</td>
                          <td style="border: 1px solid #123f5944; font-weight: 900; color: #047857;">- ${formatCurrency(calculatedOfficeDiscount)}</td>
                        </tr>`
                            : ""
                        }
                        <tr style="background-color: #123f59; color: #fff;">
                          <td colspan="${showQuantity ? "4" : "3"}" style="text-align: left; border: 1px solid #123f5944;">الإجمالي النهائي المستحق الصافي للدفع</td>
                          <td style="border: 1px solid #123f5944; font-weight: 900;">${formatCurrency(finalPayable)} ر.س</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  ${
                    paymentsList && paymentsList.length > 0
                      ? `
                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <div class="section-title">${signatureMethod !== "SELF" ? "خامساً" : "رابعاً"}: جدول توزيع الدفعات المالية</div>
                    <table style="border: 1px solid #123f59; font-size: 11px; margin-bottom: 0;">
                      <thead style="background-color: #123f59; color: #fff;">
                        <tr><th style="width: 20%;">الدفعة</th><th style="width: 15%;">النسبة (%)</th><th style="width: 25%;">المبلغ (شامل الضريبة)</th><th style="width: 40%;">الاستحقاق</th></tr>
                      </thead>
                      <tbody style="font-weight: bold;">
                        ${paymentsList
                          .map(
                            (payment, index) => `
                        <tr>
                          <td style="background-color: #f8fafc; border: 1px solid #123f5944;">${payment.label || `الدفعة ${index + 1}`}</td>
                          <td style="border: 1px solid #123f5944;">${payment.percentage || Math.round(100 / paymentsList.length)}%</td>
                          <td style="border: 1px solid #123f5944; color: #065f46;">${formatCurrency(payment.amount)} ر.س</td>
                          <td style="border: 1px solid #123f5944; text-align: right; padding-right: 12px; color: #475569;">${payment.condition || "حسب الاتفاق"}</td>
                        </tr>`,
                          )
                          .join("")}
                      </tbody>
                    </table>
                  </div>`
                      : ""
                  }

                  ${
                    showMissingDocs && missingDocs && missingDocs.trim() !== ""
                      ? `
                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <div class="section-title">${signatureMethod !== "SELF" ? "سادساً" : "خامساً"}: المستندات والمسوغات المطلوب توفيرها لبدء العمل</div>
                    <div style="border: 1px solid #123f5933; border-radius: 12px; background-color: #fff;">
                      <div style="background-color: #fef3c7; padding: 10px 15px; border-bottom: 1px solid #123f5922; color: #b45309; font-weight: bold; font-size: 11px;">
                        نأمل منكم التكرم بتجهيز المستندات التالية لتسليمها للمكتب:
                      </div>
                      <div style="padding: 15px;">
                        <table style="width: 100%; border: none;">
                          <tbody>
                            ${(() => {
                              const docs = missingDocs
                                .split("\\n")
                                .filter((d) => d.trim() !== "");
                              let rows = "";
                              for (let i = 0; i < docs.length; i += 2) {
                                const doc1 = docs[i].replace(/^- /, "").trim();
                                const doc2 = docs[i + 1]
                                  ? docs[i + 1].replace(/^- /, "").trim()
                                  : "";
                                rows += `
                                  <tr>
                                    <td style="width: 50%; border: none; padding: 5px; text-align: right;">
                                      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 10px; border-radius: 8px; font-size: 11px; font-weight: bold; color: #334155;">
                                        <span style="display: inline-block; width: 10px; height: 10px; border: 1px solid #c5983c; border-radius: 2px; background-color: #fff; margin-left: 8px; vertical-align: middle;"></span>
                                        ${doc1}
                                      </div>
                                    </td>
                                    <td style="width: 50%; border: none; padding: 5px; text-align: right;">
                                      ${
                                        doc2
                                          ? `
                                      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 10px; border-radius: 8px; font-size: 11px; font-weight: bold; color: #334155;">
                                        <span style="display: inline-block; width: 10px; height: 10px; border: 1px solid #c5983c; border-radius: 2px; background-color: #fff; margin-left: 8px; vertical-align: middle;"></span>
                                        ${doc2}
                                      </div>`
                                          : ""
                                      }
                                    </td>
                                  </tr>`;
                              }
                              return rows;
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>`
                      : ""
                  }

                  <div class="avoid-break" style="margin-bottom: 24px;">
                    <div class="section-title">${signatureMethod !== "SELF" ? "سابعاً" : "سادساً"}: الشروط والأحكام والالتزامات العامة</div>
                    <div style="background-color: rgba(248, 250, 252, 0.5); padding: 16px; border-radius: 8px; border: 1px solid #f1f5f9; font-size: 11.5px; font-weight: bold; color: #475569; line-height: 2; white-space: pre-wrap;">${termsText || "خاضع للشروط العامة المسجلة بالمكتب."}</div>
                  </div>

                  <div class="avoid-break" style="margin-top: 40px;">
                    <h4 style="text-align: center; font-size: 13px; font-weight: 900; color: #123f59; margin-bottom: 16px;">صيغة الاعتماد والموافقة النهائية والتواقيع الرسمية</h4>
                    <table style="border: 2px solid #123f59; font-size: 11px; width: 100%; table-layout: fixed;">
                      <thead style="background-color: #123f59; color: #fff;">
                        <tr>
                          <th style="width: 50%; padding: 10px; border-left: 1px solid #123f5944;">طرف قبول وتوقيع العميل / المفوض</th>
                          <th style="width: 50%; padding: 10px;">اعتماد وختم مقدم الخدمة (المكتب الاستشاري)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style="padding: 16px; vertical-align: top; border-left: 1px solid #123f5944; border-bottom: none;">
                            <div style="margin-bottom: 10px;"><span style="color: #64748b; font-weight: bold;">الاسم الكامل:</span> <span style="font-weight: 900; color: #1e293b;">${signatureMethod !== "SELF" ? repName : clientNameForPreview}</span></div>
                            <div style="margin-bottom: 10px;"><span style="color: #64748b; font-weight: bold;">الصفة للتمثيل:</span> <span style="font-weight: 900; color: #1e293b;">${signatureMethod !== "SELF" ? repCapacity : "المالك الفعلي ذو العلاقة"}</span></div>
                            <div style="margin-bottom: 10px;"><span style="color: #64748b; font-weight: bold;">رقم الهوية:</span> <span style="font-weight: 900; color: #1e293b;">${signatureMethod !== "SELF" ? repIdNumber : "............................"}</span></div>
                            <div style="margin-bottom: 10px;"><span style="color: #64748b; font-weight: bold;">رقم الجوال:</span> <span style="font-weight: 900; color: #1e293b;">${signatureMethod !== "SELF" ? repPhone : "............................"}</span></div>
                            ${
                              signatureMethod !== "SELF"
                                ? `
                            <div style="margin-bottom: 10px;"><span style="color: #64748b; font-weight: bold;">مستند التفويض:</span> <span style="font-weight: 900; color: #164e63;">${authDocNumber ? `رقم (${authDocNumber})` : "............................"}</span></div>
                            `
                                : ""
                            }
                            <div style="margin-top: 50px; text-align: center; color: #94a3b8; font-weight: bold;">التوقيع الشخصي والختم: ........................................</div>
                          </td>
                          <td style="padding: 16px; vertical-align: top; border-bottom: none;">
                            <div style="margin-bottom: 10px;"><span style="color: #64748b; font-weight: bold;">اسم المنشأة:</span> <span style="font-weight: 900; color: #1e293b;">شركة ديتيلز كونسولتس للاستشارات الهندسية</span></div>
                            <div style="margin-bottom: 10px;"><span style="color: #64748b; font-weight: bold;">الإدارة المصدرة:</span> <span style="font-weight: 900; color: #1e293b;">إدارة تطوير الأعمال والمشاريع</span></div>
                            <div style="margin-bottom: 10px;"><span style="color: #64748b; font-weight: bold;">الموظف المسؤول:</span> <span style="font-weight: 900; color: #1e293b;">${employeeName || "إدارة الأنظمة والعقود"}</span></div>
                            <div style="margin-bottom: 10px;"><span style="color: #64748b; font-weight: bold;">رقم الموظف:</span> <span style="font-weight: 900; color: #1e293b;">${employeeId}</span></div>
                            <div style="margin-top: 50px; text-align: center; color: #94a3b8; font-weight: bold;">ختم الاعتماد والتوقيع: ........................................</div>
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
                  <div style="border-top: 2.5px solid #123f59; padding-top: 12px; text-align: center;">
                    <div style="font-size: 9.5px; font-weight: 900; color: #123f59; opacity: 0.8; direction: ltr; margin-bottom: 4px;">
                      📍 King Fahd Dist - RIYADH - Kingdom of Saudi Arabia - POSTAL CODE : 12274
                    </div>
                    <div style="font-size: 9.5px; font-weight: 900; color: #123f59; opacity: 0.8; direction: ltr;">
                      ☎ 0590722827 | N.N: 7052303828 | ✉ info@details-consults.sa
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

    // 🚀 استخدام Gotenberg لتحويل HTML إلى PDF
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
    res
      .status(500)
      .json({
        success: false,
        message: "حدث خطأ أثناء توليد ملف الـ PDF عبر Gotenberg",
      });
  }
};

module.exports = {
  createQuotation,
  getAllQuotations,
  getQuotationById,
  updateQuotation,
  deleteQuotation,
  getQuotationStats,
  recordPayment,
  stampQuotation,
  signQuotation,
  generatePdfPreview,
};

// src/controllers/quotationController.js
const prisma = require("../utils/prisma");
const crypto = require("crypto");
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
// 1. إنشاء عرض سعر (محدث ومصحح لخطأ Prisma)
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
    const itemsToCreate = (data.items || []).map((item, index) => {
      const lineTotal = parseFloat(item.qty) * parseFloat(item.price);
      let lineDiscount =
        item.discountType === "PERCENTAGE"
          ? lineTotal * (parseFloat(item.discount) / 100)
          : parseFloat(item.discount) || 0;

      const subtotal = Math.max(0, lineTotal - lineDiscount);
      calcSubtotal += subtotal;

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
      };
    });

    const taxRateFloat = parseFloat(data.taxRate || 15) / 100;
    const calcTaxAmount = calcSubtotal * taxRateFloat;
    const calcTotal = calcSubtotal + calcTaxAmount;

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
      // الـ CUID عادة يكون طويل
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

        // 👉 استخدام الـ ID الموثوق فقط
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

        subtotal: calcSubtotal,
        taxRate: taxRateFloat,
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

    res.status(201).json({ success: true, data: newQuotation });
  } catch (error) {
    console.error("Create Quotation Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "فشل حفظ عرض السعر",
        error: error.message,
      });
  }
};

// ===============================================
// 2. تحديث عرض سعر (محدث ومصحح لخطأ Prisma)
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

    // 🔥 الحماية الأمنية للـ TransactionType في حالة التحديث
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

      // 👉 الربط الآمن
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
        let taxRateFloat =
          data.taxRate !== undefined
            ? parseFloat(data.taxRate) / 100
            : existingQuote.taxRate;

        if (data.items) {
          await tx.quotationItem.deleteMany({ where: { quotationId: id } });
          calcSubtotal = 0;
          const itemsToCreate = data.items.map((item, index) => {
            const lineTotal = parseFloat(item.qty) * parseFloat(item.price);
            let lineDiscount =
              item.discountType === "PERCENTAGE"
                ? lineTotal * (parseFloat(item.discount) / 100)
                : parseFloat(item.discount) || 0;

            const subtotal = Math.max(0, lineTotal - lineDiscount);
            calcSubtotal += subtotal;

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
            };
          });

          calcTaxAmount = calcSubtotal * taxRateFloat;
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
            taxRate: taxRateFloat,
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
        transaction: true,     // 👈 إضافة استباقية لمعلومات المعاملة المرتبطة
        meetingMinute: true,   // 👈 إضافة استباقية لمعلومات المحضر المرتبط
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
};

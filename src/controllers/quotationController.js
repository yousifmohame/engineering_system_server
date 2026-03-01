// src/controllers/quotationController.js
const prisma = require("../utils/prisma");

// ==========================================
// دالة مساعدة: توليد رقم عرض السعر (QT-YY-MM-####)
// ==========================================
const generateQuotationNumber = async () => {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2); // "26"
  const month = (date.getMonth() + 1).toString().padStart(2, "0"); // "02"
  const prefix = `QT-${year}-${month}-`;

  // البحث عن آخر عرض سعر في هذا الشهر
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

// ===============================================
// 1. إنشاء عرض سعر جديد (من شاشة 815)
// POST /api/quotations
// ===============================================
const createQuotation = async (req, res) => {
  try {
    const data = req.body;

    // 1. حساب تاريخ الانتهاء (Expiry Date)
    const issueDate = new Date(data.issueDate || new Date());
    const expiryDate = new Date(issueDate);
    expiryDate.setDate(
      expiryDate.getDate() + (parseInt(data.validityDays) || 30),
    );

    // 2. توليد الرقم التسلسلي
    const quotationNumber = await generateQuotationNumber();

    // 3. إعادة الحسابات برمجياً (للحماية من التلاعب)
    let calcSubtotal = 0;
    const itemsToCreate = (data.items || []).map((item, index) => {
      const lineTotal = parseFloat(item.qty) * parseFloat(item.price);
      let lineDiscount = 0;

      if (item.discountType === "PERCENTAGE") {
        lineDiscount = lineTotal * (parseFloat(item.discount) / 100);
      } else {
        lineDiscount = parseFloat(item.discount) || 0;
      }

      const subtotal = Math.max(0, lineTotal - lineDiscount);
      calcSubtotal += subtotal;

      return {
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

    const taxRateFloat = parseFloat(data.taxRate || 15) / 100;
    const calcTaxAmount = calcSubtotal * taxRateFloat;
    const calcTotal = calcSubtotal + calcTaxAmount;

    // 4. حفظ البيانات المتداخلة (العرض + البنود + الدفعات)
    // 4. حفظ البيانات المتداخلة (العرض + البنود + الدفعات)
    const newQuotation = await prisma.quotation.create({
      data: {
        number: quotationNumber,

        // 👇 استخدام connect للربط الآمن بدلاً من clientId مباشرة
        client: data.clientId ? { connect: { id: data.clientId } } : undefined,
        ownership: data.propertyId
          ? { connect: { id: data.propertyId } }
          : undefined,
        // transactionType: data.transactionType
        //  ? { connect: { id: data.transactionType } }
        //   : undefined,

        issueDate: issueDate,
        validityDays: parseInt(data.validityDays) || 30,
        expiryDate: expiryDate,
        isRenewable: data.isRenewable || false,

        templateType: data.templateType || "SUMMARY",
        showClientCode: data.showClientCode ?? true,
        showPropertyCode: data.showPropertyCode ?? true,

        serviceNumber: data.serviceNumber,
        serviceYear: data.serviceYear,
        licenseNumber: data.licenseNumber,
        licenseYear: data.licenseYear,

        subtotal: calcSubtotal,
        taxRate: taxRateFloat,
        officeTaxBearing: parseInt(data.officeTaxBearing) || 0,
        taxAmount: calcTaxAmount,
        total: calcTotal,

        missingDocs: data.missingDocs,
        showMissingDocs: data.showMissingDocs || false,

        terms: data.terms,
        notes: data.notes,
        clientTitle: data.clientTitle || "MR",
        handlingMethod: data.handlingMethod || "DIRECT",
        acceptedMethods: data.acceptedMethods || ["bank"],

        status: data.isDraft ? "DRAFT" : "PENDING_APPROVAL",
        createdBy: req.user?.id,

        // إنشاء البنود المرفقة
        items: {
          create: itemsToCreate,
        },

        // إنشاء الدفعات المرفقة
        payments: {
          create: (data.payments || []).map((p, idx) => ({
            installmentNumber: idx + 1,
            percentage: parseFloat(p.percentage),
            amount: parseFloat(p.amount),
            dueCondition: p.condition || "حسب الاتفاق",
          })),
        },
      },
      include: {
        items: true,
        payments: true,
        client: { select: { name: true, clientCode: true } },
        ownership: { select: { code: true } },
      },
    });

    res.status(201).json({
      success: true,
      message: "تم إنشاء عرض السعر بنجاح",
      data: newQuotation,
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res
        .status(400)
        .json({ success: false, message: `خطأ: رقم عرض السعر مستخدم بالفعل` });
    }
    console.error("Create Quotation Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل حفظ عرض السعر",
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
// 4. تحديث حالة عرض سعر (مع الملاحظات)
// PUT /api/quotations/:id
// ===============================================
const updateQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body; // 👈 نستقبل الحالة والملاحظات

    // تجهيز البيانات التي سيتم تحديثها
    const dataToUpdate = {};
    if (status) dataToUpdate.status = status;
    if (notes) dataToUpdate.notes = notes; // 👈 حفظ سبب الإلغاء/الاسترجاع

    const updatedQuotation = await prisma.quotation.update({
      where: { id: id },
      data: dataToUpdate,
    });

    res
      .status(200)
      .json({ success: true, message: "تم التحديث", data: updatedQuotation });
  } catch (error) {
    if (error.code === "P2025")
      return res
        .status(404)
        .json({ success: false, message: "عرض السعر غير موجود" });
    console.error("Update Quotation Error:", error);
    res.status(500).json({ success: false, message: "خطأ في تحديث العرض" });
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

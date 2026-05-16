const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const { PDFDocument, degrees } = require("pdf-lib");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// 💡 استدعاء خدمة الأمان التي صممناها سابقاً
const stampSecurityService = require("../services/stampSecurityService");

const PDFDocumentKit = require("pdfkit");
const SVGtoPDF = require("svg-to-pdfkit");

function convertSvgToPdfVector(svgString, width = 900, height = 410) {
  return new Promise((resolve, reject) => {
    // إنشاء ملف PDF فارغ في الذاكرة بأبعاد الختم الأصلية
    const doc = new PDFDocumentKit({ size: [width, height], margin: 0 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    // رسم الـ SVG كخطوط (Vector) داخل الـ PDF
    SVGtoPDF(doc, svgString, 0, 0, { preserveAspectRatio: "xMidYMid meet" });

    doc.end();
  });
}

// دالة مساعدة لتعمية اسم المالك عند الفحص العام (Data Masking)
const maskName = (name) => {
  if (!name || name === "غير محدد") return "غير محدد";
  return name
    .split(" ")
    .map((word) => {
      if (word.length <= 2) return word;
      return word[0] + "*".repeat(word.length - 2) + word[word.length - 1];
    })
    .join(" ");
};

// ==========================================
// 1. Dashboard & Stats (لوحة التحكم)
// ==========================================
exports.getDashboardStats = async (req, res) => {
  try {
    const [
      totalContracts,
      totalInvoices,
      totalQuotes,
      totalExternal,
      revokedDocs,
    ] = await Promise.all([
      prisma.documentedRecord.count({ where: { type: "CONTRACT" } }),
      prisma.documentedRecord.count({ where: { type: "INVOICE" } }),
      prisma.documentedRecord.count({ where: { type: "QUOTATION" } }),
      prisma.documentedRecord.count({ where: { type: "EXTERNAL" } }),
      prisma.documentedRecord.count({ where: { status: "REVOKED" } }),
    ]);

    const recentActivity = await prisma.documentedRecord.findMany({
      take: 6,
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      stats: {
        totalContracts,
        totalInvoices,
        totalQuotes,
        totalExternal,
        revokedDocs,
      },
      recentActivity,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. Templates Management
// ==========================================
exports.getTemplates = async (req, res) => {
  res.status(200).json({ success: true, data: [] });
};

exports.saveTemplate = async (req, res) => {
  res.status(200).json({ success: true, data: {} });
};

exports.deleteTemplate = async (req, res) => {
  res.status(200).json({ success: true, message: "تمت العملية بنجاح" });
};

// ==========================================
// 3. Document Creation & Cryptography
// ==========================================
exports.createDocumentation = async (req, res) => {
  try {
    const { docType, docId, signatureType, partyBName, fileName } = req.body;
    const employeeId = req.user?.id || "SYSTEM";
    let finalFileUrl = "";

    if (req.file) {
      finalFileUrl = `/uploads/documented/${req.file.filename}`;
    } else if (docId) {
      finalFileUrl = `/system-files/${docType}/${docId}.pdf`;
    } else {
      return res
        .status(400)
        .json({
          success: false,
          message: "يجب إرفاق ملف أو تحديد معرف مستند داخلي.",
        });
    }

    const year = new Date().getFullYear();
    const randomDigits = Math.floor(100000 + Math.random() * 900000);
    const serialNumber = `DOC${year}-${randomDigits}`;

    const stampData = await stampSecurityService.generateSecureStampData(
      docId || "EXT",
      serialNumber,
    );
    const securityHash = crypto
      .createHash("sha256")
      .update(`${serialNumber}|${stampData.token}|${docType}`)
      .digest("hex");

    const documentedRecord = await prisma.documentedRecord.create({
      data: {
        name: fileName || `مستند ${docType} #${docId || "خارجي"}`,
        type: docType.toUpperCase(),
        referenceId: docId || null,
        partyB: partyBName || "غير محدد",
        serialNumber: serialNumber,
        verificationToken: stampData.token,
        securityHash: securityHash,
        fileUrl: finalFileUrl,
        signatureType: signatureType.toUpperCase(),
        status: "PENDING_APPROVAL",
        createdBy: employeeId,
      },
    });

    res.status(201).json({
      success: true,
      message: "تم التوثيق وإصدار الختم الأمني بنجاح",
      data: {
        record: documentedRecord,
        stamp: {
          token: stampData.token,
          qrBase64: stampData.qrBase64,
          barcodeBase64: stampData.barcodeBase64,
          dynamicBarcodeText: stampData.dynamicBarcodeText,
        },
      },
    });
  } catch (error) {
    console.error("Documentation Error:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء عملية التوثيق." });
  }
};

// ==========================================
// 4. Registry & Verification
// ==========================================

exports.getRegistry = async (req, res) => {
  try {
    const { search, type, status } = req.query;
    const whereClause = {};
    if (type && type !== "ALL") whereClause.type = type;
    if (status && status !== "ALL") whereClause.status = status;
    if (search) {
      whereClause.OR = [
        { name: { contains: search } },
        { serialNumber: { contains: search } },
        { partyB: { contains: search } },
      ];
    }
    const records = await prisma.documentedRecord.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.status(200).json({ success: true, data: records });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.revokeDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const record = await prisma.documentedRecord.update({
      where: { id },
      data: { status: "REVOKED" },
    });
    await prisma.documentationAuditLog.create({
      data: {
        recordId: record.id,
        action: "REVOKED",
        employeeId: req.user?.id,
        details: "تم إبطال الوثيقة أمنياً",
      },
    });
    res
      .status(200)
      .json({
        success: true,
        message: "تم إبطال الوثيقة بنجاح.",
        data: record,
      });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل إبطال الوثيقة." });
  }
};

// 🛡️ التحقق من المستند (تم تحديثه ليرسل الميتا داتا والـ OTP)
exports.verifyDocument = async (req, res) => {
  try {
    const { token } = req.params;

    const record = await prisma.documentedRecord.findUnique({
      where: { verificationToken: token },
    });

    if (!record)
      return res
        .status(404)
        .json({ success: false, message: "مستند مزور أو غير مسجل في النظام." });

    if (!record.isVerifiable)
      return res
        .status(403)
        .json({
          success: false,
          message: "هذا المستند غير مصرح بفحصه للعامة.",
        });

    if (record.expiryDate && new Date() > record.expiryDate) {
      await prisma.documentedRecord.update({
        where: { id: record.id },
        data: { status: "EXPIRED" },
      });
      return res
        .status(403)
        .json({ success: false, message: "صلاحية هذا المستند منتهية." });
    }

    if (record.status === "PENDING_APPROVAL")
      return res
        .status(403)
        .json({
          success: false,
          message: "هذا المستند قيد المراجعة ولم يتم اعتماده رسمياً بعد.",
        });
    if (record.status === "REVOKED")
      return res
        .status(403)
        .json({
          success: false,
          message: "هذا المستند تم إبطاله وغير صالح للاستخدام.",
          data: { serialNumber: record.serialNumber },
        });
    if (record.status !== "VALID")
      return res
        .status(403)
        .json({
          success: false,
          message: `هذا المستند غير ساري (الحالة: ${record.status}).`,
        });

    if (record.maxViews !== null && record.currentViews >= record.maxViews) {
      return res
        .status(403)
        .json({
          success: false,
          message: "تم تجاوز الحد الأقصى لمرات عرض هذا المستند המسموح بها.",
        });
    }

    // 💡 1. إذا كان المستند يتطلب OTP ولم يتم التحقق منه في هذه الجلسة، نرسل الداتا بدون رابط الملف
    if (record.requireOTP) {
      // هنا مفترض إرسال SMS لرقم record.clientPhone باستخدام أي مزود خدمة
      // مؤقتاً للتجربة، سنفترض أن الـ OTP هو: 1234
      const mockOTP = "1234";

      // يجب حفظ الـ OTP المؤقت في الـ session أو الكاش (هنا للتوضيح نرسله للفرونت وهو غير آمن بالواقع، ولكن لغرض الـ Demo)

      return res.status(200).json({
        success: true,
        data: {
          status: "OTP_REQUIRED",
          requireOTP: true,
          serialNumber: record.serialNumber,
          clientPhone: record.clientPhone
            ? record.clientPhone.replace(/.(?=.{4})/g, "*")
            : "غير مسجل", // إخفاء جزء من الرقم
        },
      });
    }

    // 💡 2. إذا لم يكن هناك OTP، أو تم تجاوزه، نكمل عادي ونزيد المشاهدات
    await prisma.documentedRecord.update({
      where: { id: record.id },
      data: { currentViews: record.currentViews + 1 },
    });
    await prisma.documentationAuditLog.create({
      data: {
        recordId: record.id,
        action: "VERIFIED",
        details: "تم مسح رمز הـ QR بنجاح",
      },
    });

    res.status(200).json({
      success: true,
      data: {
        status: "VERIFIED",
        name: record.name,
        type: record.type,
        partyB: maskName(record.partyB),
        serialNumber: record.serialNumber,
        timestamp: record.createdAt,
        approvedAt: record.approvedAt,
        expiryDate: record.expiryDate,
        hash: record.securityHash,
        fileUrl: record.fileUrl,
        customMetadata: record.customMetadata, // 👈 هنا تم إضافة إرسال البيانات المرنة
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء فحص الوثيقة." });
  }
};

// 🛡️ دالة جديدة للتحقق من الـ OTP
exports.verifyOTP = async (req, res) => {
  try {
    const { token, otpCode } = req.body;

    // محاكاة للتحقق (هنا يجب مقارنته مع ما تم إرساله للعميل)
    if (otpCode !== "1234") {
      return res
        .status(400)
        .json({ success: false, message: "رمز التحقق غير صحيح" });
    }

    const record = await prisma.documentedRecord.findUnique({
      where: { verificationToken: token },
    });
    if (!record)
      return res
        .status(404)
        .json({ success: false, message: "مستند غير مسجل." });

    // زيادة المشاهدات بعد نجاح ה-OTP
    await prisma.documentedRecord.update({
      where: { id: record.id },
      data: { currentViews: record.currentViews + 1 },
    });
    await prisma.documentationAuditLog.create({
      data: {
        recordId: record.id,
        action: "VERIFIED",
        details: "تم التحقق من الوثيقة عبر الـ OTP",
      },
    });

    // إرسال البيانات كاملة
    res.status(200).json({
      success: true,
      data: {
        status: "VERIFIED",
        name: record.name,
        type: record.type,
        partyB: maskName(record.partyB),
        serialNumber: record.serialNumber,
        timestamp: record.createdAt,
        approvedAt: record.approvedAt,
        expiryDate: record.expiryDate,
        hash: record.securityHash,
        fileUrl: record.fileUrl,
        customMetadata: record.customMetadata,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "حدث خطأ أثناء التحقق." });
  }
};

// ==========================================
// 5. حرق الأختام وتقديمها للاعتماد
// ==========================================

exports.approveAndBurnDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      stamps,
      transactionId,
      propertyId,
      clientId,
      isVerifiable = true,
      maxViews = null,
      expiryDate = null,
      requireOTP = false,
      clientPhone = null,
      applyToAllPages = false,
      customMetadata = [],
    } = req.body;

    const record = await prisma.documentedRecord.findUnique({ where: { id } });
    if (!record)
      return res
        .status(404)
        .json({ success: false, message: "السجل غير موجود" });

    const originalFilePath = path.join(__dirname, "..", "..", record.fileUrl);
    if (!fs.existsSync(originalFilePath))
      return res
        .status(404)
        .json({ success: false, message: "الملف الأصلي غير موجود" });

    const fileExtension = path.extname(originalFilePath).toLowerCase();
    let pdfDoc, pageWidth, pageHeight;

    if (fileExtension === ".pdf") {
      const existingPdfBytes = fs.readFileSync(originalFilePath);
      pdfDoc = await PDFDocument.load(existingPdfBytes);
      const size = pdfDoc.getPage(0).getSize();
      pageWidth = size.width;
      pageHeight = size.height;
    } else if ([".png", ".jpg", ".jpeg"].includes(fileExtension)) {
      pdfDoc = await PDFDocument.create();
      const imageBytes = fs.readFileSync(originalFilePath);
      let embeddedImage =
        fileExtension === ".png"
          ? await pdfDoc.embedPng(imageBytes)
          : await pdfDoc.embedJpg(imageBytes);
      const imgDims = embeddedImage.scale(1);
      pageWidth = imgDims.width;
      pageHeight = imgDims.height;
      const firstPage = pdfDoc.addPage([pageWidth, pageHeight]);
      firstPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
    } else {
      return res
        .status(400)
        .json({ success: false, message: "صيغة الملف غير مدعومة" });
    }

    for (const stamp of stamps) {
      const vectorStampBuffer = await convertSvgToPdfVector(
        stamp.svgString,
        900,
        410,
      );
      const stampPdfDoc = await PDFDocument.load(vectorStampBuffer);
      const [embeddedStampPage] = await pdfDoc.embedPages([
        stampPdfDoc.getPages()[0],
      ]);

      const stampWidth = stamp.widthPercent * pageWidth;
      const stampHeight = stamp.heightPercent * pageHeight;
      const xPos = stamp.xPercent * pageWidth;
      const yPos = stamp.yPercent * pageHeight;

      const pagesCount = applyToAllPages ? pdfDoc.getPageCount() : 1;
      for (let i = 0; i < pagesCount; i++) {
        const page = pdfDoc.getPage(i);
        page.drawPage(embeddedStampPage, {
          x: xPos,
          y: yPos,
          width: stampWidth,
          height: stampHeight,
          rotation: stamp.rotation ? degrees(stamp.rotation) : degrees(0),
        });
      }
    }

    const finalPdfBytes = await pdfDoc.save();
    let finalFileUrl = record.fileUrl;
    let finalFilePath = originalFilePath;

    if (fileExtension !== ".pdf") {
      finalFileUrl = record.fileUrl.replace(
        new RegExp(`\\${fileExtension}$`),
        ".pdf",
      );
      finalFilePath = originalFilePath.replace(
        new RegExp(`\\${fileExtension}$`),
        ".pdf",
      );
      fs.unlinkSync(originalFilePath);
    }

    fs.writeFileSync(finalFilePath, finalPdfBytes);

    const updatedRecord = await prisma.documentedRecord.update({
      where: { id },
      data: {
        status: "PENDING_APPROVAL",
        fileUrl: finalFileUrl,
        transactionId: transactionId || null,
        propertyId: propertyId || null,
        clientId: clientId || null,
        isVerifiable: Boolean(isVerifiable),
        maxViews: maxViews ? parseInt(maxViews) : null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        requireOTP: Boolean(requireOTP),
        clientPhone: clientPhone || null,
        customMetadata: customMetadata.length > 0 ? customMetadata : null,
      },
    });

    await prisma.documentationAuditLog.create({
      data: {
        recordId: updatedRecord.id,
        action: "SUBMITTED_FOR_APPROVAL",
        employeeId: req.user?.id,
        details: "تم دمج الأختام بالملف وإرساله للمشرف للاعتماد",
      },
    });

    res
      .status(200)
      .json({
        success: true,
        message: "تم دمج الأختام بنجاح",
        data: updatedRecord,
      });
  } catch (error) {
    console.error("Burn Error:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء دمج الأختام بالملف" });
  }
};

// ==========================================
// 6. Supervisor Actions (إجراءات المشرف)
// ==========================================

exports.getPendingApprovals = async (req, res) => {
  try {
    const pendingRecords = await prisma.documentedRecord.findMany({
      where: { status: "PENDING_APPROVAL" },
      orderBy: { createdAt: "asc" },
    });
    res.status(200).json({ success: true, data: pendingRecords });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveDocumentFinal = async (req, res) => {
  try {
    const { id } = req.params;
    const supervisorId = req.user?.id;
    const record = await prisma.documentedRecord.update({
      where: { id },
      data: {
        status: "VALID",
        approvedBy: supervisorId,
        approvedAt: new Date(),
      },
    });
    await prisma.documentationAuditLog.create({
      data: {
        recordId: record.id,
        action: "APPROVED",
        employeeId: supervisorId,
        details: "تم الاعتماد النهائي من قبل المشرف والمستند أصبح سارياً",
      },
    });
    res
      .status(200)
      .json({ success: true, message: "تم اعتماد الوثيقة نهائياً وتفعيلها." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.rejectDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    await prisma.documentedRecord.update({
      where: { id },
      data: { status: "REJECTED" },
    });
    await prisma.documentationAuditLog.create({
      data: {
        recordId: id,
        action: "REJECTED",
        employeeId: req.user?.id,
        details: `تم رفض المستند. السبب: ${reason || "بدون سبب"}`,
      },
    });
    res.status(200).json({ success: true, message: "تم رفض المستند بنجاح." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 7. Audit & Logs (سجل التدقيق)
// ==========================================

exports.getDocumentationLogs = async (req, res) => {
  try {
    const { search } = req.query;
    const logs = await prisma.documentationAuditLog.findMany({
      where: search
        ? {
            OR: [
              { details: { contains: search } },
              { record: { name: { contains: search } } },
              { record: { serialNumber: { contains: search } } },
            ],
          }
        : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        employee: { select: { name: true } },
        record: { select: { name: true, serialNumber: true, fileUrl: true } },
      },
    });
    res.status(200).json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.logDocumentAction = async (req, res) => {
  try {
    const { recordId, action, details } = req.body;
    await prisma.documentationAuditLog.create({
      data: { recordId, action, details, employeeId: req.user?.id },
    });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// حذف المستند نهائياً من النظام
exports.deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    
    // التأكد من وجود المستند
    const record = await prisma.documentedRecord.findUnique({ where: { id } });
    if (!record) {
      return res.status(404).json({ success: false, message: "المستند غير موجود." });
    }

    // حذف المستند من قاعدة البيانات (سيتم حذف الـ Audit Logs المرتبطة به إذا كان onDelete: Cascade، وإلا ستتحول لـ null)
    await prisma.documentedRecord.delete({ where: { id } });

    // تسجيل الحدث أمنياً (اختياري، لأن السجل قد حُذف، ولكن لتتبع نشاط الموظف)
    await prisma.documentationAuditLog.create({
      data: {
        action: "DELETED", // يجب إضافة DELETED للـ Enum في الـ Prisma Schema أو تخزينها كنص
        employeeId: req.user?.id,
        details: `قام بحذف المستند نهائياً (السيريال: ${record.serialNumber})`
      }
    });

    res.status(200).json({ success: true, message: "تم الحذف بنجاح." });
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء الحذف." });
  }
};
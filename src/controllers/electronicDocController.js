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
      prisma.documentedRecord.count({ where: { status: "REVOKED" } }), // الوثائق الملغاة
    ]);

    const recentActivity = await prisma.documentedRecord.findMany({
      take: 6,
      orderBy: { createdAt: "desc" },
      include: { sealTemplate: true },
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
// 2. Templates Management (إدارة القوالب)
// ==========================================
exports.getTemplates = async (req, res) => {
  try {
    const templates = await prisma.sealTemplate.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ success: true, data: templates });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.saveTemplate = async (req, res) => {
  try {
    const data = req.body;

    // إذا تم تعيين هذا القالب كافتراضي، قم بإلغاء الافتراضي من البقية
    if (data.isDefault) {
      await prisma.sealTemplate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    let template;
    if (data.id && !data.id.startsWith("new-")) {
      template = await prisma.sealTemplate.update({
        where: { id: data.id },
        data,
      });
    } else {
      const { id, ...createData } = data;
      template = await prisma.sealTemplate.create({ data: createData });
    }

    res.status(200).json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.sealTemplate.delete({ where: { id } });
    res.status(200).json({ success: true, message: "تم حذف القالب بنجاح" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "لا يمكن حذف قالب مرتبط بوثائق سابقة.",
    });
  }
};

// ==========================================
// 3. Document Creation & Cryptography (قلب النظام)
// ==========================================
exports.createDocumentation = async (req, res) => {
  try {
    const { docType, docId, signatureType, templateId, partyBName, fileName } =
      req.body;
    const employeeId = req.user?.id || "SYSTEM";
    let finalFileUrl = "";

    // 1. معالجة الملف
    if (req.file) {
      finalFileUrl = `/uploads/documented/${req.file.filename}`;
    } else if (docId) {
      finalFileUrl = `/system-files/${docType}/${docId}.pdf`;
    } else {
      return res.status(400).json({
        success: false,
        message: "يجب إرفاق ملف أو تحديد معرف مستند داخلي.",
      });
    }

    // 2. جلب القالب (Seal Template)
    // 2. جلب القالب (Seal Template) بذكاء
    let template;
    if (templateId) {
      template = await prisma.sealTemplate.findUnique({
        where: { id: templateId },
      });
    } else {
      // 💡 إذا لم يتم إرسال قالب، نبحث عن القالب الافتراضي
      template = await prisma.sealTemplate.findFirst({
        where: { isDefault: true },
      });
      if (!template) {
        // إذا لم يكن هناك قالب افتراضي، نجلب أول قالب موجود في النظام
        template = await prisma.sealTemplate.findFirst();
      }
    }

    if (!template) {
      return res.status(404).json({
        success: false,
        message:
          "لا يوجد قوالب أختام في النظام. يرجى إنشاء قالب أولاً من الإعدادات.",
      });
    }
    // 3. توليد السريال (Serial Number)
    const year = new Date().getFullYear();
    const randomDigits = Math.floor(100000 + Math.random() * 900000);
    const serialNumber = `${template.serialPrefix}${year}-${randomDigits}`;

    // 4. 🚀 توليد الختم الأمني (QR + Barcode + 8-Digit Token)
    // نستخدم الخدمة التي صممناها لنحصل على الـ Token المكون من 8 أرقام والصور
    const stampData = await stampSecurityService.generateSecureStampData(
      docId || "EXT",
      serialNumber,
    );

    // 5. التشفير الداخلي (Security Hash) إضافي لضمان عدم التلاعب
    const hashPayload = `${serialNumber}|${stampData.token}|${docType}`;
    const securityHash = crypto
      .createHash("sha256")
      .update(hashPayload)
      .digest("hex");

    // 6. الحفظ في قاعدة البيانات
    const documentedRecord = await prisma.documentedRecord.create({
      data: {
        name: fileName || `مستند ${docType} #${docId || "خارجي"}`,
        type: docType.toUpperCase(),
        referenceId: docId || null,
        partyB: partyBName || "غير محدد",
        serialNumber: serialNumber,
        verificationToken: stampData.token, // 👈 حفظ التوكن للتحقق لاحقاً
        securityHash: securityHash,
        fileUrl: finalFileUrl,
        signatureType: signatureType.toUpperCase(),
        sealTemplateId: template.id,
        status: "VALID",
        createdBy: employeeId,
      },
    });

    // 7. الرد بإرجاع (الوثيقة + بيانات الختم لترسمها الفرونت إند فوراً)
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
// 4. Registry & Verification (السجل والتحقق)
// ==========================================

exports.getRegistry = async (req, res) => {
  try {
    const { search, type, status } = req.query;

    // بناء فلاتر البحث الديناميكية
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
      // 💡 التعديل هنا: جلب القالب بالكامل لتفادي خطأ الحقول الناقصة
      include: { sealTemplate: true },
      take: 100, // Limit for performance
    });

    res.status(200).json({ success: true, data: records });
  } catch (error) {
    console.error("Registry Error:", error); // 👈 سيطبع الخطأ الحقيقي في الكونسول لتراه
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🛑 دالة إلغاء/إبطال وثيقة (Revoke)
exports.revokeDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const record = await prisma.documentedRecord.update({
      where: { id },
      data: { status: "REVOKED" },
    });
    res.status(200).json({
      success: true,
      message: "تم إبطال الوثيقة بنجاح.",
      data: record,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل إبطال الوثيقة." });
  }
};

// 🛡️ Public Route للتحقق من صحة المستند عبر مسح الـ QR أو إدخال الـ 8 أرقام
exports.verifyDocument = async (req, res) => {
  try {
    const { token } = req.params; // نستقبل التوكن وليس السيريال

    const record = await prisma.documentedRecord.findUnique({
      where: { verificationToken: token },
      include: { sealTemplate: true },
    });

    if (!record) {
      return res
        .status(404)
        .json({ success: false, message: "مستند مزور أو غير مسجل في النظام." });
    }

    if (record.status === "REVOKED") {
      return res.status(403).json({
        success: false,
        message: "هذا المستند تم إبطاله وغير صالح للاستخدام.",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        status: "VERIFIED",
        name: record.name,
        type: record.type,
        partyB: record.partyB,
        serialNumber: record.serialNumber,
        timestamp: record.createdAt,
        hash: record.securityHash,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء فحص الوثيقة." });
  }
};
exports.approveAndBurnDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { stamps } = req.body;

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

    let pdfDoc;
    let firstPage;
    let pageWidth, pageHeight;

    // ==========================================
    // الخطوة 1: توحيد الملفات لكي تصبح كلها PDF
    // ==========================================
    if (fileExtension === ".pdf") {
      // إذا كان الملف أصلاً PDF، نقرأه مباشرة
      const existingPdfBytes = fs.readFileSync(originalFilePath);
      pdfDoc = await PDFDocument.load(existingPdfBytes);
      firstPage = pdfDoc.getPages()[0];
      const size = firstPage.getSize();
      pageWidth = size.width;
      pageHeight = size.height;
    } else if ([".png", ".jpg", ".jpeg"].includes(fileExtension)) {
      // إذا كان الملف صورة، ننشئ PDF جديد ونضع الصورة بداخله
      pdfDoc = await PDFDocument.create();
      const imageBytes = fs.readFileSync(originalFilePath);

      let embeddedImage;
      if (fileExtension === ".png") {
        embeddedImage = await pdfDoc.embedPng(imageBytes);
      } else {
        embeddedImage = await pdfDoc.embedJpg(imageBytes);
      }

      // أخذ أبعاد الصورة لنجعل صفحة الـ PDF مطابقة لها تماماً
      const imgDims = embeddedImage.scale(1);
      pageWidth = imgDims.width;
      pageHeight = imgDims.height;

      // إنشاء صفحة مطابقة لحجم الصورة
      firstPage = pdfDoc.addPage([pageWidth, pageHeight]);

      // رسم الصورة لتملا الصفحة بالكامل
      firstPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
    } else {
      return res
        .status(400)
        .json({ success: false, message: "صيغة الملف غير مدعومة للتوثيق" });
    }

    // ==========================================
    // الخطوة 2: طباعة الأختام (Vector) على الـ PDF الموحد
    // ==========================================
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

      firstPage.drawPage(embeddedStampPage, {
        x: xPos,
        y: yPos,
        width: stampWidth,
        height: stampHeight,
        rotation: stamp.rotation ? degrees(stamp.rotation) : degrees(0),
      });
    }

    // حفظ ملف الـ PDF النهائي
    const finalPdfBytes = await pdfDoc.save();

    // ==========================================
    // الخطوة 3: تحديث المسارات وقاعدة البيانات
    // ==========================================
    // تغيير الامتداد إلى .pdf إذا كان صورة
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

      // حذف الصورة الأصلية لأننا استبدلناها بـ PDF
      fs.unlinkSync(originalFilePath);
    }

    // كتابة الملف الجديد
    fs.writeFileSync(finalFilePath, finalPdfBytes);

    // تحديث حالة السجل ورابط الملف في قاعدة البيانات
    const updatedRecord = await prisma.documentedRecord.update({
      where: { id },
      data: {
        status: "VALID",
        fileUrl: finalFileUrl, // تحديث الرابط ليكون .pdf
      },
    });

    res.status(200).json({
      success: true,
      message: "تم توثيق الملف وتحويله إلى PDF بنجاح",
      data: updatedRecord,
    });
  } catch (error) {
    console.error("Burn Error:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء دمج الأختام بالملف" });
  }
};

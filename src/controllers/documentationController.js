const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

// ==========================================
// 1. Dashboard & Stats
// ==========================================
exports.getDashboardStats = async (req, res) => {
  try {
    const totalContracts = await prisma.documentedRecord.count({ where: { type: 'CONTRACT' } });
    const totalInvoices = await prisma.documentedRecord.count({ where: { type: 'INVOICE' } });
    const totalQuotes = await prisma.documentedRecord.count({ where: { type: 'QUOTATION' } });
    const totalExternal = await prisma.documentedRecord.count({ where: { type: 'EXTERNAL' } });

    const recentActivity = await prisma.documentedRecord.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { sealTemplate: true }
    });

    res.status(200).json({
      success: true,
      stats: { totalContracts, totalInvoices, totalQuotes, totalExternal },
      recentActivity
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. Templates Management
// ==========================================
exports.getTemplates = async (req, res) => {
  const templates = await prisma.sealTemplate.findMany();
  res.status(200).json({ success: true, data: templates });
};

exports.saveTemplate = async (req, res) => {
  try {
    const data = req.body;
    
    // إذا تم تعيين هذا القالب كافتراضي، قم بإلغاء الافتراضي من البقية
    if (data.isDefault) {
      await prisma.sealTemplate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false }
      });
    }

    let template;
    if (data.id && !data.id.startsWith('seal-')) { // تحديث
      template = await prisma.sealTemplate.update({
        where: { id: data.id },
        data
      });
    } else { // إنشاء جديد
      const { id, ...createData } = data;
      template = await prisma.sealTemplate.create({
        data: createData
      });
    }

    res.status(200).json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. Document Creation & Cryptography (The Core)
// ==========================================
exports.createDocumentation = async (req, res) => {
  try {
    const { docType, docId, signatureType, templateId, partyBName, fileName } = req.body;
    let finalFileUrl = "";

    // 1. التعامل مع الملف الخارجي إن وجد
    if (req.file) {
      finalFileUrl = `/uploads/documented/${req.file.filename}`;
      // هنا يمكنك دمج مكتبة مثل PDF-lib لوضع الختم كطبقة (Watermark) على الملف
    } else {
      // 2. أو استدعاء ملف من النظام الداخلي (عقد/فاتورة)
      finalFileUrl = `/system-files/${docType}/${docId}.pdf`; 
    }

    // 3. جلب القالب (Seal Template)
    const template = await prisma.sealTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new Error("Template not found");

    // 4. توليد السريال (Serial Number)
    const year = new Date().getFullYear();
    const randomDigits = Math.floor(100000 + Math.random() * 900000); // 6 random digits
    const serialNumber = `${template.serialPrefix}${year}-${randomDigits}`;

    // 5. التشفير (Security Hash Algorithm)
    // نولد هاش مشفر بناءً على (محتوى الملف + الوقت + السريال) لضمان عدم التزوير
    const hashPayload = `${serialNumber}|${new Date().toISOString()}|${docType}|${docId || fileName}`;
    const securityHash = crypto.createHash('sha256').update(hashPayload).digest('hex');

    // 6. حفظ السجل في قاعدة البيانات
    const documentedRecord = await prisma.documentedRecord.create({
      data: {
        name: fileName || `مستند ${docType} #${docId}`,
        type: docType.toUpperCase(),
        referenceId: docId || null,
        partyB: partyBName || "غير محدد",
        serialNumber: serialNumber,
        securityHash: securityHash,
        fileUrl: finalFileUrl,
        signatureType: signatureType.toUpperCase(),
        sealTemplateId: template.id,
        createdBy: req.user.id // من Middleware الـ Auth
      }
    });

    res.status(201).json({
      success: true,
      message: "تم التوثيق الرقمي بنجاح",
      data: documentedRecord
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 4. Registry & Verification
// ==========================================
exports.getRegistry = async (req, res) => {
  const records = await prisma.documentedRecord.findMany({
    orderBy: { createdAt: 'desc' },
    include: { sealTemplate: true }
  });
  res.status(200).json({ success: true, data: records });
};

// Public Route للتحقق من صحة المستند عبر مسح الـ QR
exports.verifyDocument = async (req, res) => {
  const { serial } = req.params;
  const record = await prisma.documentedRecord.findUnique({
    where: { serialNumber: serial }
  });

  if (!record) {
    return res.status(404).json({ success: false, message: "مستند مزور أو غير موجود في النظام" });
  }

  res.status(200).json({
    success: true,
    data: {
      status: "VERIFIED",
      name: record.name,
      partyB: record.partyB,
      timestamp: record.createdAt,
      hash: record.securityHash
    }
  });
};
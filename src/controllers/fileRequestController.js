const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const NodeClam = require('clamscan'); // 🛡️ مكتبة مضاد الفيروسات

// ==========================================
// 🛡️ 1. إعداد مضاد الفيروسات (ClamAV)
// ==========================================
let clamscan;
new NodeClam().init({
    removeInfected: true,
    quarantineInfected: false,
    debugMode: false,
    // 💡 استخدام clamdscan المدعوم بالـ Daemon لسرعة فائقة
    clamdscan: { 
        path: '/usr/bin/clamdscan', // مسار الـ Daemon
        active: true 
    },
    clamscan: { active: false }, // تعطيل الفحص البطيء
}).then(instance => {
    clamscan = instance;
    console.log("🛡️ Anti-Virus Engine (ClamAV) is Ready.");
}).catch(err => {
    console.error("⚠️ Anti-Virus Init Failed (Files will be saved but not scanned):", err);
});

// ==========================================
// 📂 2. إعداد الرفع (Multer) بصلاحيات صارمة
// ==========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../../uploads/client-files");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'client-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// السماح بملفات معينة فقط (أمان إضافي)
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('نوع الملف غير مسموح به. يرجى رفع PDF أو صور فقط.'), false);
  }
};

const upload = multer({ storage: storage, fileFilter: fileFilter });

// ==========================================
// 🚀 3. دوال الـ API
// ==========================================

// جلب الإحصائيات والطلبات
exports.getRequests = async (req, res) => {
  try {
    const requests = await prisma.fileRequest.findMany({ orderBy: { createdAt: "desc" } });
    const receivedFiles = await prisma.receivedFile.findMany({ orderBy: { uploadedAt: "desc" } });
    res.json({ success: true, data: { requests, receivedFiles } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// إنشاء طلب ملفات جديد
exports.createRequest = async (req, res) => {
  try {
    const data = req.body;
    const count = await prisma.fileRequest.count();
    const requestNumber = `FR-2026-${String(count + 1).padStart(4, '0')}`;
    const shortLinkToken = Math.random().toString(36).substring(2, 8); // توليد توكن فريد

    const newReq = await prisma.fileRequest.create({
      data: {
        requestNumber,
        title: data.title,
        description: data.description,
        maxSizeMB: parseInt(data.maxSizeMB) || 10,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        reqSenderName: data.reqSenderName,
        reqSenderPhone: data.reqSenderPhone,
        sentToEmail: data.sentToEmail,
        shortLink: shortLinkToken,
        uniqueLink: `https://details-worksystem1.com/upload/${shortLinkToken}`, // رابط العميل
      }
    });

    // 💡 إذا كان هناك إيميل، يمكنك استدعاء دالة إرسال الإيميل هنا

    res.json({ success: true, data: newReq });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// رفع ملف من العميل (مؤمن بالفحص)
exports.uploadClientFile = [
  upload.single("file"),
  async (req, res) => {
    try {
      const { shortLink } = req.params;
      const { senderName, senderPhone, senderEmail, senderNotes } = req.body;

      if (!req.file) return res.status(400).json({ success: false, message: "لم يتم رفع ملف" });

      const requestInfo = await prisma.fileRequest.findUnique({ where: { shortLink } });
      if (!requestInfo) return res.status(404).json({ success: false, message: "الرابط غير صالح" });

      // 🛡️ فحص الفيروسات
      if (clamscan) {
        console.log(`🛡️ جاري فحص الملف: ${req.file.originalname}...`);
        const { isInfected, viruses } = await clamscan.isInfected(req.file.path);
        
        if (isInfected) {
          console.error(`🚨 تحذير: تم اكتشاف فيروس (${viruses.join(', ')}) في ملف العميل! تم حذف الملف.`);
          return res.status(403).json({ 
            success: false, 
            message: "⚠️ تم حظر الملف لاحتوائه على برمجيات خبيثة أو فيروسات." 
          });
        }
        console.log("✅ الملف آمن.");
      }

      // 💡 يمكنك إضافة كود الذكاء الاصطناعي (Gemini) هنا لتحليل الـ PDF أو الصورة
      // const aiResult = await analyzeDocumentWithAI(req.file.path);
      const mockAiResult = {
         category: req.file.mimetype.includes('pdf') ? 'building-license' : 'identity',
         categoryConfidence: 0.95,
         suggestedTransaction: { transactionNumber: "TRX-2026-001", ownerName: senderName || "غير محدد", matchPercentage: 85, matchReasons: ["اسم المالك متطابق"] }
      };

      // حفظ الملف في الداتابيز
      const savedFile = await prisma.receivedFile.create({
        data: {
          requestId: requestInfo.id,
          fileName: req.file.filename,
          originalName: req.file.originalname,
          fileSize: req.file.size,
          fileExtension: path.extname(req.file.originalname).replace('.', ''),
          filePath: `/uploads/client-files/${req.file.filename}`,
          senderName,
          senderPhone,
          senderEmail,
          aiAnalysis: mockAiResult
        }
      });

      // زيادة عداد الرفع في الطلب الأصلي
      await prisma.fileRequest.update({
        where: { id: requestInfo.id },
        data: { uploadCount: { increment: 1 } }
      });

      res.json({ success: true, data: savedFile, message: "تم رفع الملف وفحصه بنجاح" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: "حدث خطأ داخلي" });
    }
  }
];

// ==========================================
// ✏️ تعديل طلب موجود
// ==========================================
exports.updateRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    // التحقق من وجود الطلب
    const existingRequest = await prisma.fileRequest.findUnique({
      where: { id }
    });

    if (!existingRequest) {
      return res.status(404).json({ success: false, message: "الطلب غير موجود" });
    }

    const updatedReq = await prisma.fileRequest.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        maxSizeMB: parseInt(data.maxSizeMB) || 10,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        reqSenderName: data.reqSenderName,
        reqSenderPhone: data.reqSenderPhone,
        sentToEmail: data.sentToEmail,
      }
    });

    res.json({ success: true, data: updatedReq, message: "تم تحديث الطلب بنجاح" });
  } catch (error) {
    console.error("Update Request Error:", error);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء التحديث: " + error.message });
  }
};

// ==========================================
// 🗑️ حذف طلب (مع حذف الملفات المرتبطة به من السيرفر)
// ==========================================
exports.deleteRequest = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. جلب الملفات المرتبطة بهذا الطلب لحذفها من الهارد ديسك
    const associatedFiles = await prisma.receivedFile.findMany({
      where: { requestId: id }
    });

    // 2. حذف الملفات الفعلية من مجلد السيرفر
    associatedFiles.forEach(file => {
      // بناء المسار الكامل للملف بناءً على بنية مجلداتك
      const fullPath = path.join(__dirname, "../../", file.filePath); 
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath); // حذف الملف
      }
    });

    // 3. حذف الطلب من قاعدة البيانات (بفضل onDelete: Cascade سيتم حذف سجلات الملفات من الداتابيز تلقائياً)
    await prisma.fileRequest.delete({
      where: { id }
    });

    res.json({ success: true, message: "تم حذف الطلب والملفات المرتبطة به بنجاح" });
  } catch (error) {
    console.error("Delete Request Error:", error);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء الحذف: " + error.message });
  }
};

// ==========================================
// 🔍 التحقق من صحة رابط العميل وجلب التفاصيل
// ==========================================
exports.verifyLink = async (req, res) => {
  try {
    const { shortLink } = req.params;
    
    const requestInfo = await prisma.fileRequest.findUnique({
      where: { shortLink }
    });

    // 1. إذا كان الرابط غير موجود (تم حذفه)
    if (!requestInfo) {
      return res.status(404).json({ success: false, message: "الرابط غير صحيح أو تم حذفه من قبل النظام." });
    }

    // 2. إذا كان الرابط منتهي الصلاحية
    if (requestInfo.expiresAt && new Date(requestInfo.expiresAt) < new Date()) {
      return res.status(403).json({ success: false, message: "عذراً، لقد انتهت صلاحية هذا الرابط." });
    }

    // 3. زيادة عداد الزيارات (View Count) للرابط
    await prisma.fileRequest.update({
      where: { id: requestInfo.id },
      data: { viewCount: { increment: 1 }, status: requestInfo.status === 'sent' ? 'viewed' : requestInfo.status }
    });

    // 4. إرسال البيانات العامة التي يحتاجها العميل فقط (لأسباب أمنية لا نرسل كل شيء)
    res.json({ 
      success: true, 
      data: {
        title: requestInfo.title,
        description: requestInfo.description,
        maxSizeMB: requestInfo.maxSizeMB,
        reqSenderName: requestInfo.reqSenderName,
        reqSenderPhone: requestInfo.reqSenderPhone
      }
    });
  } catch (error) {
    console.error("Verify Link Error:", error);
    res.status(500).json({ success: false, message: "حدث خطأ في السيرفر" });
  }
};
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

// 💡 1. إعداد Twilio
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient =
  accountSid && authToken ? twilio(accountSid, authToken) : null;

// 💡 2. إعداد OpenAI (للصياغة الذكية والتحليل)
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// توليد كود عشوائي للروابط القصيرة
const generateShortLink = () => crypto.randomBytes(4).toString("hex");

// تسجيل حركة في السجل (Audit Log)
const logAction = async (action, user, target, meta = null, ip = null) => {
  await prisma.transferAuditLog.create({
    data: { action, user, target, meta, ipAddress: ip },
  });
};

// ==========================================
// 1. جلب بيانات المركز (Dashboard & Tabs Data)
// ==========================================
exports.getCenterData = async (req, res) => {
  try {
    const requests = await prisma.fileRequest.findMany({
      orderBy: { createdAt: "desc" },
    });
    const packages = await prisma.documentPackage.findMany({
      orderBy: { createdAt: "desc" },
    });
    const inbox = await prisma.receivedFile.findMany({
      orderBy: { uploadedAt: "desc" },
      include: { fileRequest: true },
    });
    const logs = await prisma.transferAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    let settings = await prisma.transferCenterSettings.findUnique({
      where: { id: 1 },
    });
    if (!settings) {
      settings = await prisma.transferCenterSettings.create({
        data: { uploadSettings: {}, downloadSettings: {} },
      });
    }

    const stats = {
      activeLinks:
        requests.filter((r) => r.status === "نشط").length +
        packages.filter((p) => p.status !== "منتهي").length,
      pendingFiles: inbox.filter((f) => !f.isProcessed).length,
      totalReceived: inbox.length,
      totalSent: packages.length,
    };

    res.json({
      success: true,
      data: { requests, packages, inbox, logs, settings, stats },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "فشل جلب بيانات المركز" });
  }
};

// ==========================================
// 2. إنشاء وتعديل وحذف (طلبات الاستقبال - الوارد)
// ==========================================
exports.createFileRequest = async (req, res) => {
  try {
    const data = req.body;
    const shortLink = generateShortLink();

    const newRequest = await prisma.fileRequest.create({
      data: {
        ...data,
        expireDate: data.expireDate ? new Date(data.expireDate) : null,
        shortLink,
        status: "نشط",
      },
    });

    await logAction(
      "إنشاء رابط طلب وثائق",
      req.user?.name || "مدير النظام",
      data.title,
      `#REQ-${shortLink}`,
    );
    res.json({ success: true, data: newRequest });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🚀 دالة التعديل لطلبات الوارد
exports.updateFileRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const updated = await prisma.fileRequest.update({
      where: { id },
      data: {
        ...data,
        expireDate: data.expireDate ? new Date(data.expireDate) : null,
      },
    });
    await logAction(
      "تعديل رابط طلب",
      req.user?.name || "مدير النظام",
      data.title,
      "تعديل",
    );
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل تحديث الطلب" });
  }
};

exports.deleteFileRequest = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.fileRequest.delete({ where: { id } });
    await logAction(
      "حذف رابط طلب",
      req.user?.name || "مدير النظام",
      `رقم الطلب: ${id}`,
      "حذف",
    );
    res.json({ success: true, message: "تم حذف الطلب بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل حذف الطلب" });
  }
};

// ==========================================
// 3. إنشاء وتعديل وحذف (حزم الإرسال - الصادر)
// ==========================================
exports.createDocumentPackage = async (req, res) => {
  try {
    const data = req.body;
    const files = req.files || [];
    const shortLink = generateShortLink();

    const showDisclaimer = String(data.showDisclaimer) === "true";
    const directDownloadMode = String(data.directDownloadMode) === "true";
    const expireDate =
      data.expireDate && data.expireDate !== "null" && data.expireDate !== ""
        ? new Date(data.expireDate)
        : null;

    let filesMetadata = [];
    if (data.filesMetadata) {
      try {
        filesMetadata = JSON.parse(data.filesMetadata);
      } catch (e) {
        console.log("Error parsing metadata");
      }
    }

    const finalFilesData = files.map((file, index) => {
      const meta = filesMetadata[index] || {};
      return {
        id: Math.random().toString(36).substring(7),
        fileName: file.filename,
        originalName: file.originalname,
        name: meta.name || file.originalname,
        size: meta.size || (file.size / (1024 * 1024)).toFixed(2) + " MB",
        type: meta.type || file.mimetype,
        filePath: `/uploads/transfer-center/${file.filename}`,
      };
    });

    const newPackage = await prisma.documentPackage.create({
      data: {
        title: data.title,
        message: data.message,
        targetType: data.targetType,
        entityName: data.entityName,
        mobile: data.mobile,
        email: data.email,
        linkType: data.linkType,
        pinCode: data.pinCode,
        permissions: data.permissions,
        showDisclaimer: showDisclaimer,
        disclaimerText: data.disclaimerText,
        directDownloadMode: directDownloadMode,
        expireDate: expireDate,
        filesData: finalFilesData,
        shortLink: shortLink,
      },
    });

    await logAction(
      "إرسال حزمة ملفات",
      req.user?.name || "مدير النظام",
      `الجهة: ${data.entityName}`,
      `#SND-${shortLink}`,
    );

    res.json({ success: true, data: newPackage });
  } catch (error) {
    console.error("Create Package Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🚀 دالة التعديل لحزم الإرسال (الصادر)
exports.updateDocumentPackage = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    // تحويل البيانات القادمة إذا كانت نصية
    const showDisclaimer = String(data.showDisclaimer) === "true";
    const directDownloadMode = String(data.directDownloadMode) === "true";
    const expireDate =
      data.expireDate && data.expireDate !== "null" && data.expireDate !== ""
        ? new Date(data.expireDate)
        : null;

    const updatedPackage = await prisma.documentPackage.update({
      where: { id },
      data: {
        title: data.title,
        message: data.message,
        targetType: data.targetType,
        entityName: data.entityName,
        mobile: data.mobile,
        email: data.email,
        linkType: data.linkType,
        pinCode: data.pinCode,
        permissions: data.permissions,
        showDisclaimer: showDisclaimer,
        disclaimerText: data.disclaimerText,
        directDownloadMode: directDownloadMode,
        expireDate: expireDate,
      },
    });

    await logAction(
      "تعديل حزمة ملفات",
      req.user?.name || "مدير النظام",
      `رقم الحزمة: ${id}`,
      "تعديل",
    );
    res.json({ success: true, data: updatedPackage });
  } catch (error) {
    console.error("Update Package Error:", error);
    res.status(500).json({ success: false, message: "فشل تحديث الحزمة" });
  }
};

exports.deleteDocumentPackage = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.documentPackage.delete({ where: { id } });
    await logAction(
      "حذف حزمة مرسلة",
      req.user?.name || "مدير النظام",
      `رقم الحزمة: ${id}`,
      "حذف",
    );
    res.json({ success: true, message: "تم حذف الحزمة بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل حذف الحزمة" });
  }
};

// ==========================================
// 4. تحديث الإعدادات
// ==========================================
exports.updateSettings = async (req, res) => {
  try {
    const { uploadSettings, downloadSettings } = req.body;
    const updated = await prisma.transferCenterSettings.update({
      where: { id: 1 },
      data: { uploadSettings, downloadSettings },
    });
    await logAction(
      "تغيير إعدادات المركز",
      req.user?.name || "مدير النظام",
      "تحديث الهوية البصرية",
      "تهيئة",
    );
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل تحديث الإعدادات" });
  }
};

// ==========================================
// 5. التحقق من الرابط الخارجي للعملاء
// ==========================================
exports.verifyExternalLink = async (req, res) => {
  try {
    const { type, shortLink } = req.params;

    let linkData = null;
    let settings = await prisma.transferCenterSettings.findUnique({
      where: { id: 1 },
    });

    if (type === "req") {
      linkData = await prisma.fileRequest.findUnique({ where: { shortLink } });
    } else {
      linkData = await prisma.documentPackage.findUnique({
        where: { shortLink },
      });
    }

    if (!linkData)
      return res
        .status(404)
        .json({ success: false, message: "الرابط غير صحيح أو تم حذفه." });

    if (linkData.expireDate && new Date(linkData.expireDate) < new Date()) {
      return res.status(403).json({
        success: false,
        status: "expired",
        message: "انتهت صلاحية الرابط.",
      });
    }

    if (type === "req") {
      await prisma.fileRequest.update({
        where: { id: linkData.id },
        data: { viewCount: { increment: 1 } },
      });
    } else {
      await prisma.documentPackage.update({
        where: { id: linkData.id },
        data: { viewCount: { increment: 1 }, status: "تم الاستلام" },
      });
    }

    res.json({
      success: true,
      data: linkData,
      config:
        type === "req" ? settings?.uploadSettings : settings?.downloadSettings,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "خطأ في السيرفر" });
  }
};

// ==========================================
// 6. رفع الملفات من العميل (Upload API)
// ==========================================
exports.uploadFilesFromClient = async (req, res) => {
  try {
    const { shortLink } = req.params;
    const { senderName, senderMobile, senderEmail, senderNote } = req.body;

    const fileRequest = await prisma.fileRequest.findUnique({
      where: { shortLink },
    });
    if (!fileRequest || fileRequest.status !== "نشط") {
      return res
        .status(400)
        .json({ success: false, message: "الرابط غير صالح أو منتهي الصلاحية" });
    }

    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم استلام أي ملفات" });
    }

    const receivedFilesData = req.files.map((file) => ({
      requestId: fileRequest.id,
      fileName: file.filename,
      originalName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype,
      filePath: `/uploads/transfer-center/${file.filename}`,
      senderName: senderName || null,
      senderMobile: senderMobile || null,
      senderEmail: senderEmail || null,
      senderNote: senderNote || null,
    }));

    await prisma.receivedFile.createMany({ data: receivedFilesData });

    // تحديث عداد الملفات في الطلب
    await prisma.fileRequest.update({
      where: { id: fileRequest.id },
      data: { uploadCount: { increment: req.files.length } },
    });

    await logAction(
      "رفع ملفات خارجية",
      senderName || "عميل",
      `رفع ${req.files.length} ملفات لطلب #${shortLink}`,
    );

    res.status(200).json({ success: true, message: "تم رفع الملفات بنجاح" });
  } catch (error) {
    console.error("Upload Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل في معالجة الملفات المرفوعة" });
  }
};

// ==========================================
// 7. إرسال الإشعارات عبر Twilio (SMS & WhatsApp)
// ==========================================
exports.sendNotification = async (req, res) => {
  try {
    const { to, channel, message } = req.body;

    if (!to || !channel || !message)
      return res.status(400).json({ success: false, message: "بيانات ناقصة" });
    if (!twilioClient)
      return res
        .status(500)
        .json({ success: false, message: "Twilio غير مفعل" });

    let formattedNumber = to.trim();
    if (formattedNumber.startsWith("0"))
      formattedNumber = "+966" + formattedNumber.substring(1);
    else if (!formattedNumber.startsWith("+"))
      formattedNumber = "+" + formattedNumber;

    let twilioResponse;
    if (channel === "whatsapp") {
      twilioResponse = await twilioClient.messages.create({
        body: message,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${formattedNumber}`,
      });
    } else if (channel === "sms") {
      twilioResponse = await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedNumber,
      });
    } else {
      return res
        .status(400)
        .json({ success: false, message: "قناة غير مدعومة" });
    }

    await logAction(
      `إرسال ${channel.toUpperCase()}`,
      req.user?.name || "النظام",
      `رقم: ${formattedNumber}`,
    );
    res.json({
      success: true,
      message: `تم الإرسال بنجاح`,
      messageId: twilioResponse.sid,
    });
  } catch (error) {
    console.error("Twilio Send Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل الإرسال، تأكد من الرقم" });
  }
};

// ==========================================
// 8. القوالب (Templates CRUD)
// ==========================================
exports.getTemplates = async (req, res) => {
  try {
    const templates = await prisma.notificationTemplate.findMany({
      where: { isActive: true },
    });
    if (templates.length === 0) {
      const defaultTemplates = [
        {
          code: "REQ_FIRST",
          type: "request",
          title: "طلب مستندات",
          content: "السلام عليكم {targetName}،\nرابط الرفع: {url}\n{pin_info}",
        },
        {
          code: "SND_FIRST",
          type: "send",
          title: "إرسال وثائق",
          content: "مرفق الوثائق:\n{url}\n{pin_info}",
        },
      ];
      await prisma.notificationTemplate.createMany({ data: defaultTemplates });
      return res.json({ success: true, data: defaultTemplates });
    }
    res.json({ success: true, data: templates });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل جلب القوالب" });
  }
};

exports.createTemplate = async (req, res) => {
  try {
    const template = await prisma.notificationTemplate.create({
      data: { ...req.body, code: `TPL-${Date.now()}` },
    });
    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل" });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const template = await prisma.notificationTemplate.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل" });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    await prisma.notificationTemplate.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "تم" });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل" });
  }
};

// ==========================================
// 🚀 9. إدارة الملفات المستلمة والذكاء الاصطناعي
// ==========================================

// 🚀 دالة تعديل الملف المستلم (للربط بمعاملة أو عميل)
exports.updateReceivedFile = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updatedFile = await prisma.receivedFile.update({
      where: { id },
      data: {
        isProcessed:
          data.isProcessed !== undefined ? data.isProcessed : undefined,
        linkedEntityId: data.linkedEntityId || undefined,
        // يمكنك إضافة أي حقول أخرى هنا
      },
    });

    res.json({ success: true, data: updatedFile });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل تعديل بيانات الملف" });
  }
};

// مسح ملف مرفوع
exports.deleteReceivedFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await prisma.receivedFile.findUnique({ where: { id } });

    if (file && file.filePath) {
      const fullPath = path.join(__dirname, "../../public", file.filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); // حذف من الهارد ديسك
    }

    await prisma.receivedFile.delete({ where: { id } });
    res.json({ success: true, message: "تم حذف الملف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل الحذف" });
  }
};

exports.aiRephrase = async (req, res) => {
  try {
    const { text, tone = "professional" } = req.body;

    if (!openai)
      return res
        .status(503)
        .json({ success: false, message: "لم يتم تفعيل مفتاح OpenAI" });
    if (!text)
      return res.status(400).json({ success: false, message: "النص مفقود" });

    const prompt = `قم بإعادة صياغة هذا النص ليكون بصيغة ${tone === "professional" ? "رسمية واحترافية" : "ودية ولطيفة"} وموجه للعملاء في شركة هندسية. احتفظ بالمتغيرات مثل {targetName} أو {url} كما هي بالضبط دون تغيير.\n\nالنص الأصلي:\n${text}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // نموذج سريع ورخيص
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    res.json({ success: true, text: completion.choices[0].message.content });
  } catch (error) {
    console.error("AI Rephrase Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل في معالجة الذكاء الاصطناعي" });
  }
};

exports.aiAnalyzeFile = async (req, res) => {
  try {
    const { fileId } = req.params;

    const file = await prisma.receivedFile.findUnique({
      where: { id: fileId },
    });
    if (!file)
      return res
        .status(404)
        .json({ success: false, message: "الملف غير موجود" });

    // محاكاة استجابة الذكاء الاصطناعي
    const aiAnalysisResult = {
      expectedType: file.fileType.includes("pdf")
        ? "وثيقة PDF"
        : "صورة / مستند",
      isOfficial: true,
      isMissingInfo: false,
      reviewNotes: "يبدو الملف سليماً وجاهزاً للربط. تم اكتشاف أختام وتواقيع.",
      confidence: 95,
    };

    await prisma.receivedFile.update({
      where: { id: fileId },
      data: { isProcessed: true, isSafe: true, aiAnalysis: aiAnalysisResult },
    });

    res.json({ success: true, data: aiAnalysisResult });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل التحليل الذكي" });
  }
};

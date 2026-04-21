const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const prisma = new PrismaClient();

// ==========================================
// 1. جلب جميع محاضر الاجتماعات
// ==========================================
exports.getAllMinutes = async (req, res) => {
  try {
    const minutes = await prisma.meetingMinute.findMany({
      orderBy: { createdAt: "desc" },
      // 💡 إذا قمت بفك التعليق عن العلاقات في Schema، فك التعليق هنا لجلب بياناتها:
      // include: { client: true, transaction: true }
    });

    res.json({ success: true, data: minutes });
  } catch (error) {
    console.error("Get All Minutes Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل جلب محاضر الاجتماعات" });
  }
};

// ==========================================
// 2. جلب محضر اجتماع محدد (بالآي دي)
// ==========================================
exports.getMinuteById = async (req, res) => {
  try {
    const { id } = req.params;
    const minute = await prisma.meetingMinute.findUnique({
      where: { id },
    });

    if (!minute) {
      return res
        .status(404)
        .json({ success: false, message: "المحضر غير موجود" });
    }

    res.json({ success: true, data: minute });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل جلب تفاصيل المحضر" });
  }
};

// ==========================================
// 3. إنشاء محضر اجتماع جديد
// ==========================================
exports.createMinute = async (req, res) => {
  try {
    const data = req.body;
    const { isNewRecord, id, client, transaction, ...minuteData } = data;

    // 💡 1. معالجة الـ Foreign Keys (تجنب خطأ P2003)
    const safeTransactionId = minuteData.transactionId?.trim() || null;
    const safeClientId = minuteData.clientId?.trim() || null;

    // 💡 2. حماية من تعارض أرقام المراجع
    let finalRefNumber = minuteData.referenceNumber;
    const existingRef = await prisma.meetingMinute.findUnique({
      where: { referenceNumber: finalRefNumber },
    });

    if (existingRef) {
      finalRefNumber = `${finalRefNumber}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    }

    // 💡 3. توليد رمز تحقق مشفر فريد (Secure Token للـ QR Code)
    const secureToken = crypto.randomBytes(20).toString("hex");

    const newMinute = await prisma.meetingMinute.create({
      data: {
        ...minuteData,
        referenceNumber: finalRefNumber,
        transactionId: safeTransactionId, // استخدام القيمة الآمنة
        transactionRef: minuteData.transactionRef || null,
        clientId: safeClientId, // استخدام القيمة الآمنة
        verificationToken: secureToken, // 🔐 حفظ الرمز المشفر
        attendees: minuteData.attendees || [],
        axes: minuteData.axes || [],
        steps: minuteData.steps || [],
        verification: minuteData.verification || {},
        advancedSignatureSettings: minuteData.advancedSignatureSettings || {},
        printSettings: minuteData.printSettings || {},
        attachments: minuteData.attachments || [],
        internalNotes: minuteData.internalNotes || null,
        createdBy: req.user?.name || "مدير النظام",
      },
    });

    res
      .status(201)
      .json({
        success: true,
        data: newMinute,
        message: "تم إنشاء المحضر بنجاح",
      });
  } catch (error) {
    console.error("Create Minute Error:", error);
    res.status(500).json({ success: false, message: "فشل إنشاء المحضر" });
  }
};

// ==========================================
// 4. تحديث محضر اجتماع (للحفظ التلقائي واليدوي)
// ==========================================
exports.updateMinute = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const { isNewRecord, client, transaction, createdAt, ...updateData } = data;

    // 💡 1. معالجة الـ Foreign Keys (تجنب خطأ P2003)
    const safeTransactionId = updateData.transactionId?.trim() || null;
    const safeClientId = updateData.clientId?.trim() || null;

    // 💡 2. توليد رمز تشفير إذا لم يكن موجوداً مسبقاً (للمحاضر القديمة)
    const existingMinute = await prisma.meetingMinute.findUnique({
      where: { id },
    });
    const secureToken =
      existingMinute?.verificationToken ||
      crypto.randomBytes(20).toString("hex");

    const updatedMinute = await prisma.meetingMinute.update({
      where: { id },
      data: {
        ...updateData,
        transactionId: safeTransactionId, // استخدام القيمة الآمنة
        transactionRef: updateData.transactionRef || null,
        clientId: safeClientId, // استخدام القيمة الآمنة
        verificationToken: secureToken, // 🔐 حفظ الرمز المشفر
        attendees: updateData.attendees || [],
        axes: updateData.axes || [],
        steps: updateData.steps || [],
        verification: updateData.verification || {},
        advancedSignatureSettings: updateData.advancedSignatureSettings || {},
        printSettings: updateData.printSettings || {},
        attachments: updateData.attachments || [],
        internalNotes: updateData.internalNotes || null,
        updatedBy: req.user?.name || "مدير النظام",
      },
    });

    res.json({
      success: true,
      data: updatedMinute,
      message: "تم تحديث المحضر بنجاح",
    });
  } catch (error) {
    console.error("Update Minute Error:", error);
    res.status(500).json({ success: false, message: "فشل تحديث المحضر" });
  }
};

// ==========================================
// 5. حذف محضر اجتماع
// ==========================================
exports.deleteMinute = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.meetingMinute.delete({
      where: { id },
    });

    res.json({ success: true, message: "تم حذف المحضر بنجاح" });
  } catch (error) {
    console.error("Delete Minute Error:", error);
    res.status(500).json({ success: false, message: "فشل حذف المحضر" });
  }
};

// ==========================================
// 🤖 6. المساعد الذكي (AI Copilot)
// ==========================================
exports.generateAiContent = async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res
        .status(400)
        .json({ success: false, message: "النص المطلوب مفقود" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "مفتاح API الخاص بالذكاء الاصطناعي غير متوفر",
      });
    }

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.json({ success: true, text: response.text });
  } catch (error) {
    console.error("AI Generation Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل الاتصال بالذكاء الاصطناعي" });
  }
};

// ==========================================
// 🔐 5. التحقق من المحضر بواسطة الرمز المشفر (QR Code Route)
// ==========================================
exports.verifyMinuteByToken = async (req, res) => {
  try {
    const { token } = req.params;
    
    // جلب كامل المحضر بواسطة الرمز المشفر
    const minute = await prisma.meetingMinute.findUnique({
      where: { verificationToken: token }
      // 💡 قمنا بإزالة select لكي يجلب المحاور والحضور والمرفقات
    });

    if (!minute) {
      return res.status(404).json({ success: false, message: "مستند غير صالح أو مزور" });
    }

    // 🔒 أمان: حذف الملاحظات الداخلية قبل إرسال البيانات للعميل
    if (minute.internalNotes) {
       delete minute.internalNotes; 
    }

    res.json({ success: true, data: minute });
  } catch (error) {
    res.status(500).json({ success: false, message: "خطأ في خادم التحقق" });
  }
};

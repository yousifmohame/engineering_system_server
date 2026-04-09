const { PrismaClient } = require("@prisma/client");
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");
const simpleParser = require("mailparser").simpleParser;
const prisma = new PrismaClient();
const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // تأكد من إعداد المفتاح في .env
// جلب جميع حسابات البريد
exports.getAccounts = async (req, res) => {
  try {
    const accounts = await prisma.emailAccount.findMany();
    res.json({ success: true, data: accounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// إضافة حساب بريد جديد مع التحقق الفعلي من صحة البيانات
exports.addAccount = async (req, res) => {
  try {
    const { accountName, email, password } = req.body;

    // 1. محاولة الاتصال بخادم SMTP للتحقق من صحة البريد وكلمة المرور
    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 587, // 👈 تغيير المنفذ
      secure: false, // 👈 تغيير هذه إلى false مع منفذ 587
      auth: {
        user: email,
        pass: password,
      },
      tls: {
        rejectUnauthorized: false, // 👈 أضف هذا السطر لتجنب مشاكل الشهادات
      },
    });

    try {
      // إذا كانت البيانات خاطئة، ستفشل هذه الدالة وترمي خطأ (throw error)
      await transporter.verify();
    } catch (verifyError) {
      console.error("Verification Error:", verifyError);
      return res.status(401).json({
        success: false,
        message:
          "فشل التحقق: البريد الإلكتروني أو كلمة المرور غير صحيحة، أو الخادم يرفض الاتصال.",
      });
    }

    // 2. إذا نجح التحقق، نقوم بحفظ الحساب في قاعدة البيانات
    const account = await prisma.emailAccount.create({
      data: {
        accountName,
        email,
        username: email,
        password: password, // ملاحظة: من الأفضل تشفيرها باستخدام AES مستقبلاً
        imapServer: "imap.hostinger.com",
        imapPort: 993,
        smtpServer: "smtp.hostinger.com",
        smtpPort: 465,
      },
    });

    res.json({ success: true, data: account });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// تحديث حساب بريد إلكتروني موجود
// تحديث حساب بريد إلكتروني موجود
exports.updateAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      accountName,
      email,
      password,
      imapServer,
      imapPort,
      smtpServer,
      smtpPort,
      useSSL,
    } = req.body;

    const existingAccount = await prisma.emailAccount.findUnique({
      where: { id },
    });
    if (!existingAccount) {
      return res
        .status(404)
        .json({ success: false, message: "الحساب غير موجود" });
    }

    const passToVerify = password || existingAccount.password;
    const emailToVerify = email || existingAccount.email;

    // 👇 التعديل هنا: التأكد من استخدام 587 و STARTTLS
    const finalSmtpPort = smtpPort
      ? parseInt(smtpPort)
      : existingAccount.smtpPort === 465
        ? 587
        : existingAccount.smtpPort;
    const isSecure = finalSmtpPort === 465; // إذا كان 465 اجعله true، غير ذلك (مثل 587) اجعله false

    const transporter = nodemailer.createTransport({
      host: smtpServer || existingAccount.smtpServer,
      port: finalSmtpPort,
      secure: isSecure,
      auth: {
        user: emailToVerify,
        pass: passToVerify,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    try {
      await transporter.verify();
    } catch (verifyError) {
      console.error("Verification Error on Update:", verifyError);
      return res.status(401).json({
        success: false,
        message:
          "فشل التحقق: تأكد من صحة البريد أو كلمة المرور الجديدة أو إعدادات الخادم.",
      });
    }

    const updatedAccount = await prisma.emailAccount.update({
      where: { id },
      data: {
        accountName,
        email,
        username: email,
        ...(password && { password }),
        imapServer: imapServer || existingAccount.imapServer,
        imapPort: imapPort ? parseInt(imapPort) : existingAccount.imapPort,
        smtpServer: smtpServer || existingAccount.smtpServer,
        smtpPort: finalSmtpPort, // حفظ المنفذ الصحيح
        useSSL: isSecure,
      },
    });

    res.json({
      success: true,
      data: updatedAccount,
      message: "تم تحديث الحساب بنجاح",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// حذف حساب بريد إلكتروني
exports.deleteAccount = async (req, res) => {
  try {
    const { id } = req.params;

    // التحقق من وجود الحساب
    const account = await prisma.emailAccount.findUnique({ where: { id } });
    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: "الحساب غير موجود" });
    }

    // حذف الحساب (الرسائل المرتبطة به ستُحذف تلقائياً بفضل onDelete: Cascade في الـ Prisma Schema)
    await prisma.emailAccount.delete({
      where: { id },
    });

    res.json({ success: true, message: "تم حذف الحساب بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// جلب الرسائل من قاعدة البيانات
exports.getMessages = async (req, res) => {
  try {
    const messages = await prisma.emailMessage.findMany({
      orderBy: { date: "desc" },
    });
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// إرسال رسالة بريد إلكتروني وحفظها في الصادر
// إرسال رسالة بريد إلكتروني وحفظها في الصادر
exports.sendMessage = async (req, res) => {
  try {
    const { accountId, to, subject, body } = req.body;

    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: "الحساب غير موجود" });
    }

    // 👇 التعديل هنا: التأكد من الإعدادات للاتصال بالسيرفر
    // نعتمد على المنفذ المحفوظ (الذي أصبح 587 الآن) ونحدد secure بناءً عليه
    const isSecure = account.smtpPort === 465;

    const transporter = nodemailer.createTransport({
      host: account.smtpServer,
      port: account.smtpPort,
      secure: isSecure, // false للمنفذ 587
      auth: {
        user: account.username,
        pass: account.password,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    const info = await transporter.sendMail({
      from: `"${account.accountName}" <${account.email}>`,
      to,
      subject,
      text: body,
    });

    const sentMessage = await prisma.emailMessage.create({
      data: {
        messageId: info.messageId || Date.now().toString(),
        accountId: account.id,
        from: account.email,
        to,
        subject,
        body,
        date: new Date(),
        isSent: true,
        isRead: true,
      },
    });

    res.json({ success: true, data: sentMessage });
  } catch (error) {
    console.error("Send Email Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل الإرسال: " + error.message });
  }
};

// تحديث حالة الرسالة (مقروءة، مفضلة، مؤرشفة، محذوفة)
exports.updateMessageStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body; // { isDeleted: true, isStarred: true, etc }

    // 1. محاولة تحديث الرسالة إذا كانت موجودة مسبقاً في الداتابيز (رسائل الصادر أو رسائل تم التفاعل معها سابقاً)
    try {
      const message = await prisma.emailMessage.update({
        where: { messageId: id }, // نستخدم messageId لأنه الـ UID القادم من Hostinger
        data: updateData,
      });
      return res.json({ success: true, data: message });
    } catch (dbError) {
      // إذا لم تكن الرسالة موجودة (Record to update not found)، ننتقل للخطوة الثانية
      if (dbError.code === "P2025") {
        // 2. إذا لم تكن موجودة، نقوم بإنشائها في الداتابيز مع حالتها الجديدة
        // نحتاج أولاً للحصول على accountId المربوط
        const account = await prisma.emailAccount.findFirst({
          where: { isActive: true },
        });
        if (!account) throw new Error("لا يوجد حساب بريد نشط");

        // بما أن الواجهة الأمامية ترسل الـ ID فقط ولا ترسل محتوى الرسالة،
        // سنقوم بإنشاء "سجل ظل" (Shadow Record) في الداتابيز ليحفظ حالة هذه الرسالة (مثلاً: محذوفة)
        const shadowMessage = await prisma.emailMessage.create({
          data: {
            messageId: id, // الـ UID من Hostinger
            accountId: account.id,
            from: req.body.from || "مجهول", // من الأفضل إرسال هذه البيانات من الفرونت إند
            to: account.email,
            subject: req.body.subject || "رسالة واردة",
            body: "تم إنشاء هذا السجل لحفظ حالة الرسالة",
            date: new Date(),
            ...updateData, // نطبق الحالة الجديدة هنا (isDeleted: true مثلاً)
          },
        });

        return res.json({
          success: true,
          data: shadowMessage,
          message: "تم حفظ الحالة الجديدة للرسالة الواردة",
        });
      }

      // إذا كان الخطأ شيئاً آخر غير "عدم الوجود"، نرمي الخطأ
      throw dbError;
    }
  } catch (error) {
    console.error("Update Message Status Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.syncHostingerEmails = async (req, res) => {
  try {
    // 💡 استقبال رقم الصفحة من الواجهة الأمامية (الافتراضي 1)
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const account = await prisma.emailAccount.findFirst({
      where: { isActive: true },
    });

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: "لا يوجد حساب بريد مربوط" });
    }

    const client = new ImapFlow({
      host: account.imapServer || "imap.hostinger.com",
      port: account.imapPort || 993,
      secure: true,
      auth: {
        user: account.email,
        pass: account.password,
      },
      logger: false,
    });

    await client.connect();
    let lock = await client.getMailboxLock("INBOX");
    const messages = [];

    try {
      const totalMessages = client.mailbox.exists;
      if (totalMessages === 0) {
        // 💡 تم إصلاح إغلاق الاتصال هنا لتجنب تسرب الذاكرة
        lock.release();
        await client.logout();
        return res.json({
          success: true,
          data: [],
          message: "صندوق الوارد فارغ.",
        });
      }

      // 💡 معادلات حساب النطاق (Range) بناءً على رقم الصفحة
      const fetchEnd = totalMessages - (page - 1) * limit;
      const fetchStart = Math.max(1, totalMessages - page * limit + 1);

      // إذا تجاوزنا عدد الرسائل المتاحة
      if (fetchEnd < 1) {
        // 💡 تم إصلاح إغلاق الاتصال هنا أيضاً
        lock.release();
        await client.logout();
        return res.json({ success: true, data: [] });
      }

      const fetchRange = `${fetchStart}:${fetchEnd}`;
      console.log(`⏳ جاري جلب الصفحة ${page} (النطاق: ${fetchRange})...`);

      for await (let msg of client.fetch(
        fetchRange,
        { source: true, envelope: true, flags: true, uid: true },
        { reverse: true },
      )) {
        const parsed = await simpleParser(msg.source);

        let category = "عام";
        let severity = "low";
        if (parsed.subject?.includes("عاجل")) {
          category = "عاجل";
          severity = "high";
        } else if (
          parsed.subject?.includes("فاتورة") ||
          parsed.subject?.includes("دفع")
        ) {
          category = "مالي";
          severity = "high";
        }

        messages.push({
          id: msg.uid.toString(),
          subject: parsed.subject || "(بدون عنوان)",
          from:
            parsed.from?.value[0]?.address || parsed.from?.text || "غير معروف",

          // 🚀 التعديل الجوهري هنا: استخراج الـ Text والـ HTML معاً
          body: parsed.text || "",
          html: parsed.html || parsed.textAsHtml || "",

          date: parsed.date,
          isRead: msg.flags?.has("\\Seen") || false,
          category: category,
          severity: severity,
        });
      }
    } finally {
      // سيتم تحرير القفل هنا دائماً بفضل الـ finally
      if (lock) lock.release();
    }

    await client.logout();
    res.json({ success: true, data: messages });
  } catch (error) {
    console.error("IMAP Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل الاتصال: " + error.message });
  }
};

exports.analyzeInboxWithAI = async (req, res) => {
  try {
    const account = await prisma.emailAccount.findFirst({
      where: { isActive: true },
    });
    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "لا يوجد حساب بريد مربوط" });

    const client = new ImapFlow({
      host: account.imapServer || "imap.hostinger.com",
      port: account.imapPort || 993,
      secure: true,
      auth: { user: account.email, pass: account.password },
      logger: false,
    });

    await client.connect();
    let lock = await client.getMailboxLock("INBOX");
    const rawMessages = [];

    // 💡 1. قائمة الكلمات المفتاحية لرسائل شركات الاتصالات (السبام)
    const telecomSpamKeywords = [
      "باقة",
      "باقات",
      "رصيد",
      "اشحن",
      "ميجابايت",
      "جيجابايت",
      "نت",
      "سلفني",
      "عرض",
      "عروض",
      "خصم",
      "حصريا",
      "استمتع",
      "موبايلي",
      "stc",
      "زين",
      "فودافون",
      "اتصالات",
      "وي",
      "نغمات",
      "كول تون",
      "اشترك",
      "ارسل رقم",
    ];

    try {
      const totalMessages = client.mailbox.exists;
      if (totalMessages === 0) return res.json({ success: true, data: [] });

      const fetchStart = Math.max(1, totalMessages - 19); // جلب آخر 20 رسالة مثلاً
      for await (let msg of client.fetch(
        `${fetchStart}:*`,
        { source: true, flags: true, uid: true },
        { reverse: true },
      )) {
        const parsed = await simpleParser(msg.source);

        const subject = parsed.subject || "";
        const bodyText = parsed.text || "";
        const fullTextForCheck = (subject + " " + bodyText).toLowerCase();

        // 💡 2. الفلترة المبدئية: هل تحتوي الرسالة على كلمات سبام صريحة؟
        const isObviousSpam = telecomSpamKeywords.some((keyword) =>
          fullTextForCheck.includes(keyword),
        );

        // إذا كانت سبام واضح، لا نرسلها للذكاء الاصطناعي (توفيراً للتكلفة) ونصنفها فوراً
        if (isObviousSpam) {
          rawMessages.push({
            id: msg.uid.toString(),
            category: "سبام",
            subCategory: null,
            severity: "low",
            title: "رسالة دعائية - شركة الاتصالات",
            description: bodyText.substring(0, 200),
            amount: null,
            relatedEntityCode: "TELECOM-AD",
            timestamp: parsed.date,
            isRead: true, // نعتبرها مقروءة حتى لا تزعجنا
            from: parsed.from?.text || "شركة الاتصالات",
          });
          continue; // تخطي إرسالها للـ AI
        }

        // إذا كانت رسالة عادية، نجهزها للـ AI
        rawMessages.push({
          id: msg.uid.toString(),
          subject: subject,
          text: bodyText.substring(0, 800),
          date: parsed.date,
          isRead: msg.flags?.has("\\Seen") || false,
          from: parsed.from?.text || "مجهول",
        });
      }
    } finally {
      lock.release();
    }
    await client.logout();

    // فصل الرسائل التي تحتاج ذكاء اصطناعي عن رسائل السبام الجاهزة
    const messagesForAI = rawMessages.filter((m) => m.category !== "سبام");
    const preFilteredSpam = rawMessages.filter((m) => m.category === "سبام");

    let finalArray = [...preFilteredSpam]; // نبدأ بإضافة السبام المفلتر للنتيجة النهائية

    // 💡 3. إرسال الرسائل المتبقية للذكاء الاصطناعي مع تعليمات صارمة
    if (messagesForAI.length > 0) {
      const prompt = `
          أنت مساعد ذكي لنظام إدارة مكتب هندسي. تم استلام رسائل محولة من شريحة جوال (SMS) أو إيميلات.
          
          تعليمات هامة جداً: 
          إذا كانت الرسالة تبدو كإعلان من شركة اتصالات، ترويج، عرض، أو لا تحتوي على معلومات تهم عمل المكتب الهندسي أو معاملاته المالية، صنفها فوراً كـ "سبام".
          
          قم بتحليل كل رسالة واستخرج البيانات بصيغة JSON Array:
          - id: نفس الـ id المُرسل
          - category: اختر من ("عاجل", "مالي", "توثيق", "نظام", "معاملات", "سبام", "عام")
          - subCategory: إذا كان مالي (فواتير، دفعات، تحويل بنكي.. الخ).
          - severity: (high, medium, low).
          - title: عنوان مختصر يعبر عن المشكلة.
          - description: ملخص للمحتوى.
          - amount: استخرج المبلغ المالي كرقم إن وجد، وإلا null.
          - relatedEntityCode: كود مرجعي أو رقم فاتورة.
          - timestamp: نفس التاريخ المُرسل.
          - isRead: نفس القيمة المُرسلة.
          - from: نفس المُرسل.
          
          الرسائل:
          ${JSON.stringify(messagesForAI)}
        `;

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo-1106",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You strictly output valid JSON arrays containing the analyzed emails.",
          },
          { role: "user", content: prompt },
        ],
      });

      const analyzedDataStr = aiResponse.choices[0].message.content;
      const parsedData = JSON.parse(analyzedDataStr);
      const aiAnalyzedMessages = Array.isArray(parsedData)
        ? parsedData
        : parsedData.emails ||
          parsedData.notifications ||
          parsedData.data ||
          [];

      // دمج نتائج الـ AI مع نتائج الفلترة السريعة
      finalArray = [...finalArray, ...aiAnalyzedMessages];
    }

    // ترتيب الرسائل من الأحدث للأقدم
    finalArray.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ success: true, data: finalArray });
  } catch (error) {
    console.error("AI Analysis Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل التحليل الذكي: " + error.message });
  }
};

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
      port: 465,
      secure: true, // يتطلب SSL
      auth: {
        user: email,
        pass: password,
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
exports.updateAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { accountName, email, password, imapServer, imapPort, smtpServer, smtpPort, useSSL } = req.body;

    // 1. التحقق من أن الحساب موجود أصلاً في قاعدة البيانات
    const existingAccount = await prisma.emailAccount.findUnique({ where: { id } });
    if (!existingAccount) {
      return res.status(404).json({ success: false, message: "الحساب غير موجود" });
    }

    // 2. التحقق من صحة الاتصال بالخادم باستخدام البيانات الجديدة (إذا تم إرسال كلمة مرور)
    const passToVerify = password || existingAccount.password;
    const emailToVerify = email || existingAccount.email;

    const transporter = nodemailer.createTransport({
      host: smtpServer || existingAccount.smtpServer,
      port: smtpPort || existingAccount.smtpPort,
      secure: useSSL !== undefined ? useSSL : existingAccount.useSSL,
      auth: {
        user: emailToVerify,
        pass: passToVerify,
      },
    });

    try {
      await transporter.verify();
    } catch (verifyError) {
      console.error("Verification Error on Update:", verifyError);
      return res.status(401).json({
        success: false,
        message: "فشل التحقق: تأكد من صحة البريد أو كلمة المرور الجديدة أو إعدادات الخادم.",
      });
    }

    // 3. تحديث البيانات في قاعدة البيانات
    const updatedAccount = await prisma.emailAccount.update({
      where: { id },
      data: {
        accountName,
        email,
        username: email,
        ...(password && { password }), // تحديث كلمة المرور فقط إذا قام المستخدم بكتابة واحدة جديدة
        imapServer: imapServer || existingAccount.imapServer,
        imapPort: imapPort ? parseInt(imapPort) : existingAccount.imapPort,
        smtpServer: smtpServer || existingAccount.smtpServer,
        smtpPort: smtpPort ? parseInt(smtpPort) : existingAccount.smtpPort,
        useSSL: useSSL !== undefined ? useSSL : existingAccount.useSSL
      },
    });

    res.json({ success: true, data: updatedAccount, message: "تم تحديث الحساب بنجاح" });
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
exports.sendMessage = async (req, res) => {
  try {
    const { accountId, to, subject, body } = req.body;

    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
    });
    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "الحساب غير موجود" });

    // إعداد Nodemailer لـ Hostinger
    const transporter = nodemailer.createTransport({
      host: account.smtpServer,
      port: account.smtpPort,
      secure: account.useSSL,
      auth: {
        user: account.username,
        pass: account.password,
      },
    });

    // إرسال الرسالة
    const info = await transporter.sendMail({
      from: `"${account.accountName}" <${account.email}>`,
      to,
      subject,
      text: body, // يمكنك إرسال html: body إذا كان المحتوى منسقاً
    });

    // حفظها في الصادر بقاعدة البيانات
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
    res.status(500).json({ success: false, message: error.message });
  }
};

// تحديث حالة الرسالة (مقروءة، مفضلة، مؤرشفة، محذوفة)
exports.updateMessageStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body; // { isRead: true, isStarred: false, etc }

    const message = await prisma.emailMessage.update({
      where: { id },
      data: updateData,
    });
    res.json({ success: true, data: message });
  } catch (error) {
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
      return res.status(404).json({ success: false, message: "لا يوجد حساب بريد مربوط" });
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
        return res.json({ success: true, data: [], message: "صندوق الوارد فارغ." });
      }

      // 💡 معادلات حساب النطاق (Range) بناءً على رقم الصفحة
      // مثال: صفحة 1 تجلب من 1357 إلى 1406
      // صفحة 2 تجلب من 1307 إلى 1356 وهكذا...
      const fetchEnd = totalMessages - ((page - 1) * limit);
      const fetchStart = Math.max(1, totalMessages - (page * limit) + 1);

      // إذا تجاوزنا عدد الرسائل المتاحة
      if (fetchEnd < 1) {
        return res.json({ success: true, data: [] });
      }

      const fetchRange = `${fetchStart}:${fetchEnd}`;
      console.log(`⏳ جاري جلب الصفحة ${page} (النطاق: ${fetchRange})...`);

      for await (let msg of client.fetch(
        fetchRange,
        { source: true, envelope: true, flags: true, uid: true },
        { reverse: true }
      )) {
        const parsed = await simpleParser(msg.source);

        let category = "عام";
        let severity = "low";
        if (parsed.subject?.includes("عاجل")) {
          category = "عاجل"; severity = "high";
        } else if (parsed.subject?.includes("فاتورة") || parsed.subject?.includes("دفع")) {
          category = "مالي"; severity = "high";
        }

        messages.push({
          id: msg.uid.toString(),
          subject: parsed.subject || "(بدون عنوان)",
          from: parsed.from?.value[0]?.address || parsed.from?.text || "غير معروف",
          body: parsed.text || "لا يوجد نص",
          date: parsed.date,
          isRead: msg.flags?.has("\\Seen") || false,
          category: category,
          severity: severity,
        });
      }
    } finally {
      lock.release();
    }

    await client.logout();
    res.json({ success: true, data: messages });
    
  } catch (error) {
    console.error("IMAP Error:", error);
    res.status(500).json({ success: false, message: "فشل الاتصال: " + error.message });
  }
};

exports.analyzeInboxWithAI = async (req, res) => {
  try {
    const account = await prisma.emailAccount.findFirst({ where: { isActive: true } });
    if (!account) return res.status(404).json({ success: false, message: "لا يوجد حساب بريد مربوط" });

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

    try {
      // 1. جلب أحدث 10 إيميلات للتحليل (تقليل العدد لتوفير تكلفة OpenAI)
      const totalMessages = client.mailbox.exists;
      if (totalMessages === 0) return res.json({ success: true, data: [] });
      
      const fetchStart = Math.max(1, totalMessages - 9);
      for await (let msg of client.fetch(`${fetchStart}:*`, { source: true, flags: true, uid: true }, { reverse: true })) {
        const parsed = await simpleParser(msg.source);
        rawMessages.push({
          id: msg.uid.toString(),
          subject: parsed.subject || "بدون عنوان",
          text: parsed.text ? parsed.text.substring(0, 800) : "لا يوجد محتوى", // أخذ أول 800 حرف لتوفير التكلفة
          date: parsed.date,
          isRead: msg.flags?.has("\\Seen") || false,
        });
      }
    } finally {
      lock.release();
    }
    await client.logout();

    // 2. إعداد الـ Prompt وإرسال البيانات للذكاء الاصطناعي كـ Batch
    // سنطلب من AI إرجاع مصفوفة JSON جاهزة للواجهة الأمامية
    const prompt = `
      أنت مساعد ذكي لنظام إدارة مكتب هندسي. تم استلام مجموعة من رسائل البريد الإلكتروني.
      قم بتحليل كل رسالة واستخرج البيانات التالية بصيغة JSON Array فقط دون أي نص إضافي:
      
       لكل رسالة، قم بتحديد:
      - id: نفس الـ id المُرسل
      - category: إما ("عاجل" أو "مالي" أو "توثيق" أو "نظام" أو "معاملات" أو "عام")
      - subCategory: إذا كان مالي (اختر: "فواتير متأخرة"، "فواتير قريبة الاستحقاق"، "دفعات غير مربوطة"، "تسويات جاهزة"، "تسويات بدون مرفق"، "معاملات معتمدة بمتأخرات"). إذا لم يكن مالياً اجعله null.
      - severity: (high, medium, low) بناءً على محتوى الرسالة.
      - title: ضع عنواناً مختصراً وواضحاً يعبر عن فحوى المشكلة (أفضل من عنوان الإيميل الأصلي).
      - description: ملخص للمحتوى والخطوة المطلوبة من المستخدم.
      - amount: إذا كانت الرسالة مالية وتحتوي على مبلغ، استخرجه كرقم (مثال: 15500). إذا لم يوجد، اجعله null.
      - relatedEntityCode: إذا كان هناك رقم فاتورة (مثل INV-123) أو معاملة، استخرجه. إذا لا، قم بتوليد كود وهمي.
      - timestamp: أعد نفس التاريخ المُرسل إليك.
      - isRead: أعد نفس القيمة المُرسلة إليك.
      
      الرسائل:
      ${JSON.stringify(rawMessages)}
    `;

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-1106", // الأرخص والأسرع لمهام الـ JSON
      response_format: { type: "json_object" }, // إجبار الموديل على إرجاع JSON نظيف
      messages: [
        { role: "system", content: "You are a highly capable AI that analyzes emails and returns strict JSON arrays." },
        { role: "user", content: prompt }
      ],
    });

    // 3. استقبال المخرجات من AI وتنسيقها للواجهة الأمامية
    const analyzedDataStr = aiResponse.choices[0].message.content;
    const parsedData = JSON.parse(analyzedDataStr);
    
    // بعض الـ AI يرجع البيانات داخل مفتاح، نتحقق من ذلك
    const finalArray = Array.isArray(parsedData) ? parsedData : (parsedData.emails || parsedData.notifications || parsedData.data || []);

    res.json({ success: true, data: finalArray });

  } catch (error) {
    console.error("AI Analysis Error:", error);
    res.status(500).json({ success: false, message: "فشل التحليل الذكي: " + error.message });
  }
};
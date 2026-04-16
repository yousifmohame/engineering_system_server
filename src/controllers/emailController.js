const { PrismaClient } = require("@prisma/client");
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");
const simpleParser = require("mailparser").simpleParser;
const prisma = new PrismaClient();
const { OpenAI } = require("openai");
const { GoogleGenAI } = require("@google/genai");
const { z } = require("zod");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 💡 Zod Schema للتحقق من هيكل البيانات المستخرجة
const EmailAISchema = z.object({
  reqNumber: z.string().nullable().catch(null),
  reqYear: z.string().nullable().catch(null),
  serviceNumber: z.string().nullable().catch(null),
  serviceYear: z.string().nullable().catch(null),
  ownerName: z.string().nullable().catch(null),
  serviceType: z.string().nullable().catch(null),
  replyText: z.string().nullable().catch(null),
  entityName: z.string().nullable().catch(null),
  viewTime: z.string().nullable().catch(null),
  sectorName: z.string().nullable().catch(null),
});

// 🚀 دالة التحليل
exports.analyzeEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, body, text, from, date } = req.body;

    // 1. البحث عن الرسالة
    let message = await prisma.emailMessage.findFirst({
      where: { OR: [{ id: id }, { messageId: id }] },
    });

    // 2. إذا لم تكن موجودة، نقوم بإنشائها
    if (!message) {
      const account = await prisma.emailAccount.findFirst({
        where: { isActive: true },
      });
      if (!account)
        return res.status(404).json({
          success: false,
          message: "لا يوجد حساب بريد مربوط لحفظ الرسالة",
        });

      message = await prisma.emailMessage.create({
        data: {
          messageId: id,
          accountId: account.id,
          subject: subject || "بدون عنوان",
          body: body || text || "",
          from: from || "مجهول",
          to: account.email,
          date: date ? new Date(date) : new Date(),
          isRead: true,
        },
      });
    }

    // 3. تجهيز النص للتحليل
    const textToAnalyze = `Subject: ${message.subject}\n\nBody:\n${message.body || message.text}`;

    const promptInstruction = `
    أنت نظام تحليل نصوص حكومي سعودي (منصة بلدي).
    اقرأ الرسالة التالية بعناية، واستخرج منها البيانات التالية بدقة باللغة العربية:
    رقم الطلب، سنة الطلب، رقم الخدمة، سنة الخدمة، اسم المالك (إن وجد)، نوع الخدمة، الإفادة (أي محتوى الرد أو الملاحظة)، اسم الجهة المصدرة، وقت الإطلاع (إذا تم ذكره صراحة)، والقطاع (مثل: قطاع وسط الرياض).
    
    قم بإرجاع كائن JSON حصرياً بالصيغة التالية (بدون أي نص إضافي أو Markdown):
    {
      "reqNumber": "القيمة أو null",
      "reqYear": "القيمة أو null",
      "serviceNumber": "القيمة أو null",
      "serviceYear": "القيمة أو null",
      "ownerName": "القيمة أو null",
      "serviceType": "القيمة أو null",
      "replyText": "القيمة أو null",
      "entityName": "القيمة أو null",
      "viewTime": "القيمة أو null",
      "sectorName": "القيمة أو null"
    }

    النص:
    ${textToAnalyze}
    `;

    console.log(`🤖 جاري تحليل الرسالة [${id}]...`);
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: promptInstruction }] }],
      config: { temperature: 0.0, responseMimeType: "application/json" },
    });

    const responseText = response.text;

    // 4. تنظيف النص
    const cleanJson = responseText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (e) {
      throw new Error("فشل الذكاء الاصطناعي في توليد JSON صحيح");
    }

    const validatedData = EmailAISchema.parse(parsedData);

    // 5. محاولة إيجاد معاملة مطابقة
    let linkedTxId = null;
    let matchConfidence = null;
    if (validatedData.reqNumber) {
      const matchedTx = await prisma.privateTransaction.findFirst({
        where: {
          OR: [
            { transactionCode: { contains: validatedData.reqNumber } },
            {
              notes: {
                path: ["refs", "baladyNumber"],
                equals: validatedData.reqNumber,
              },
            },
          ],
        },
      });
      if (matchedTx) {
        linkedTxId = matchedTx.id;
        matchConfidence = 95;
      }
    }

    // 6. تحديث الرسالة في قاعدة البيانات
    const updatedMessage = await prisma.emailMessage.update({
      where: { id: message.id },
      data: {
        isAnalyzed: true,
        reqNumber: validatedData.reqNumber,
        reqYear: validatedData.reqYear,
        serviceNumber: validatedData.serviceNumber,
        serviceYear: validatedData.serviceYear,
        ownerName: validatedData.ownerName,
        serviceType: validatedData.serviceType,
        replyText: validatedData.replyText,
        entityName: validatedData.entityName,
        viewTime: validatedData.viewTime,
        sectorName: validatedData.sectorName,
        linkedTxId: linkedTxId,
        matchConfidence: matchConfidence,
      },
    });

    res.json({ success: true, data: updatedMessage });
  } catch (error) {
    console.error("AI Email Analysis Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// جلب جميع حسابات البريد
exports.getAccounts = async (req, res) => {
  try {
    const accounts = await prisma.emailAccount.findMany();
    res.json({ success: true, data: accounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// إضافة حساب بريد جديد
exports.addAccount = async (req, res) => {
  try {
    const { accountName, email, password } = req.body;

    // 💡 إجبار استخدام المنفذ 465 المشفر لتجنب حظر الاستضافة للمنفذ 587
    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true, // 👈 465 يتطلب secure: true
      auth: {
        user: email,
        pass: password,
      },
      tls: {
        rejectUnauthorized: false,
      },
      // 💡 تجنب التعليق أثناء التحقق
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    try {
      await transporter.verify();
    } catch (verifyError) {
      console.error("Verification Error:", verifyError);
      return res.status(401).json({
        success: false,
        message:
          "فشل التحقق: البريد الإلكتروني أو كلمة المرور غير صحيحة، أو الخادم يرفض الاتصال.",
      });
    }

    const account = await prisma.emailAccount.create({
      data: {
        accountName,
        email,
        username: email,
        password: password,
        imapServer: "imap.hostinger.com",
        imapPort: 993,
        smtpServer: "smtp.hostinger.com",
        smtpPort: 465, // حفظه كـ 465
        useSSL: true, // تأكيد استخدام SSL
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
    const { accountName, email, password, imapServer, imapPort, smtpServer } =
      req.body;

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

    // 💡 إجبار استخدام المنفذ 465 المشفر
    const transporter = nodemailer.createTransport({
      host: smtpServer || existingAccount.smtpServer,
      port: 465, // إجبار 465
      secure: true, // إجبار true
      auth: {
        user: emailToVerify,
        pass: passToVerify,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
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
        smtpPort: 465, // إجبار التخزين كـ 465
        useSSL: true,
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

    const account = await prisma.emailAccount.findUnique({ where: { id } });
    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: "الحساب غير موجود" });
    }

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

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: "الحساب غير موجود" });
    }

    // 💡 إجبار استخدام المنفذ 465 لحل مشكلة الحظر المؤدية لـ 504 Timeout
    const transporter = nodemailer.createTransport({
      host: account.smtpServer,
      port: 2525, // 👈 استخدام هذا المنفذ البديل
      secure: false, // 👈 يجب أن تكون false مع منفذ 2525
      auth: {
        user: account.email,
        pass: account.password,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
    });

    console.log(
      `⏳ جاري محاولة إرسال الرسالة عبر ${account.smtpServer}:465...`,
    );

    const info = await transporter.sendMail({
      from: `"${account.accountName}" <${account.email}>`,
      to,
      subject,
      text: body,
    });

    console.log("✅ تم الإرسال بنجاح:", info.messageId);

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
    // بفضل إعدادات Timeout، سيتم رمي الخطأ هنا فوراً بدلاً من تعليق السيرفر
    console.error("❌ Send Email Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل الإرسال: " + error.message });
  }
};

// تحديث حالة الرسالة
exports.updateMessageStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    try {
      const message = await prisma.emailMessage.update({
        where: { messageId: id },
        data: updateData,
      });
      return res.json({ success: true, data: message });
    } catch (dbError) {
      if (dbError.code === "P2025") {
        const account = await prisma.emailAccount.findFirst({
          where: { isActive: true },
        });
        if (!account) throw new Error("لا يوجد حساب بريد نشط");

        const shadowMessage = await prisma.emailMessage.create({
          data: {
            messageId: id,
            accountId: account.id,
            from: req.body.from || "مجهول",
            to: account.email,
            subject: req.body.subject || "رسالة واردة",
            body: "تم إنشاء هذا السجل لحفظ حالة الرسالة",
            date: new Date(),
            ...updateData,
          },
        });

        return res.json({
          success: true,
          data: shadowMessage,
          message: "تم حفظ الحالة الجديدة للرسالة الواردة",
        });
      }
      throw dbError;
    }
  } catch (error) {
    console.error("Update Message Status Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.syncHostingerEmails = async (req, res) => {
  try {
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
        lock.release();
        await client.logout();
        return res.json({
          success: true,
          data: [],
          message: "صندوق الوارد فارغ.",
        });
      }

      const fetchEnd = totalMessages - (page - 1) * limit;
      const fetchStart = Math.max(1, totalMessages - page * limit + 1);

      if (fetchEnd < 1) {
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
          body: parsed.text || "",
          html: parsed.html || parsed.textAsHtml || "",
          date: parsed.date,
          isRead: msg.flags?.has("\\Seen") || false,
          category: category,
          severity: severity,
        });
      }
    } finally {
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

      const fetchStart = Math.max(1, totalMessages - 19);
      for await (let msg of client.fetch(
        `${fetchStart}:*`,
        { source: true, flags: true, uid: true },
        { reverse: true },
      )) {
        const parsed = await simpleParser(msg.source);

        const subject = parsed.subject || "";
        const bodyText = parsed.text || "";
        const fullTextForCheck = (subject + " " + bodyText).toLowerCase();

        const isObviousSpam = telecomSpamKeywords.some((keyword) =>
          fullTextForCheck.includes(keyword),
        );

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
            isRead: true,
            from: parsed.from?.text || "شركة الاتصالات",
          });
          continue;
        }

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

    const messagesForAI = rawMessages.filter((m) => m.category !== "سبام");
    const preFilteredSpam = rawMessages.filter((m) => m.category === "سبام");

    let finalArray = [...preFilteredSpam];

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

      finalArray = [...finalArray, ...aiAnalyzedMessages];
    }

    finalArray.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ success: true, data: finalArray });
  } catch (error) {
    console.error("AI Analysis Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل التحليل الذكي: " + error.message });
  }
};

exports.searchMessages = async (req, res) => {
  try {
    const { serviceNumber, reqNumber } = req.query;

    if (!serviceNumber && !reqNumber) {
      return res.json({ success: true, data: [] });
    }

    const orConditions = [];
    if (serviceNumber) {
      orConditions.push({ serviceNumber: { contains: serviceNumber } });
      orConditions.push({ body: { contains: serviceNumber } });
      orConditions.push({ subject: { contains: serviceNumber } });
    }
    if (reqNumber) {
      orConditions.push({ reqNumber: { contains: reqNumber } });
      orConditions.push({ body: { contains: reqNumber } });
      orConditions.push({ subject: { contains: reqNumber } });
    }

    const messages = await prisma.emailMessage.findMany({
      where: { OR: orConditions },
      orderBy: { date: "desc" },
      take: 10,
    });

    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

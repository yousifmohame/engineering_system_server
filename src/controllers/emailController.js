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

exports.aiComposeEmail = async (req, res) => {
  try {
    const { text, action } = req.body;

    if (!text || text.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "يجب إرسال النص المطلوب معالجته" });
    }

    // 💡 1. هذه التعليمات الصارمة ستجبر الذكاء الاصطناعي على إعطائك نص الرسالة فقط
    const strictRules = `
    تعليمات صارمة جداً لتنفيذ المهمة:
    1. أعد فقط النص النهائي للرسالة ليكون جاهزاً للنسخ والإرسال للعميل مباشرة.
    2. إياك أن تكتب أي مقدمات أو ترحيب من طرفك (مثل: "بالتأكيد، إليك الصيغة"، "الخيار الأول"، أو "إليك النص").
    3. لا تضع خيارات متعددة أبداً، أعطني رسالة واحدة فقط.
    4. إياك أن تكتب نصائح أو ملاحظات في نهاية النص.
    5. لا تقم بكتابة التوقيع أو بيانات الاتصال في الأسفل (مثل: [اسمك]، [المسمى الوظيفي])، فقط انهِ الرسالة بخاتمة مهذبة مثل "مع خالص التحية والتقدير".
    `;

    let promptInstruction = "";
    switch (action) {
      case "rewrite":
        promptInstruction = `أعد صياغة النص التالي بأسلوب بريد إلكتروني احترافي ومقنع:\n\n${text}\n\n${strictRules}`;
        break;
      case "formal":
        promptInstruction = `حول النص التالي إلى صيغة بريد إلكتروني رسمي جداً ومهني، مناسب لمخاطبة الجهات الحكومية أو الشركات الكبرى:\n\n${text}\n\n${strictRules}`;
        break;
      case "shorten":
        promptInstruction = `لخص النص التالي واجعله بريداً إلكترونياً مباشراً وقصيراً مع الحفاظ على الفكرة الأساسية:\n\n${text}\n\n${strictRules}`;
        break;
      case "expand":
        promptInstruction = `قم بتوسيع النص التالي ليصبح بريداً إلكترونياً احترافياً متكاملاً يشرح الفكرة بوضوح وتفصيل:\n\n${text}\n\n${strictRules}`;
        break;
      default:
        promptInstruction = `قم بتصحيح وتنسيق النص التالي ليكون بريداً إلكترونياً احترافياً:\n\n${text}\n\n${strictRules}`;
    }

    console.log(`🤖 جاري صياغة النص باستخدام الذكاء الاصطناعي (${action})...`);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: promptInstruction }] }],
      config: {
        // 💡 2. رفع الـ Temperature إلى 0.85 يجبر الـ AI على التفكير في صياغات جديدة تماماً في كل مرة تطلب منه المعالجة
        temperature: 0.85,
      },
    });

    // إزالة أي فراغات زائدة في بداية أو نهاية النص المسترجع
    const cleanText = response.text.trim();

    res.json({ success: true, data: cleanText });
  } catch (error) {
    console.error("AI Compose Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل مساعد الذكاء الاصطناعي في صياغة النص",
    });
  }
};

exports.getAutoContacts = async (req, res) => {
  try {
    const sentMessages = await prisma.emailMessage.findMany({
      where: { isSent: true },
      select: { to: true },
      distinct: ["to"],
    });

    const contactsSet = new Set();
    sentMessages.forEach((msg) => {
      if (msg.to) {
        const emails = msg.to.split(",").map((e) => e.trim());
        emails.forEach((e) => {
          if (e.includes("@")) {
            contactsSet.add(e);
          }
        });
      }
    });

    const contactsList = Array.from(contactsSet).map((email) => {
      const name = email.split("@")[0];
      return { name, email };
    });

    res.json({ success: true, data: contactsList });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.analyzeEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, body, text, from, date } = req.body;

    let message = await prisma.emailMessage.findFirst({
      where: { OR: [{ id: id }, { messageId: id }] },
    });

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

    const textToAnalyze = `Subject: ${message.subject}\n\nBody:\n${message.body || message.text}`;

    const promptInstruction = `
    أنت نظام تحليل نصوص حكومي سعودي (منصة بلدي).
    اقرأ الرسالة التالية بعناية، واستخرج منها البيانات التالية بدقة باللغة العربية:
    رقم الطلب، سنة الطلب، رقم الخدمة، سنة الخدمة، اسم المالك (إن وجد)، نوع الخدمة، الإفادة (أي محتوى الرد أو الملاحظة)، اسم الجهة المصدرة، وقت الإطلاع (إذا تم ذكره صراحة)، والقطاع (مثل: قطاع وسط الرياض).
    
    قم بإرجاع كائن JSON حصرياً بالصيغة التالية (بدون أي نص إضافي أو Markdown):
    {
      "reqNumber": "القيمة أو null", "reqYear": "القيمة أو null", "serviceNumber": "القيمة أو null",
      "serviceYear": "القيمة أو null", "ownerName": "القيمة أو null", "serviceType": "القيمة أو null",
      "replyText": "القيمة أو null", "entityName": "القيمة أو null", "viewTime": "القيمة أو null", "sectorName": "القيمة أو null"
    }`;

    console.log(`🤖 جاري تحليل الرسالة [${id}]...`);
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: promptInstruction }] }],
      config: { temperature: 0.0, responseMimeType: "application/json" },
    });

    const cleanJson = response.text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const parsedData = JSON.parse(cleanJson);
    const validatedData = EmailAISchema.parse(parsedData);

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

    const updatedMessage = await prisma.emailMessage.update({
      where: { id: message.id },
      data: {
        isAnalyzed: true,
        ...validatedData,
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

exports.getAccounts = async (req, res) => {
  try {
    const accounts = await prisma.emailAccount.findMany();
    res.json({ success: true, data: accounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addAccount = async (req, res) => {
  try {
    const { accountName, email, password } = req.body;
    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    try {
      await transporter.verify();
    } catch (verifyError) {
      return res
        .status(401)
        .json({ success: false, message: "فشل التحقق من البريد أو الخادم." });
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
        smtpPort: 465,
        useSSL: true,
      },
    });

    res.json({ success: true, data: account });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { accountName, email, password, imapServer, imapPort, smtpServer } =
      req.body;

    const existingAccount = await prisma.emailAccount.findUnique({
      where: { id },
    });
    if (!existingAccount)
      return res
        .status(404)
        .json({ success: false, message: "الحساب غير موجود" });

    const passToVerify = password || existingAccount.password;
    const emailToVerify = email || existingAccount.email;

    const transporter = nodemailer.createTransport({
      host: smtpServer || existingAccount.smtpServer,
      port: 465,
      secure: true,
      auth: { user: emailToVerify, pass: passToVerify },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    try {
      await transporter.verify();
    } catch (verifyError) {
      return res
        .status(401)
        .json({ success: false, message: "فشل التحقق من الإعدادات الجديدة." });
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
        smtpPort: 465,
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

exports.deleteAccount = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.emailAccount.delete({ where: { id } });
    res.json({ success: true, message: "تم حذف الحساب بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

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

// =========================================================
// 🚀 إرسال الرسالة (تم دعم التوقيع الديناميكي، CC، و BCC)
// =========================================================
exports.sendMessage = async (req, res) => {
  try {
    // 💡 نستقبل draftId لمعرفة ما إذا كانت هذه الرسالة مسودة سابقة أم لا
    const {
      draftId,
      accountId,
      to,
      cc,
      bcc,
      subject,
      body,
      signature,
      footer,
      html,
      attachments = [],
    } = req.body;

    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
    });
    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "الحساب غير موجود" });

    const transporter = nodemailer.createTransport({
      host: account.smtpServer,
      port: 465,
      secure: true,
      auth: { user: account.username, pass: account.password },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 15000,
    });

    let finalHtml = html;
    if (!finalHtml) {
      const formattedBody = body ? body.replace(/\n/g, "<br/>") : "";
      finalHtml = `
      <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 16px; color: #111; line-height: 1.8; text-align: right; max-width: 800px; padding: 20px;">
        <div style="min-height: 100px;">
          ${formattedBody}
        </div>
        ${signature ? `<div style="margin-top: 30px; border-top: 1px solid #ddd; padding-top: 20px;">${signature}</div>` : ""}
        ${footer ? `<div style="margin-top: 10px; font-size: 11px; color: #444; text-align: center;">${footer}</div>` : ""}
      </div>
      `;
    }

    const mailOptions = {
      from: `"${account.accountName}" <${account.email}>`,
      to,
      cc,
      bcc,
      subject,
      text: body,
      html: finalHtml,
      attachments: attachments,
    };

    const info = await transporter.sendMail(mailOptions);

    const sentMessage = await prisma.emailMessage.create({
      data: {
        messageId: info.messageId || Date.now().toString(),
        accountId: account.id,
        from: account.email,
        to,
        cc,
        bcc,
        subject,
        body: body,
        date: new Date(),
        isSent: true,
        isRead: true,
      },
    });

    // 💡 🚀 إذا كانت الرسالة عبارة عن مسودة، قم بحذف المسودة الأصلية من الداتابيز لتنظيف الشاشة
    if (draftId) {
      await prisma.emailMessage
        .delete({ where: { id: draftId } })
        .catch(() => {});
    }

    res.json({ success: true, data: sentMessage });
  } catch (error) {
    console.error("❌ Send Email Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل الإرسال: " + error.message });
  }
};

// =========================================================
// 🚀 حفظ رسالة كمسودة (Draft)
// =========================================================
exports.saveDraft = async (req, res) => {
  try {
    const {
      accountId,
      to,
      cc,
      bcc,
      subject,
      body,
      signature,
      footerText,
      footerColor,
      footerSize,
    } = req.body;

    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
    });
    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "الحساب غير موجود" });

    const draftMessage = await prisma.emailMessage.create({
      data: {
        messageId: `draft-${Date.now()}`,
        accountId: account.id,
        from: account.email,
        to: to || "",
        cc: cc || "",
        bcc: bcc || "",
        subject: subject || "(مسودة بدون موضوع)",
        body: body || "",
        signature: signature, // 👈 إضافة التوقيع
        footerText: footerText, // 👈 إضافة نص الفوتر
        footerColor: footerColor, // 👈 إضافة لون الفوتر
        footerSize: footerSize, // 👈 إضافة حجم الفوتر
        date: new Date(),
        isSent: false,
        isRead: true,
        isDraft: true,
      },
    });

    res.json({
      success: true,
      data: draftMessage,
      message: "تم حفظ المسودة بنجاح",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================
// 🚀 تحديث حالة رسالة أو حفظ مسودة
// =========================================================
exports.updateMessageStatus = async (req, res) => {
  try {
    const { id } = req.params;

    // 💡 تنظيف البيانات: استبعاد الحقول التي لا يعرفها Prisma مثل attachments و signature
    const {
      id: bodyId,
      attachments,
      signature,
      footer,
      html,
      ...safeUpdateData
    } = req.body;

    // إذا تم إرسال مرفقات، قم بتحديث حقل hasAttachments
    if (attachments && Array.isArray(attachments)) {
      safeUpdateData.hasAttachments = attachments.length > 0;
    }

    const existingMessage = await prisma.emailMessage.findFirst({
      where: { OR: [{ id: id }, { messageId: id }] },
    });

    if (existingMessage) {
      const updatedMessage = await prisma.emailMessage.update({
        where: { id: existingMessage.id },
        data: safeUpdateData, // إرسال البيانات النظيفة فقط
      });
      return res.json({ success: true, data: updatedMessage });
    } else {
      // إنشاء "سجل ظل"
      const account = await prisma.emailAccount.findFirst({
        where: { isActive: true },
      });
      if (!account) throw new Error("لا يوجد حساب بريد نشط");

      const shadowMessage = await prisma.emailMessage.create({
        data: {
          messageId: id.toString(),
          accountId: account.id,
          from: req.body.from || "مجهول",
          to: account.email,
          subject: req.body.subject || "رسالة واردة",
          body: "تم إنشاء هذا السجل لحفظ حالة الرسالة",
          date: new Date(),
          ...safeUpdateData,
        },
      });
      return res.json({ success: true, data: shadowMessage });
    }
  } catch (error) {
    console.error("Update Message Status Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================
// 🚀 دالة الذكاء الاصطناعي المخصصة للترجمة الاحترافية
// =========================================================
exports.translateWithAI = async (req, res) => {
  try {
    const { text, targetLanguage = "English" } = req.body;

    if (!text || text.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "يجب إرسال النص المطلوب ترجمته" });
    }

    // تعليمات صارمة للترجمة الدقيقة والرسمية
    const promptInstruction = `
    أنت مترجم محترف وخبير في الصياغات القانونية والرسمية للشركات والمكاتب الهندسية.
    قم بترجمة النص التالي إلى اللغة ${targetLanguage} بدقة شديدة واحترافية.
    
    تعليمات صارمة:
    1. أعد فقط النص المترجم.
    2. لا تضف أي مقدمات، ملاحظات، أو أقواس.
    3. حافظ على المعنى القانوني والرسمي للنص.

    النص:
    ${text}
    `;

    console.log(`🤖 جاري الترجمة إلى ${targetLanguage}...`);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: promptInstruction }] }],
      config: {
        temperature: 0.2, // 💡 درجة حرارة منخفضة جداً لضمان دقة الترجمة ومنع التأليف
      },
    });

    const translatedText = response.text.trim();

    res.json({ success: true, data: translatedText });
  } catch (error) {
    console.error("AI Translation Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل مساعد الذكاء الاصطناعي في الترجمة",
    });
  }
};

exports.deleteMessagePermanently = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await prisma.emailMessage.findFirst({
      where: { OR: [{ id: id }, { messageId: id }] },
    });

    if (!message)
      return res
        .status(404)
        .json({ success: false, message: "الرسالة غير موجودة" });

    await prisma.emailMessage.delete({ where: { id: message.id } });
    res.json({ success: true, message: "تم الحذف النهائي بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================
// 🚀 جلب الرسائل وحفظها فوراً مع تشغيل التحليل في الخلفية
// =========================================================
exports.syncHostingerEmails = async (req, res) => {
  let client; // تعريف العميل خارج النطاق لاستخدامه في الإغلاق
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const account = await prisma.emailAccount.findFirst({
      where: { isActive: true },
    });
    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "لا يوجد حساب بريد مربوط" });

    client = new ImapFlow({
      host: account.imapServer || "imap.hostinger.com",
      port: account.imapPort || 993,
      secure: true,
      auth: { user: account.email, pass: account.password },
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
        return res.json({ success: true, data: [] });
      }

      const fetchEnd = totalMessages - (page - 1) * limit;
      const fetchStart = Math.max(1, totalMessages - page * limit + 1);

      if (fetchEnd < 1) {
        lock.release();
        await client.logout();
        return res.json({ success: true, data: [] });
      }

      console.log(
        `⏳ جاري مزامنة الرسائل... النطاق: ${fetchStart}:${fetchEnd}`,
      );

      for await (let msg of client.fetch(
        `${fetchStart}:${fetchEnd}`,
        { source: true, envelope: true, flags: true, uid: true },
        { reverse: true },
      )) {
        const msgIdStr = msg.uid.toString();

        // 1. التحقق السريع في قاعدة البيانات
        let dbMessage = await prisma.emailMessage.findUnique({
          where: { messageId: msgIdStr },
        });

        // 2. إذا لم تكن موجودة، احفظها فوراً واعرضها
        if (!dbMessage) {
          const parsed = await simpleParser(msg.source);
          const subject = parsed.subject || "(بدون عنوان)";
          const bodyText = parsed.text || "";

          dbMessage = await prisma.emailMessage.create({
            data: {
              messageId: msgIdStr,
              accountId: account.id,
              subject: subject,
              from:
                parsed.from?.value[0]?.address || parsed.from?.text || "مجهول",
              to: account.email,
              body: bodyText,
              html: parsed.html || parsed.textAsHtml || "",
              date: parsed.date,
              isRead: msg.flags?.has("\\Seen") || false,
              isAnalyzed: false, // لم تُحلل بعد
            },
          });

          // 💡 سر الحل: تشغيل دالة التحليل في الخلفية "بدون await"
          // هذا يسمح للسيرفر بإكمال الرد للمستخدم بينما الذكاء الاصطناعي يعمل في صمت
          analyzeInBackground(dbMessage.id, subject, bodyText);
        }

        messages.push(dbMessage);
      }
    } finally {
      if (lock) lock.release();
    }

    await client.logout();
    // إرجاع النتيجة فوراً
    res.json({ success: true, data: messages });
  } catch (error) {
    if (client) await client.logout();
    console.error("IMAP Error:", error);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء المزامنة" });
  }
};

// =========================================================
// 🤖 دالة التحليل في الخلفية (Background AI Worker)
// =========================================================
async function analyzeInBackground(dbId, subject, body) {
  try {
    console.log(`✨ بدء تحليل الرسالة [${dbId}] في الخلفية...`);

    const textToAnalyze = `Subject: ${subject}\n\nBody:\n${body.substring(0, 1500)}`;
    const promptInstruction = `أنت نظام تحليل نصوص حكومي سعودي. استخرج البيانات بصيغة JSON:\n{ "reqNumber": null, "reqYear": null, "serviceNumber": null, "serviceYear": null, "ownerName": null, "serviceType": null, "replyText": null, "entityName": null, "viewTime": null, "sectorName": null }\nالنص:\n${textToAnalyze}`;

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: promptInstruction }] }],
      config: { temperature: 0.0, responseMimeType: "application/json" },
    });

    const cleanJson = aiResponse.text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const validatedData = EmailAISchema.parse(JSON.parse(cleanJson));

    // تحديث قاعدة البيانات بالتحليل
    await prisma.emailMessage.update({
      where: { id: dbId },
      data: {
        isAnalyzed: true,
        ...validatedData,
      },
    });
    console.log(`✅ انتهى تحليل الرسالة [${dbId}] بنجاح.`);
  } catch (err) {
    console.error(`❌ خطأ في تحليل الرسالة الخلفي [${dbId}]:`, err.message);
  }
}

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
    if (!serviceNumber && !reqNumber)
      return res.json({ success: true, data: [] });

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

const { ImapFlow } = require("imapflow");
const simpleParser = require("mailparser").simpleParser;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
// 🚀 استدعاء الطابور المخصص للإيميلات
const { emailAiQueue } = require("../queue/aiQueue");

class ImapListenerService {
  constructor() {
    this.clients = new Map();
  }

  async startAllListeners() {
    const accounts = await prisma.emailAccount.findMany({
      where: { isActive: true },
    });
    for (const account of accounts) {
      await this.initListener(account);
    }
  }

  async initListener(account) {
    if (this.clients.has(account.id)) {
      await this.clients.get(account.id).logout();
    }

    const client = new ImapFlow({
      host: account.imapServer || "imap.hostinger.com",
      port: account.imapPort || 993,
      secure: true,
      auth: { user: account.email, pass: account.password },
      logger: false,
    });

    this.clients.set(account.id, client);

    try {
      await client.connect();
      let lock = await client.getMailboxLock("INBOX");
      console.log(
        `🎧 [IMAP Listener] متصل ويستمع للإيميلات على: ${account.email}`,
      );

      // 🚀 إصلاح: جلب الرسائل التي وصلت أثناء توقف السيرفر فوراً
      console.log(`🔄 [IMAP Listener] التحقق من أي رسائل فائتة...`);
      await this.fetchNewEmails(client, account, lock);

      client.on("exists", async (data) => {
        console.log(`📥 [IMAP Listener] إيميل جديد وصل! جاري المعالجة...`);
        await this.fetchNewEmails(client, account, lock);
      });
    } catch (err) {
      console.error(
        `❌ [IMAP Listener] خطأ في حساب ${account.email}:`,
        err.message,
      );
      setTimeout(() => this.initListener(account), 30000);
    }
  }

  async fetchNewEmails(client, account, lock) {
    try {
      // 🚀 إصلاح الفرز: سحب آخر 100 رسالة وترتيبها كأرقام في الذاكرة لتجنب مشكلة فرز النصوص في SQL
      const lastMessages = await prisma.emailMessage.findMany({
        where: { accountId: account.id, isSent: false, isDraft: false },
        take: 100,
      });

      let highestUid = 1;
      if (lastMessages.length > 0) {
        const uids = lastMessages
          .map((m) => parseInt(m.messageId))
          .filter((id) => !isNaN(id));
        if (uids.length > 0) highestUid = Math.max(...uids);
      }

      const fetchQuery = `${highestUid + 1}:*`;

      for await (let msg of client.fetch(fetchQuery, {
        source: true,
        flags: true,
        uid: true,
      })) {
        const msgIdStr = msg.uid.toString();

        const exists = await prisma.emailMessage.findUnique({
          where: { messageId: msgIdStr },
        });
        if (!exists) {
          const parsed = await simpleParser(msg.source);
          const bodyText = parsed.text || "";

          const dbMessage = await prisma.emailMessage.create({
            data: {
              messageId: msgIdStr,
              accountId: account.id,
              subject: parsed.subject || "(بدون عنوان)",
              from:
                parsed.from?.value[0]?.address || parsed.from?.text || "مجهول",
              to: account.email,
              body: bodyText,
              html: parsed.html || parsed.textAsHtml || "",
              date: parsed.date || new Date(),
              isRead: msg.flags?.has("\\Seen") || false,
              isAnalyzed: false,
            },
          });

          console.log(`💾 تم حفظ رسالة جديدة: ${dbMessage.subject}`);

          // 🚀 إضافة المهمة للطابور الصحيح الخاص بالإيميلات
          try {
            await emailAiQueue.add("analyze-email", {
              dbId: dbMessage.id,
              subject: dbMessage.subject,
              body: bodyText,
            });
            console.log(`📬 تم الإرسال للتحليل التلقائي بنجاح`);
          } catch (queueErr) {
            console.error(`⚠️ خطأ في الإرسال للطابور:`, queueErr);
          }
        }
      }
    } catch (err) {
      console.error("Fetch Emails Error:", err);
    }
  }
}

module.exports = new ImapListenerService();

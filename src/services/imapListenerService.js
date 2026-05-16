const { ImapFlow } = require('imapflow');
const simpleParser = require('mailparser').simpleParser;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { aiQueue } = require('../queue/aiQueue');

class ImapListenerService {
  constructor() {
    this.clients = new Map(); // لحفظ اتصالات الحسابات المختلفة
  }

  // تشغيل الخدمة لكل الحسابات النشطة
  async startAllListeners() {
    const accounts = await prisma.emailAccount.findMany({ where: { isActive: true } });
    for (const account of accounts) {
      await this.initListener(account);
    }
  }

  // تهيئة الاستماع لحساب معين
  async initListener(account) {
    if (this.clients.has(account.id)) {
      await this.clients.get(account.id).logout();
    }

    const client = new ImapFlow({
      host: account.imapServer || 'imap.hostinger.com',
      port: account.imapPort || 993,
      secure: true,
      auth: { user: account.email, pass: account.password },
      logger: false, // 💡 إغلاق اللوجز لتخفيف العبء على السيرفر
    });

    this.clients.set(account.id, client);

    try {
      await client.connect();
      let lock = await client.getMailboxLock('INBOX');
      console.log(`🎧 [IMAP Listener] متصل ويستمع للإيميلات على: ${account.email}`);

      // 💡 تقنية IDLE: السيرفر يبلغنا فور وصول إيميل جديد!
      client.on('exists', async (data) => {
        console.log(`📥 [IMAP Listener] إيميل جديد وصل! جاري المعالجة...`);
        await this.fetchNewEmails(client, account, lock);
      });

    } catch (err) {
      console.error(`❌ [IMAP Listener] خطأ في حساب ${account.email}:`, err.message);
      // إعادة المحاولة بعد 30 ثانية في حالة انقطاع الإنترنت
      setTimeout(() => this.initListener(account), 30000);
    }
  }

  // دالة جلب الإيميلات الجديدة فقط وحفظها
  async fetchNewEmails(client, account, lock) {
    try {
      // معرفة آخر إيميل محفوظ لدينا
      const lastMsg = await prisma.emailMessage.findFirst({
        where: { accountId: account.id, isSent: false, isDraft: false },
        orderBy: { messageId: 'desc' }
      });

      const highestUid = lastMsg && !isNaN(lastMsg.messageId) ? parseInt(lastMsg.messageId) : 1;
      const fetchQuery = `${highestUid + 1}:*`;

      for await (let msg of client.fetch(fetchQuery, { source: true, flags: true, uid: true })) {
        const msgIdStr = msg.uid.toString();

        const exists = await prisma.emailMessage.findUnique({ where: { messageId: msgIdStr } });
        if (!exists) {
          const parsed = await simpleParser(msg.source);
          const bodyText = parsed.text || "";
          
          // حفظ الإيميل في الداتا بيز
          const dbMessage = await prisma.emailMessage.create({
            data: {
              messageId: msgIdStr,
              accountId: account.id,
              subject: parsed.subject || "(بدون عنوان)",
              from: parsed.from?.value[0]?.address || parsed.from?.text || "مجهول",
              to: account.email,
              body: bodyText,
              html: parsed.html || parsed.textAsHtml || "",
              date: parsed.date,
              isRead: msg.flags?.has("\\Seen") || false,
              isAnalyzed: false,
            },
          });

          console.log(`💾 تم حفظ رسالة جديدة: ${dbMessage.subject}`);

          // 💡 إرسال المهمة للذكاء الاصطناعي لتحليلها في الخلفية
          await aiQueue.add("analyze-email", {
            dbId: dbMessage.id,
            subject: dbMessage.subject,
            body: bodyText
          });

          // 💡 هنا يمكنك استدعاء Socket.io لإبلاغ الفرونت إند أن هناك رسالة جديدة
          // global.io.emit('new_email_arrived');
        }
      }
    } catch (err) {
      console.error("Fetch Emails Error:", err);
    }
  }
}

module.exports = new ImapListenerService();
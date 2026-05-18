const { Worker } = require("bullmq");
const { PrismaClient } = require("@prisma/client");
const { GoogleGenAI } = require("@google/genai");
const { z } = require("zod");

const { connection } = require("./aiQueue");

const prisma = new PrismaClient();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

console.log("👷‍♂️ [AI Email Worker] جاهز للعمل على طابور الإيميلات المستقل...");

// 🚀 تغيير اسم الطابور هنا ليكون مستقلاً
const aiEmailWorker = new Worker(
  "EMAIL_AI_QUEUE",
  async (job) => {
    if (job.name === "analyze-email") {
      const { dbId, subject, body } = job.data;
      console.log(`🤖 [Worker] جاري تحليل الرسالة [${dbId}]...`);

      try {
        const textToAnalyze = `Subject: ${subject}\n\nBody:\n${body.substring(0, 1500)}`;
        const promptInstruction = `
        أنت نظام تحليل نصوص حكومي سعودي (منصة بلدي).
        اقرأ الرسالة التالية، واستخرج البيانات بدقة بصيغة JSON حصرياً بدون Markdown:
        {
          "reqNumber": "القيمة أو null", "reqYear": "القيمة أو null", "serviceNumber": "القيمة أو null",
          "serviceYear": "القيمة أو null", "ownerName": "القيمة أو null", "serviceType": "القيمة أو null",
          "replyText": "القيمة أو null", "entityName": "القيمة أو null", "viewTime": "القيمة أو null", "sectorName": "القيمة أو null"
        }
        النص:\n${textToAnalyze}`;

        const aiResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: promptInstruction }] }],
          config: { temperature: 0.0, responseMimeType: "application/json" },
        });

        const cleanJson = aiResponse.text
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

        await prisma.emailMessage.update({
          where: { id: dbId },
          data: {
            isAnalyzed: true,
            ...validatedData,
            linkedTxId: linkedTxId,
            matchConfidence: matchConfidence,
          },
        });

        console.log(`✅ [Worker] تمت عملية التحليل بنجاح للرسالة [${dbId}]`);
      } catch (err) {
        console.error(
          `❌ [Worker] خطأ في تحليل الرسالة [${dbId}]:`,
          err.message,
        );
        throw err;
      }
    }
  },
  { connection, concurrency: 2 },
);

module.exports = aiEmailWorker;

// ملف: src/queue/aiWorker.js
const { Worker } = require("bullmq");
const { connection } = require("./aiQueue");
const { PrismaClient } = require("@prisma/client");
const {
  createSystemNotification,
} = require("../controllers/notificationController");

// 💡 استيراد خدمات الذكاء الاصطناعي المختلفة (Services)
const archiveAiService = require("../services/archiveAiService");
const permitAiService = require("../services/permitAiService");
const referenceAiService = require("../services/referenceAiService");
const aiDeviceService = require("../services/aiDeviceService");
const contractAiService = require("../services/contractAiService");
const docArchiveAiService = require("../services/docArchiveAiService");

const prisma = new PrismaClient();

// ========================================================
// 🛡️ 1. دالة الإيقاف الإجباري (Timeout Wrapper)
// ========================================================
// تمنع أي خدمة من التعليق للأبد إذا لم يرد خادم الذكاء الاصطناعي (مثل OpenAI)
const withTimeout = (promise, ms = 600000) => {
  // افتراضي: 10 دقائق كحد أقصى (600,000 ملي ثانية)
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `نفد الوقت المحدد للمهمة (${ms / 1000} ثانية) - Timeout Error`,
        ),
      );
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timeoutId),
  );
};

const aiWorker = new Worker(
  "AI_PROCESSING_QUEUE",
  async (job) => {
    const { jobType, dbJobId, employeeId } = job.data;

    console.log(
      `[AI Worker Hub] 🧠 استلام مهمة جديدة: ${jobType} (Job ID: ${job.id})`,
    );

    // دالة ديناميكية لتحديث نسبة الإنجاز في الداتا بيز وفي الطابور
    const updateProgress = async (progressValue) => {
      await job.updateProgress(progressValue);
      await prisma.aiJob.update({
        where: { id: dbJobId },
        data: { progress: progressValue },
      });
    };

    // تحديث الحالة للبدء
    await prisma.aiJob.update({
      where: { id: dbJobId },
      data: { status: "PROCESSING", startedAt: new Date(), progress: 5 },
    });

    try {
      let result = null;
      const JOB_TIMEOUT = 10 * 60 * 1000; // 10 دقائق حد أقصى للعملية الواحدة

      // ========================================================
      // 💡 2. التوجيه الذكي (Routing) مع حماية الـ Timeout
      // ========================================================
      switch (jobType) {
        case "ANALYZE_ARCHIVE":
        case "REANALYZE_ARCHIVE":
        case "MERGE_AND_ANALYZE":
        case "UPLOAD_AND_ANALYZE":
          result = await withTimeout(
            archiveAiService.processArchiveJob(job.data, updateProgress),
            JOB_TIMEOUT,
          );
          break;

        case "ANALYZE_PERMIT":
          result = await withTimeout(
            permitAiService.processPermitJob(job.data, updateProgress),
            JOB_TIMEOUT,
          );
          break;

        case "ASSESS_CONTRACT_RISKS":
          result = await withTimeout(
            contractAiService.processRiskAssessment(job.data, updateProgress),
            JOB_TIMEOUT,
          );
          break;

        case "GENERATE_CONTRACT_SUMMARY":
          result = await withTimeout(
            contractAiService.processContractSummary(job.data, updateProgress),
            JOB_TIMEOUT,
          );
          break;

        case "ANALYZE_REFERENCE":
          result = await withTimeout(
            referenceAiService.processReferenceJob(job.data, updateProgress),
            JOB_TIMEOUT,
          );
          break;

        case "EXTRACT_DEVICE_SPECS":
          result = await withTimeout(
            aiDeviceService.processDeviceImageJob(job.data, updateProgress),
            JOB_TIMEOUT,
          );
          break;

        case "ANALYZE_DEED_ARCHIVE":
          result = await withTimeout(
            docArchiveAiService.processArchiveDoc(job.data, updateProgress),
            JOB_TIMEOUT,
          );
          break;

        default:
          throw new Error(`نوع المهمة غير معروف: ${jobType}`);
      }

      // ========================================================
      // 3. إنهاء المهمة بنجاح
      // ========================================================
      await updateProgress(100);

      await prisma.aiJob.update({
        where: { id: dbJobId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          result: JSON.stringify(result),
        },
      });

      await updateDailyStats(true);

      if (employeeId) {
        await createSystemNotification(
          employeeId,
          "اكتملت المهمة 🧠",
          `تمت عملية ${jobType} بنجاح.`,
          "success",
        );
      }

      console.log(`[AI Worker Hub] ✅ اكتملت مهمة ${jobType} بنجاح.`);
      return result;
    } catch (error) {
      console.error(`[AI Worker Hub] 🔥 فشل مهمة ${jobType}:`, error);

      await prisma.aiJob.update({
        where: { id: dbJobId },
        data: {
          status: "FAILED",
          errorMessage: error.message,
          completedAt: new Date(),
        },
      });

      await updateDailyStats(false);

      if (employeeId) {
        await createSystemNotification(
          employeeId,
          "خطأ في الذكاء الاصطناعي ⚠️",
          `فشلت مهمة ${jobType}: ${error.message}`,
          "error",
        );
      }

      throw error;
    }
  },
  {
    connection,
    concurrency: 3,
  },
);

// ============================================================================
// 💡 نظام المراقبة الديناميكي: فحص وتحديث عدد العمليات المتزامنة كل 10 ثوانٍ
// ============================================================================
setInterval(async () => {
  try {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 1 },
    });
    const newConcurrency = settings?.aiConcurrency || 1;

    if (aiWorker.concurrency !== newConcurrency) {
      aiWorker.concurrency = newConcurrency;
      console.log(
        `[AI Worker Hub] ⚙️ تم تغيير قدرة السيرفر إلى: استيعاب (${newConcurrency}) مشاريع معاً.`,
      );
    }
  } catch (error) {
    // تجاهل الأخطاء الصامتة
  }
}, 10000);

// ============================================================================
// 🧹 4. مُنظف المهام الزومبي (Zombie Jobs Sweeper) - يعمل كل ساعة
// ============================================================================
setInterval(
  async () => {
    try {
      const timeoutThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000); // مهام بدأت منذ أكثر من ساعتين

      const stuckJobs = await prisma.aiJob.updateMany({
        where: {
          status: "PROCESSING",
          startedAt: {
            lt: timeoutThreshold,
          },
        },
        data: {
          status: "FAILED",
          errorMessage:
            "توقفت المهمة لفترة طويلة جداً (Timeout Error) وتم إلغاؤها أوتوماتيكياً بواسطة المنظف.",
          completedAt: new Date(),
        },
      });

      if (stuckJobs.count > 0) {
        console.log(
          `🧹 [Zombie Sweeper] تم تنظيف وإغلاق ${stuckJobs.count} مهام عالقة في الداتا بيز.`,
        );
      }
    } catch (error) {
      console.error("⚠️ [Zombie Sweeper] خطأ في منظف المهام:", error.message);
    }
  },
  60 * 60 * 1000,
); // 60 دقيقة * 60 ثانية * 1000 ملي ثانية

// دالة تحديث الإحصائيات
async function updateDailyStats(isSuccess) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.aiDailyStat.upsert({
    where: { date: today },
    update: {
      totalJobs: { increment: 1 },
      successJobs: isSuccess ? { increment: 1 } : undefined,
      failedJobs: !isSuccess ? { increment: 1 } : undefined,
    },
    create: {
      date: today,
      totalJobs: 1,
      successJobs: isSuccess ? 1 : 0,
      failedJobs: !isSuccess ? 1 : 0,
    },
  });
}

// ============================================================================
// 🛑 5. أحداث الطابور والإغلاق الآمن (Graceful Shutdown & Stalled)
// ============================================================================

aiWorker.on("completed", (job) =>
  console.log(`🎉 [BullMQ] Job ${job.id} completed.`),
);
aiWorker.on("failed", (job, err) =>
  console.log(`❌ [BullMQ] Job ${job.id} failed: ${err.message}`),
);

// التقاط المهام التي انقطع الاتصال بها فجأة
aiWorker.on("stalled", async (jobId) => {
  console.warn(
    `⚠️ [BullMQ] Job ${jobId} has stalled! (ربما بسبب إعادة تشغيل السيرفر أو انقطاع الاتصال)`,
  );
});

// الإغلاق الآمن للـ Worker عند عمل Restart للسيرفر أو إغلاقه
const gracefulShutdown = async (signal) => {
  console.log(
    `\n🛑 [AI Worker Hub] تلقي إشارة ${signal}، جاري إغلاق الطابور بأمان لعدم ضياع المهام...`,
  );
  await aiWorker.close(); // يمنع استلام مهام جديدة وينتظر الحالية لتنتهي إن أمكن
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

module.exports = aiWorker;

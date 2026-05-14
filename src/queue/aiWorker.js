// ملف: src/queue/aiWorker.js
const { Worker } = require('bullmq');
const { connection } = require('./aiQueue');
const { PrismaClient } = require('@prisma/client');
const { createSystemNotification } = require("../controllers/notificationController");

// 💡 استيراد خدمات الذكاء الاصطناعي المختلفة (Services)
const archiveAiService = require('../services/archiveAiService');
const permitAiService = require('../services/permitAiService'); // 👈 1. تمت إضافة خدمة الرخص هنا
const referenceAiService = require('../services/referenceAiService');
const aiDeviceService = require('../services/aiDeviceService');
const contractAiService = require('../services/contractAiService');


const prisma = new PrismaClient();

const aiWorker = new Worker('AI_PROCESSING_QUEUE', async (job) => {
  const { jobType, dbJobId, employeeId } = job.data;

  console.log(`[AI Worker Hub] 🧠 استلام مهمة جديدة: ${jobType} (Job ID: ${job.id})`);

  // 1. دالة ديناميكية لتحديث نسبة الإنجاز في الداتا بيز وفي الطابور
  const updateProgress = async (progressValue) => {
    await job.updateProgress(progressValue);
    await prisma.aiJob.update({
      where: { id: dbJobId },
      data: { progress: progressValue }
    });
  };

  // 2. تحديث الحالة للبدء
  await prisma.aiJob.update({
    where: { id: dbJobId },
    data: { status: 'PROCESSING', startedAt: new Date(), progress: 5 }
  });

  try {
    let result = null;

    // ========================================================
    // 💡 3. التوجيه الذكي (Routing) بناءً على نوع المهمة
    // ========================================================
    switch (jobType) {
      
      // أ) مهام الأرشيف الهندسي
      case 'ANALYZE_ARCHIVE':
      case 'REANALYZE_ARCHIVE':
      case 'MERGE_AND_ANALYZE':
      case 'UPLOAD_AND_ANALYZE':
        result = await archiveAiService.processArchiveJob(job.data, updateProgress);
        break;

      // 👈 2. تمت إضافة مسار تحليل رخص البناء هنا
      case 'ANALYZE_PERMIT':
        result = await permitAiService.processPermitJob(job.data, updateProgress);
        break;

      case 'ASSESS_CONTRACT_RISKS':
        result = await contractAiService.processRiskAssessment(job.data, updateProgress);
        break;

      case 'GENERATE_CONTRACT_SUMMARY':
        result = await contractAiService.processContractSummary(job.data, updateProgress);
        break;

      case "ANALYZE_REFERENCE":
          result = await referenceAiService.processReferenceJob(
            job.data,
            updateProgress
          );
          break;

      case 'EXTRACT_DEVICE_SPECS': // 👈 إضافة هذه الحالة
        result = await aiDeviceService.processDeviceImageJob(job.data, updateProgress);
        break;

      default:
        throw new Error(`نوع المهمة غير معروف: ${jobType}`);
    }

    // ========================================================
    // 4. إنهاء المهمة بنجاح
    // ========================================================
    await updateProgress(100);
    
    await prisma.aiJob.update({
      where: { id: dbJobId },
      data: { status: 'COMPLETED', completedAt: new Date() }
    });

    await updateDailyStats(true);

    if (employeeId) {
      await createSystemNotification(employeeId, "اكتملت المهمة 🧠", `تمت عملية ${jobType} بنجاح.`, "success");
    }

    console.log(`[AI Worker Hub] ✅ اكتملت مهمة ${jobType} بنجاح.`);
    return result;

  } catch (error) {
    console.error(`[AI Worker Hub] 🔥 فشل مهمة ${jobType}:`, error);
    
    await prisma.aiJob.update({
      where: { id: dbJobId },
      data: { status: 'FAILED', errorMessage: error.message, completedAt: new Date() }
    });

    await updateDailyStats(false);

    if (employeeId) {
      await createSystemNotification(employeeId, "خطأ في الذكاء الاصطناعي ⚠️", `فشلت مهمة ${jobType}: ${error.message}`, "error");
    }

    throw error; 
  }
}, { 
  connection,
  concurrency: 3 // معالجة مهمتين كحد أقصى في نفس الوقت عبر السيرفر بالكامل
});

// ============================================================================
// 💡 نظام المراقبة الديناميكي: فحص وتحديث عدد العمليات المتزامنة كل 10 ثوانٍ
// ============================================================================
setInterval(async () => {
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    const newConcurrency = settings?.aiConcurrency || 1;
    
    // إذا قام المدير بتغيير الرقم من الواجهة، نُحدث قدرة الطابور فوراً!
    if (aiWorker.concurrency !== newConcurrency) {
      aiWorker.concurrency = newConcurrency;
      console.log(`[AI Worker Hub] ⚙️ تم تغيير قدرة السيرفر إلى: استيعاب (${newConcurrency}) مشاريع معاً.`);
    }
  } catch (error) {
    // تجاهل الأخطاء الصامتة
  }
}, 10000);

// دالة تحديث الإحصائيات (للوحة التحكم)
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
    create: { date: today, totalJobs: 1, successJobs: isSuccess ? 1 : 0, failedJobs: !isSuccess ? 1 : 0 }
  });
}

aiWorker.on('completed', job => console.log(`🎉 [BullMQ] Job ${job.id} completed.`));
aiWorker.on('failed', (job, err) => console.log(`❌ [BullMQ] Job ${job.id} failed: ${err.message}`));

module.exports = aiWorker;
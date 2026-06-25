// ملف: src/controllers/aiDashboardController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { aiQueue } = require('../queue/aiQueue'); // 👈 1. استيراد الطابور لإرسال المهام إليه مجدداً

// =======================================================
// 📊 جلب الإحصائيات العامة (اليوم)
// =======================================================
exports.getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // إحصائيات اليوم
    const dailyStat = await prisma.aiDailyStat.findUnique({ where: { date: today } });
    
    // عدد المهام الحية في الطابور
    const pendingJobsCount = await prisma.aiJob.count({ where: { status: 'PENDING' } });
    const processingJobsCount = await prisma.aiJob.count({ where: { status: 'PROCESSING' } });
    const failedJobsCount = await prisma.aiJob.count({ where: { status: 'FAILED' } });

    res.status(200).json({
      success: true,
      data: {
        today: dailyStat || { totalJobs: 0, successJobs: 0, failedJobs: 0 },
        activeQueue: pendingJobsCount + processingJobsCount,
        pending: pendingJobsCount,
        processing: processingJobsCount,
        totalFailed: failedJobsCount
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب الإحصائيات." });
  }
};

// =======================================================
// 📋 جلب آخر 50 مهمة (سجل العمليات الحي)
// =======================================================
exports.getRecentJobs = async (req, res) => {
  try {
    const jobs = await prisma.aiJob.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        jobType: true,
        status: true,
        progress: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        result: true // 👈 🚀 هذا هو السطر الذهبي الذي يجلب النتيجة للفرونت إند
      }
    });
    res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب المهام." });
  }
};

// =======================================================
// 🔍 جلب حالة مهمة معينة
// =======================================================
exports.getJobStatus = async (req, res) => {
  try {
    const job = await prisma.aiJob.findUnique({
      where: { id: req.params.id }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: "المهمة غير موجودة" });
    }

    res.status(200).json({ success: true, data: job });
  } catch (error) {
    console.error("Error fetching job status:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// =======================================================
// 🔄 إجراء: إعادة محاولة مهمة فاشلة (Retry)
// =======================================================
exports.retryJob = async (req, res) => {
  try {
    const { id } = req.params;
    const oldJob = await prisma.aiJob.findUnique({ where: { id } });
    
    if (!oldJob) return res.status(404).json({ message: "المهمة غير موجودة" });

    // 1. إعادة المهمة إلى حالة الانتظار في الداتا بيز
    await prisma.aiJob.update({
      where: { id },
      data: { status: 'PENDING', progress: 0, errorMessage: null }
    });

    // 2. إعادة ضخ البيانات في الطابور الفعلي (BullMQ)
    // ملاحظة: إذا كان لديك بيانات إضافية مخزنة في الداتا بيز مثل projectId يمكنك تمريرها هنا
    await aiQueue.add('AI_JOB', {
      jobType: oldJob.jobType,
      dbJobId: oldJob.id,
      // تمرير أي بيانات كانت محفوظة مسبقاً (يُفضل حفظ payload المهمة وقت الإنشاء في الداتا بيز)
      targetId: oldJob.targetId || null 
    });

    res.json({ success: true, message: "تمت إعادة المهمة للطابور بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// =======================================================
// 🛑 إجراء: إيقاف وإلغاء مهمة (Cancel/Stop)
// =======================================================
exports.cancelJob = async (req, res) => {
  try {
    const { id } = req.params;
    
    // تحديث الداتا بيز لتظهر كفاشلة/ملغاة
    await prisma.aiJob.update({
      where: { id },
      data: { 
        status: 'FAILED', 
        errorMessage: 'تم إيقاف المهمة يدوياً بواسطة المشرف.',
        completedAt: new Date()
      }
    });

    // ملاحظة: الـ Worker سيكتشف أن حالتها في الداتا بيز تغيرت 
    // أو ببساطة سيتم تجاهل النتيجة، المهم أنها لن تظهر كـ "قيد المعالجة" للأبد.

    res.json({ success: true, message: "تم إيقاف المهمة بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// =======================================================
// 🗑️ إجراء: حذف مهمة نهائياً (Delete)
// =======================================================
exports.deleteJob = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.aiJob.delete({ where: { id } });
    res.json({ success: true, message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
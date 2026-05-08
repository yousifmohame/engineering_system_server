// ملف: src/controllers/aiDashboardController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// جلب الإحصائيات العامة (اليوم)
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

// جلب آخر 50 مهمة (سجل العمليات الحي)
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
        createdAt: true
      }
    });
    res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب المهام." });
  }
};
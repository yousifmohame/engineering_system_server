// [NEW FILE: controllers/dashboardController.js]
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ===============================================
// 1. جلب إحصائيات الأدوار (شاشة 903 - تاب 01)
// GET /api/dashboard/roles-stats
// ===============================================
const getRoleDashboardStats = async (req, res) => {
  try {
    // (منطق جلب البيانات الحقيقي يوضع هنا لاحقاً)
    // يمكنك استخدام:
    // const totalRoles = await prisma.jobRole.count();
    // const totalEmployees = await prisma.employee.count();
    
    // بيانات مؤقتة لإيقاف الخطأ 404
    const stats = {
      totalRoles: (await prisma.jobRole.count()) || 0,
      totalEmployees: (await prisma.employee.count()) || 0,
      totalPermissions: (await prisma.permission.count()) || 0,
      totalLevels: 5, // (أو جلبها من قاعدة البيانات)
      distribution: [
        { name: 'الإدارة', value: 15 },
        { name: 'الهندسة', value: 45 },
        { name: 'المالية', value: 20 },
        { name: 'أخرى', value: 20 },
      ],
    };
    
    res.status(200).json(stats); 
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

module.exports = {
    getRoleDashboardStats
};
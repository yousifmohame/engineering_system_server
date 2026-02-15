const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * جلب كل تصنيفات العملاء النشطة
 * GET /api/classifications/client
 */
const getClientClassifications = async (req, res) => {
  try {
    let classifications = await prisma.clientClassification.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    });
    
    // إذا كانت قاعدة البيانات فارغة، قم بإنشاء التصنيفات الافتراضية
    if (classifications.length === 0) {
      console.log("No client classifications found, creating defaults...");
      try {
        await prisma.clientClassification.createMany({
            data: [
              { name: 'VIP', color: '#f59e0b', description: 'عملاء مميزون', isActive: true },
              { name: 'مؤسسة', color: '#3b82f6', description: 'شركات ومؤسسات', isActive: true },
              { name: 'عادي', color: '#6b7280', description: 'عملاء عاديون', isActive: true },
              { name: 'حكومي', color: '#10b981', description: 'جهات حكومية', isActive: true },
              { name: 'خاص', color: '#8b5cf6', description: 'عملاء بمعاملة خاصة', isActive: true }
            ],
            skipDuplicates: true, // تجنب الأخطاء إذا تم الإنشاء
        });
      } catch (createError) {
         console.error("Failed to create default classifications:", createError);
      }
      
      // جلب البيانات مرة أخرى بعد إنشائها
      classifications = await prisma.clientClassification.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' }
      });
    }
    
    res.json(classifications);
  } catch (error) {
    console.error("Error fetching client classifications:", error);
    res.status(500).json({ error: "Error fetching client classifications" });
  }
};

module.exports = {
  getClientClassifications,
};
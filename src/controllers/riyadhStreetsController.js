const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// توليد كود الشارع تلقائياً
const generateStreetCode = async () => {
  const count = await prisma.riyadhStreet.count();
  const year = new Date().getFullYear();
  return `STR-${year}-${String(count + 1).padStart(4, '0')}`;
};

// 1. إنشاء شارع جديد
const createStreet = async (req, res) => {
  try {
    const {
      name, sectorId, districtId, type, width, length, lanes,
      status, centerLat, centerLng, lighting, sidewalks,
      hasSpecialRegulation, regulationDetails
    } = req.body;

    const streetCode = await generateStreetCode();

    const newStreet = await prisma.riyadhStreet.create({
      data: {
        streetCode,
        name,
        sectorId,
        districtId,
        type,
        width: parseFloat(width),
        length: parseFloat(length),
        lanes: parseInt(lanes),
        status,
        centerLat: parseFloat(centerLat || 24.7136),
        centerLng: parseFloat(centerLng || 46.6753),
        lighting: lighting ?? true,
        sidewalks: sidewalks ?? true,
        hasSpecialRegulation: hasSpecialRegulation ?? false,
        // تخزين تفاصيل التنظيم كـ JSON
        regulationDetails: hasSpecialRegulation ? regulationDetails : null,
      },
      include: {
        sector: true,
        district: true
      }
    });

    res.status(201).json(newStreet);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'فشل في إضافة الشارع', error: error.message });
  }
};

// 2. جلب الشوارع مع الفلترة
const getAllStreets = async (req, res) => {
  try {
    const { sectorId, type, status, search } = req.query;

    const where = {};
    if (sectorId && sectorId !== 'all') where.sectorId = sectorId;
    if (type && type !== 'all') where.type = type;
    if (status && status !== 'all') where.status = status;
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { streetCode: { contains: search, mode: 'insensitive' } }
      ];
    }

    const streets = await prisma.riyadhStreet.findMany({
      where,
      include: {
        sector: true,
        district: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(streets);
  } catch (error) {
    res.status(500).json({ message: 'فشل في جلب الشوارع', error: error.message });
  }
};

// 3. جلب القوائم المساعدة (قطاعات وأحياء)
const getLookups = async (req, res) => {
  try {
    const sectors = await prisma.riyadhSector.findMany();
    const districts = await prisma.riyadhDistrict.findMany();
    res.json({ sectors, districts });
  } catch (error) {
    res.status(500).json({ message: 'فشل في جلب القوائم', error: error.message });
  }
};

// 4. إحصائيات لوحة المعلومات (للتاب 939-01 و 939-08)
const getStatistics = async (req, res) => {
  try {
    const total = await prisma.riyadhStreet.count();
    const withRegulations = await prisma.riyadhStreet.count({ where: { hasSpecialRegulation: true } });
    
    // تجميع حسب النوع
    const byType = await prisma.riyadhStreet.groupBy({
      by: ['type'],
      _count: { id: true },
      _sum: { length: true, width: true, lanes: true } // لمتوسط العرض
    });

    // تجميع حسب الحالة
    const active = await prisma.riyadhStreet.count({ where: { status: 'active' } });
    const lighting = await prisma.riyadhStreet.count({ where: { lighting: true } });

    // حساب إجمالي الطول
    const totalLengthResult = await prisma.riyadhStreet.aggregate({
      _sum: { length: true }
    });

    res.json({
      total,
      withRegulations,
      active,
      lighting,
      totalLength: totalLengthResult._sum.length || 0,
      byType
    });
  } catch (error) {
    res.status(500).json({ message: 'فشل في حساب الإحصائيات', error: error.message });
  }
};

module.exports = {
  createStreet,
  getAllStreets,
  getLookups,
  getStatistics
};
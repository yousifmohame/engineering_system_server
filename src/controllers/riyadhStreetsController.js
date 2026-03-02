const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// توليد كود الشارع تلقائياً
const generateStreetCode = async () => {
  const count = await prisma.riyadhStreet.count();
  const year = new Date().getFullYear();
  return `STR-${year}-${String(count + 1).padStart(4, "0")}`;
};

// 1. إنشاء شارع جديد
const createStreet = async (req, res) => {
  try {
    const {
      name,
      sectorId,
      districtId,
      type,
      width,
      length,
      lanes,
      status,
      centerLat,
      centerLng,
      lighting,
      sidewalks,
      hasSpecialRegulation,
      regulationDetails,
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
        district: true,
      },
    });

    res.status(201).json(newStreet);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "فشل في إضافة الشارع", error: error.message });
  }
};

// ===================================================
// 16. تعديل شارع موجود
// ===================================================
const updateStreet = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, width, length, lanes, lighting, sidewalks } = req.body;

    const updatedStreet = await prisma.riyadhStreet.update({
      where: { id },
      data: {
        name,
        type,
        width: parseFloat(width),
        length: parseFloat(length),
        lanes: parseInt(lanes),
        lighting,
        sidewalks,
      },
    });
    res.json(updatedStreet);
  } catch (error) {
    res.status(500).json({ message: "فشل تحديث الشارع", error: error.message });
  }
};

// ===================================================
// 17. حذف شارع
// ===================================================
const deleteStreet = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.riyadhStreet.delete({ where: { id } });
    res.json({ message: "تم حذف الشارع بنجاح" });
  } catch (error) {
    res.status(500).json({ message: "فشل حذف الشارع", error: error.message });
  }
};

// 2. جلب الشوارع مع الفلترة
const getAllStreets = async (req, res) => {
  try {
    const { sectorId, type, status, search } = req.query;

    const where = {};
    if (sectorId && sectorId !== "all") where.sectorId = sectorId;
    if (type && type !== "all") where.type = type;
    if (status && status !== "all") where.status = status;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { streetCode: { contains: search, mode: "insensitive" } },
      ];
    }

    const streets = await prisma.riyadhStreet.findMany({
      where,
      include: {
        sector: true,
        district: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(streets);
  } catch (error) {
    res
      .status(500)
      .json({ message: "فشل في جلب الشوارع", error: error.message });
  }
};

// 3. جلب القوائم المساعدة (قطاعات وأحياء)
const getLookups = async (req, res) => {
  try {
    const sectors = await prisma.riyadhSector.findMany();
    const districts = await prisma.riyadhDistrict.findMany();
    res.json({ sectors, districts });
  } catch (error) {
    res
      .status(500)
      .json({ message: "فشل في جلب القوائم", error: error.message });
  }
};

// 4. إحصائيات لوحة المعلومات (للتاب 939-01 و 939-08)
const getStatistics = async (req, res) => {
  try {
    const total = await prisma.riyadhStreet.count();
    const withRegulations = await prisma.riyadhStreet.count({
      where: { hasSpecialRegulation: true },
    });

    // تجميع حسب النوع
    const byType = await prisma.riyadhStreet.groupBy({
      by: ["type"],
      _count: { id: true },
      _sum: { length: true, width: true, lanes: true }, // لمتوسط العرض
    });

    // تجميع حسب الحالة
    const active = await prisma.riyadhStreet.count({
      where: { status: "active" },
    });
    const lighting = await prisma.riyadhStreet.count({
      where: { lighting: true },
    });

    // حساب إجمالي الطول
    const totalLengthResult = await prisma.riyadhStreet.aggregate({
      _sum: { length: true },
    });

    res.json({
      total,
      withRegulations,
      active,
      lighting,
      totalLength: totalLengthResult._sum.length || 0,
      byType,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "فشل في حساب الإحصائيات", error: error.message });
  }
};

// ===================================================
// 3. تهيئة الباك إند للربط المستقبلي مع (العملاء، الملكيات، المعاملات)
// ===================================================
/*
  💡 ملاحظة للمبرمج: 
  عندما تقوم بإنشاء جداول (Transaction, Property, Client) في Prisma،
  يجب أن تضيف لها حقل `districtId`. 
  وبعدها سيتم تغيير هذا الكود ليقوم بالعد التلقائي (Aggregation) مباشرة من الداتابيز كالتالي:
*/
const getDivisionTree = async (req, res) => {
  try {
    const sectors = await prisma.riyadhSector.findMany({
      include: {
        districts: {
          include: {
            streets: true,
            // 🚀 الكود المستقبلي للربط الحقيقي 🚀
            // _count: {
            //   select: { properties: true, transactions: true, clients: true }
            // }
          },
        },
      },
    });

    const uiMeta = {
      وسط: {
        color: "rgb(220, 38, 38)",
        bgLight: "rgba(220, 38, 38, 0.063)",
        icon: "🏛️",
      },
      شمال: {
        color: "rgb(37, 99, 235)",
        bgLight: "rgba(37, 99, 235, 0.063)",
        icon: "⬆️",
      },
      جنوب: {
        color: "rgb(22, 163, 74)",
        bgLight: "rgba(22, 163, 74, 0.063)",
        icon: "⬇️",
      },
      شرق: {
        color: "rgb(234, 88, 12)",
        bgLight: "rgba(234, 88, 12, 0.063)",
        icon: "➡️",
      },
      غرب: {
        color: "rgb(147, 51, 234)",
        bgLight: "rgba(147, 51, 234, 0.063)",
        icon: "⬅️",
      },
    };

    const treeData = sectors.map((sector) => {
      const meta = uiMeta[sector.name] || {
        color: "rgb(100, 116, 139)",
        bgLight: "rgba(100, 116, 139, 0.063)",
        icon: "📍",
      };

      let totalTransactions = 0;
      let totalProperties = 0;
      let totalClients = 0;

      const mappedNeighborhoods = sector.districts.map((dist) => {
        // إذا تم تفعيل الـ _count في Prisma، استبدل الأرقام الوهمية بـ: dist._count.transactions
        const nbhStats = {
          transactions: Math.floor(Math.random() * 250) + 50,
          properties: Math.floor(Math.random() * 1500) + 500,
          clients: Math.floor(Math.random() * 300) + 100,
        };

        totalTransactions += nbhStats.transactions;
        totalProperties += nbhStats.properties;
        totalClients += nbhStats.clients;

        return {
          id: dist.id,
          name: dist.name,
          code: dist.code || "N/A",
          officialLink: dist.officialLink || "",
          mapImage: dist.mapImage || null,
          satelliteImage: dist.satelliteImage || null,
          stats: nbhStats,
          streets: dist.streets.map((st) => ({
            id: st.id,
            name: st.name,
            width: `${st.width}م`,
            code: st.streetCode,
            type: st.type,
          })),
        };
      });

      return {
        id: sector.id,
        name: sector.name,
        fullName: `قطاع ${sector.name} مدينة الرياض`,
        code: sector.code || "N/A",
        officialLink: sector.officialLink || "",
        mapImage: sector.mapImage || null,
        satelliteImage: sector.satelliteImage || null,
        color: meta.color,
        bgLight: meta.bgLight,
        icon: meta.icon,
        stats: {
          neighborhoods: mappedNeighborhoods.length,
          transactions: totalTransactions,
          properties: totalProperties,
          clients: totalClients,
        },
        neighborhoods: mappedNeighborhoods,
      };
    });

    res.json(treeData);
  } catch (error) {
    res
      .status(500)
      .json({ message: "فشل جلب شجرة التقسيم", error: error.message });
  }
};
// ===================================================
// 6. إضافة قطاع جديد
// ===================================================
const createSector = async (req, res) => {
  try {
    const { name, officialLink, mapImage, satelliteImage } = req.body;
    if (!name) return res.status(400).json({ message: "اسم القطاع مطلوب" });

    // توليد الكود التلقائي (مثال: SEC-001)
    const count = await prisma.riyadhSector.count();
    const autoCode = `SEC-${String(count + 1).padStart(3, "0")}`;

    const newSector = await prisma.riyadhSector.create({
      data: { name, code: autoCode, officialLink, mapImage, satelliteImage },
    });
    res.status(201).json(newSector);
  } catch (error) {
    if (error.code === "P2002")
      return res.status(400).json({ message: "القطاع موجود مسبقاً" });
    res.status(500).json({ message: "خطأ", error: error.message });
  }
};

// ===================================================
// 7. تعديل قطاع
// ===================================================
const updateSector = async (req, res) => {
  try {
    const { id } = req.params;
    // استلام البيانات الجديدة بما فيها الرابط
    const { name, code, officialLink, mapImage, satelliteImage } = req.body;

    const updatedSector = await prisma.riyadhSector.update({
      where: { id },
      data: { name, code, officialLink, mapImage, satelliteImage },
    });
    res.json(updatedSector);
  } catch (error) {
    res
      .status(500)
      .json({ message: "خطأ في تحديث القطاع", error: error.message });
  }
};

// ===================================================
// 8. إضافة وتعديل الأحياء (Districts)
// ===================================================
const createDistrict = async (req, res) => {
  try {
    const { name, sectorId, officialLink, mapImage, satelliteImage } = req.body;

    // توليد الكود التلقائي (مثال: NBH-001)
    const count = await prisma.riyadhDistrict.count();
    const autoCode = `NBH-${String(count + 1).padStart(3, "0")}`;

    const newDistrict = await prisma.riyadhDistrict.create({
      data: {
        name,
        code: autoCode,
        sectorId,
        officialLink,
        mapImage,
        satelliteImage,
      },
    });
    res.status(201).json(newDistrict);
  } catch (error) {
    res.status(500).json({ message: "خطأ", error: error.message });
  }
};

const updateDistrict = async (req, res) => {
  try {
    const { id } = req.params;
    // استلام البيانات الجديدة بما فيها الرابط
    const { name, code, officialLink, mapImage, satelliteImage } = req.body;

    const updated = await prisma.riyadhDistrict.update({
      where: { id },
      data: { name, code, officialLink, mapImage, satelliteImage },
    });
    res.json(updated);
  } catch (error) {
    res
      .status(500)
      .json({ message: "خطأ في تحديث الحي", error: error.message });
  }
};

// ===================================================
// 9. إضافة شارع سريع (من الشجرة)
// ===================================================
const createStreetQuick = async (req, res) => {
  try {
    const { name, width, type, districtId, sectorId } = req.body;

    // توليد كود شارع تلقائي
    const count = await prisma.riyadhStreet.count();
    const streetCode = `STR-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

    const newStreet = await prisma.riyadhStreet.create({
      data: {
        name,
        width: parseFloat(width) || 15, // عرض افتراضي
        type: type || "normal",
        streetCode,
        districtId,
        sectorId,
        // قيم افتراضية مطلوبة في الـ Schema الخاص بك لتجنب الأخطاء
        length: 1000,
        lanes: 2,
        status: "active",
        centerLat: 24.7136,
        centerLng: 46.6753,
      },
    });
    res.status(201).json(newStreet);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "خطأ في إنشاء الشارع", error: error.message });
  }
};

// ===================================================
// 10. إدارة المخططات التنظيمية (Plans)
// ===================================================

// جلب جميع المخططات
const getPlans = async (req, res) => {
  try {
    const plans = await prisma.riyadhPlan.findMany({
      include: {
        districts: { select: { name: true } }, // نجلب أسماء الأحياء فقط للعرض
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json(plans);
  } catch (error) {
    res.status(500).json({ message: "فشل جلب المخططات", error: error.message });
  }
};

// إنشاء مخطط جديد
const createPlan = async (req, res) => {
  try {
    const {
      planNumber,
      oldNumber,
      status,
      isWithout,
      properties,
      plots,
      districtIds,
    } = req.body;

    // توليد كود داخلي (مثال: PLAN-001)
    const count = await prisma.riyadhPlan.count();
    const internalCode = `PLAN-${String(count + 1).padStart(3, "0")}`;

    const newPlan = await prisma.riyadhPlan.create({
      data: {
        planNumber: isWithout ? "بدون" : planNumber,
        oldNumber,
        internalCode,
        status,
        isWithout,
        properties: parseInt(properties || 0),
        plots: parseInt(plots || 0),
        // ربط المخطط بالأحياء المختارة (إذا تم تمرير districtIds)
        districts:
          districtIds && districtIds.length > 0
            ? {
                connect: districtIds.map((id) => ({ id })),
              }
            : undefined,
      },
      include: { districts: true },
    });
    res.status(201).json(newPlan);
  } catch (error) {
    if (error.code === "P2002")
      return res.status(400).json({ message: "رقم المخطط مسجل مسبقاً" });
    res.status(500).json({ message: "فشل إنشاء المخطط", error: error.message });
  }
};

// تحديث مخطط
const updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      planNumber,
      oldNumber,
      status,
      isWithout,
      properties,
      plots,
      districtIds,
    } = req.body;

    const updatedPlan = await prisma.riyadhPlan.update({
      where: { id },
      data: {
        planNumber: isWithout ? "بدون" : planNumber,
        oldNumber,
        status,
        isWithout,
        properties: parseInt(properties || 0),
        plots: parseInt(plots || 0),
        // تحديث العلاقات: فصل الأحياء القديمة وربط الجديدة
        districts: districtIds
          ? {
              set: districtIds.map((id) => ({ id })),
            }
          : undefined,
      },
      include: { districts: true },
    });
    res.json(updatedPlan);
  } catch (error) {
    res.status(500).json({ message: "فشل تحديث المخطط", error: error.message });
  }
};

// حذف مخطط
const deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.riyadhPlan.delete({ where: { id } });
    res.json({ message: "تم حذف المخطط بنجاح" });
  } catch (error) {
    res.status(500).json({ message: "فشل حذف المخطط", error: error.message });
  }
};
// ===================================================
// 11. جلب الإحصائيات الشاملة (لتاب StatsTab)
// ===================================================
const getDashboardStats = async (req, res) => {
  try {
    const { period, sectorId, transactionType } = req.query;

    // 1. حساب الـ KPIs العلوية
    // (بافتراض وجود جداول Transaction, Client, Property، إذا لم تكن موجودة، سنستخدم أرقاماً مبدئية)

    // ملاحظة: استبدل هذه الأرقام مستقبلاً بـ await prisma.transaction.count() الخ..
    const kpi = {
      totalTransactions: 12952,
      transactionsGrowth: 5.2,
      totalClients: 8203,
      clientsGrowth: 3.8,
      totalProperties: 78456,
      propertiesGrowth: 1.2,
      avgCompletionTime: 29, // ساعة
      completionGrowth: -2.5, // انخفاض يعني تحسن
      rejectionRate: 4.5,
      rejectionGrowth: 0.5,
    };

    // 2. تحليل حركة المعاملات (Area Chart) لآخر 6 أشهر
    // (استبدلها مستقبلاً بـ GroupBy على جدول Transactions)
    const areaData = [
      { name: "يناير", new: 400, completed: 240 },
      { name: "فبراير", new: 300, completed: 139 },
      { name: "مارس", new: 200, completed: 980 },
      { name: "أبريل", new: 278, completed: 390 },
      { name: "مايو", new: 189, completed: 480 },
      { name: "يونيو", new: 239, completed: 380 },
    ];

    // 3. توزيع أنواع العملاء (Pie Chart)
    const pieData = [
      { name: "أفراد", value: 4500, color: "#3b82f6" },
      { name: "شركات", value: 2500, color: "#8b5cf6" },
      { name: "جهات حكومية", value: 1203, color: "#10b981" },
    ];

    // 4. الخريطة الحرارية الحقيقية بناءً على الأحياء الموجودة في قاعدة البيانات
    let districtFilter = {};
    if (sectorId && sectorId !== "all") {
      districtFilter.sectorId = sectorId;
    }

    const districts = await prisma.riyadhDistrict.findMany({
      where: districtFilter,
      select: { name: true, id: true },
    });

    // توليد مصفوفة الخريطة الحرارية (Heatmap)
    const heatMapData = districts.map((dist) => {
      // 💡 الكود المستقبلي الحقيقي:
      // const evalCount = await prisma.transaction.count({ where: { districtId: dist.id, type: 'eval' }});

      // كود توليد مؤقت لحين ربط المعاملات
      const evalCount = Math.floor(Math.random() * 80) + 10;
      const splitCount = Math.floor(Math.random() * 80) + 10;
      const mergeCount = Math.floor(Math.random() * 80) + 10;
      const transferCount = Math.floor(Math.random() * 80) + 10;
      const licenseCount = Math.floor(Math.random() * 80) + 10;

      return {
        nbh: dist.name,
        eval: evalCount,
        split: splitCount,
        merge: mergeCount,
        transfer: transferCount,
        license: licenseCount,
        total:
          evalCount + splitCount + mergeCount + transferCount + licenseCount,
      };
    });

    // ترتيب الخريطة الحرارية من الأعلى نشاطاً للأقل
    heatMapData.sort((a, b) => b.total - a.total);

    res.json({
      kpi,
      areaData,
      pieData,
      heatMapData: heatMapData.slice(0, 20), // عرض أعلى 20 حي فقط لتخفيف الواجهة
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "فشل جلب الإحصائيات", error: error.message });
  }
};

// ===================================================
// 12. جلب قائمة القطاعات (لشاشة إدارة القطاعات 40)
// ===================================================
const getSectorsList = async (req, res) => {
  try {
    const sectors = await prisma.riyadhSector.findMany({
      include: {
        _count: {
          select: { districts: true, streets: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(sectors);
  } catch (error) {
    res.status(500).json({ message: "فشل جلب القطاعات", error: error.message });
  }
};

// ===================================================
// 13. حذف القطاع (مع حماية العلاقات)
// ===================================================
const deleteSector = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. التأكد من عدم وجود أحياء مرتبطة بهذا القطاع
    const sectorWithDistricts = await prisma.riyadhSector.findUnique({
      where: { id },
      include: {
        _count: { select: { districts: true } },
      },
    });

    if (sectorWithDistricts._count.districts > 0) {
      return res
        .status(400)
        .json({
          message:
            "لا يمكن حذف هذا القطاع لارتباطه بأحياء مسجلة. يرجى نقل الأحياء أولاً.",
        });
    }

    // 2. الحذف الآمن
    await prisma.riyadhSector.delete({ where: { id } });

    res.json({ message: "تم حذف القطاع بنجاح" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "خطأ أثناء محاولة الحذف", error: error.message });
  }
};

// ===================================================
// 14. جلب قائمة الأحياء (لشاشة الأحياء 41)
// ===================================================
const getDistrictsList = async (req, res) => {
  try {
    const districts = await prisma.riyadhDistrict.findMany({
      include: {
        sector: { select: { id: true, name: true } }, // 👈 جلب اسم القطاع التابع له
        _count: { select: { streets: true, plans: true } }, // 👈 عدد الشوارع والمخططات داخله
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(districts);
  } catch (error) {
    res.status(500).json({ message: "فشل جلب الأحياء", error: error.message });
  }
};

// ===================================================
// 15. حذف الحي (مع حماية العلاقات)
// ===================================================
const deleteDistrict = async (req, res) => {
  try {
    const { id } = req.params;

    // فحص ما إذا كان الحي يحتوي على شوارع قبل الحذف
    const districtWithStreets = await prisma.riyadhDistrict.findUnique({
      where: { id },
      include: { _count: { select: { streets: true } } },
    });

    if (districtWithStreets._count.streets > 0) {
      return res
        .status(400)
        .json({ message: "لا يمكن حذف الحي لوجود شوارع مسجلة بداخله." });
    }

    await prisma.riyadhDistrict.delete({ where: { id } });
    res.json({ message: "تم حذف الحي بنجاح" });
  } catch (error) {
    res.status(500).json({ message: "خطأ أثناء الحذف", error: error.message });
  }
};

// لا تنسَ التصدير
module.exports = {
  createStreet,
  updateStreet,
  deleteStreet,
  getAllStreets,
  getLookups,
  getStatistics,
  getDivisionTree,
  createSector,
  updateSector,
  createDistrict,
  updateDistrict,
  createStreetQuick, // 👈 الإضافات الجديدة
  getPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getDashboardStats,
  getSectorsList,
  deleteSector,
  getDistrictsList,
  deleteDistrict,
};

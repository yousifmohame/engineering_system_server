const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 🪄 دالة سحرية لتحويل Base64 إلى ملف حقيقي على السيرفر
const saveBase64ToFile = (base64Data, fileName) => {
  if (!base64Data || !base64Data.startsWith('data:')) return base64Data;

  try {
    const matches = base64Data.match(/^data:([A-Za-z-+\/.]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return base64Data;

    const fileBuffer = Buffer.from(matches[2], 'base64');
    const extension = path.extname(fileName) || '.jpg';
    const uniqueFileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
    
    // 💡 استخدام path.resolve لضمان المسار الصحيح
    const dir = path.resolve(process.cwd(), 'uploads', 'plans');
    
    if (!fs.existsSync(dir)) {
      console.log("📂 إنشاء مجلد المخططات:", dir);
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, uniqueFileName);
    fs.writeFileSync(filePath, fileBuffer);
    
    console.log("✅ تم حفظ الملف بنجاح في:", filePath);
    return `/uploads/plans/${uniqueFileName}`;
  } catch (error) {
    console.error("❌ خطأ فادح أثناء حفظ الملف على القرص:", error); // 👈 هذا السطر سيخبرنا بالسبب الحقيقي
    return null;
  }
};

// توليد كود الشارع تلقائياً
const generateStreetCode = async () => {
  const count = await prisma.riyadhStreet.count();
  const year = new Date().getFullYear();
  return `STR-${year}-${String(count + 1).padStart(4, "0")}`;
};

// 1. إنشاء شارع جديد (الأساسية)
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
      hasSpecialRegulation,
      regulationDetails,
    } = req.body;

    const streetCode = await generateStreetCode();

    const newStreet = await prisma.riyadhStreet.create({
      data: {
        streetCode,
        name,
        type,
        width: parseFloat(width),
        length: length ? parseFloat(length) : null,
        lanes: lanes ? parseInt(lanes) : null,

        sectorId: sectorId,
        districtId: districtId || null, // 👈 أهم تعديل هنا

        status: status || "active",
        centerLat: parseFloat(centerLat || 24.7136),
        centerLng: parseFloat(centerLng || 46.6753),

        hasSpecialRegulation: hasSpecialRegulation ?? false,
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
    const {
      name,
      type,
      width,
      length,
      lanes,
      hasSpecialRegulation, // 👈 تمت الإضافة
      regulationDetails, // 👈 تمت الإضافة
    } = req.body;

    const updatedStreet = await prisma.riyadhStreet.update({
      where: { id },
      data: {
        name,
        type,
        width: parseFloat(width),
        length: length ? parseFloat(length) : null,
        lanes: lanes ? parseInt(lanes) : null,

        // 👈 تحديث التنظيمات الخاصة أثناء التعديل
        hasSpecialRegulation: hasSpecialRegulation ?? false,
        regulationDetails: hasSpecialRegulation ? regulationDetails : null,
      },
    });

    res.json(updatedStreet);
  } catch (error) {
    console.error("Update Street Error:", error);
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
  عندما تقوم بإنشاء جداول (Transaction, ownerships, Client) في Prisma،
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
            // 🚀 تصحيح اسم العلاقة إلى ownerships بدلاً من properties 🚀
            _count: {
              select: { ownerships: true, transactions: true, clients: true },
            },
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
      // 💡 بحث ذكي عن اللون المطابق لاسم القطاع (لأن الاسم في الداتابيز قد يكون "قطاع شمال الرياض")
      const matchedKey = Object.keys(uiMeta).find((key) =>
        sector.name.includes(key),
      );
      const meta = uiMeta[matchedKey] || {
        color: "rgb(100, 116, 139)",
        bgLight: "rgba(100, 116, 139, 0.063)",
        icon: "📍",
      };

      let totalTransactions = 0;
      let totalProperties = 0;
      let totalClients = 0;

      const mappedNeighborhoods = sector.districts.map((dist) => {
        // 🚀 جلب الأرقام الحقيقية من قاعدة البيانات مباشرة 🚀
        const nbhStats = {
          transactions: dist._count?.transactions || 0,
          properties: dist._count?.ownerships || 0,
          clients: dist._count?.clients || 0,
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
        fullName: sector.name, // استخدمنا الاسم مباشرة ليكون أنظف
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
    console.error("Tree Error:", error); // سيفيدك جداً لطباعة الخطأ الحقيقي في التيرمينال
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
// 9. إضافة شارع سريع (من الشجرة أو المودال)
// ===================================================
const createStreetQuick = async (req, res) => {
  try {
    const {
      name,
      width,
      length,
      lanes,
      type,
      districtId,
      sectorId,
      hasSpecialRegulation,
      regulationDetails,
    } = req.body;

    // توليد كود شارع تلقائي
    const count = await prisma.riyadhStreet.count();
    const streetCode = `STR-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

    const newStreet = await prisma.riyadhStreet.create({
      data: {
        streetCode,
        name,
        type: type || "normal",
        width: parseFloat(width) || 15, // العرض إجباري وله قيمة افتراضية
        length: length ? parseFloat(length) : null,
        lanes: lanes ? parseInt(lanes) : null,

        sectorId: sectorId, // 👈 القطاع إجباري
        districtId: districtId || null, // 👈 الحي اختياري ويقبل null

        status: "active",
        centerLat: 24.7136,
        centerLng: 46.6753,

        hasSpecialRegulation: hasSpecialRegulation ?? false,
        regulationDetails: hasSpecialRegulation ? regulationDetails : null,
      },
    });

    res.status(201).json(newStreet);
  } catch (error) {
    console.error("🔥 Quick Street Error:", error);
    res
      .status(500)
      .json({ message: "خطأ في إنشاء الشارع", error: error.message });
  }
};

// ==========================================
// جلب جميع المخططات مع كافة تفاصيلها
// ==========================================
const getPlans = async (req, res) => {
  try {
    const plans = await prisma.riyadhPlan.findMany({
      include: {
        // 🚀 1. جلب الشوارع المرتبطة بالمخطط
        streets: true, 
        
        // 🚀 2. جلب الملفات والمرفقات المرتبطة بالمخطط
        files: true, 
        
        // 🚀 3. جلب عدد المشاريع والقطع كإحصائية سريعة
        RiyadhPlanPlot: { select: { plotNumber: true } },
        _count: {
          select: { 
            projects: true, // عدد المشاريع المرتبطة
            
            // 💡 التعديل هنا: نعد القطع من الجدول الرئيسي الجديد للقطع
            // ملاحظة: إذا كان اسم العلاقة في schema مختلفاً (مثل riyadhPlanPlots)، استخدمه هنا
            RiyadhPlanPlot: true 
          }
        }
      },
      orderBy: { updatedAt: "desc" },
    });
    
    // إعادة تهيئة البيانات ليتعرف عليها الفرونت إند بسهولة (تغيير الاسم من RiyadhPlanPlot إلى projectPlots مؤقتاً لتجنب كسر الواجهة)
    const formattedPlans = plans.map(plan => ({
      ...plan,
      _count: {
        projects: plan._count?.projects || 0,
        // نمرر العدد للفرونت إند بنفس الاسم القديم حتى لا تضطر لتعديل الواجهة
        projectPlots: plan._count?.RiyadhPlanPlot || plan._count?.riyadhPlanPlots || 0 
      }
    }));
    
    res.json(formattedPlans);
  } catch (error) {
    console.error("Get Plans Error:", error);
    res.status(500).json({ message: "فشل جلب المخططات", error: error.message });
  }
};

// إنشاء مخطط جديد
// ==========================================
// إنشاء مخطط جديد (مع حفظ الملفات الحقيقية)
// ==========================================
const createPlan = async (req, res) => {
  try {

    const data = req.body;

    const finalPlanNumber = data.isWithout
      ? "بدون"
      : data.planNumber ||
        data.name ||
        `مؤقت-${Math.floor(Math.random() * 1000)}`;

    const existingPlan = await prisma.riyadhPlan.findUnique({
      where: { planNumber: finalPlanNumber },
    });
    if (existingPlan) {
      return res
        .status(400)
        .json({ success: false, message: "المخطط موجود مسبقاً." });
    }

    const internalCode = `PLAN-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 100)}`;

    // 🚀 تحويل الصور والخرائط
    const officialMapImagePath = saveBase64ToFile(
      data.officialMapImage,
      "official_map.jpg",
    );
    const googleMapImagePath = saveBase64ToFile(
      data.googleMapImage,
      "google_map.jpg",
    );

    // 🚀 تحويل ومعالجة ملفات المخطط المرفقة
    const processedFiles = (data.files || []).map((f) => ({
      url: saveBase64ToFile(f.url, f.name) || f.url, // تحويل للقرص الصلب
      name: f.name,
      desc: f.desc || "",
      type: f.type || "FILE",
    }));

    const newPlan = await prisma.riyadhPlan.create({
      data: {
        planNumber: finalPlanNumber,
        oldNumber: data.oldNumber || null,
        internalCode: internalCode,
        status: data.status || "معتمد",
        isWithout: data.isWithout === true || data.isWithout === "true",
        properties: parseInt(data.properties || 0),
        plots: parseInt(data.plots || 0),
        hijriYear: data.hijriYear,
        areaKm: data.areaKm?.toString(),
        areaM: data.areaM?.toString(),
        mainUsages: data.mainUsages,
        subUsages: data.subUsages,
        totalPlots: parseInt(data.totalPlots) || 0,
        neighborhoods: data.neighborhoods,
        officialMapUrl: data.officialMapUrl,
        googleMapUrl: data.googleMapUrl,

        // حفظ المسار القصير فقط
        officialMapImage: officialMapImagePath,
        googleMapImage: googleMapImagePath,

        notes: data.notes,
        specialRegulations: data.specialRegulations || [],

        districts:
          data.districtIds &&
          Array.isArray(data.districtIds) &&
          data.districtIds.length > 0
            ? { connect: data.districtIds.map((id) => ({ id })) }
            : undefined,

        streets: {
          create:
            data.streets?.map((s) => ({
              name: s.name,
              width: s.width?.toString(),
              hasSpecialReg: s.hasSpecialReg,
              regDesc: s.regDesc,
            })) || [],
        },

        // 🚀 إدخال الملفات المعالجة
        files: { create: processedFiles },
      },
      include: { districts: true, streets: true, files: true },
    });

    res.status(201).json({ success: true, data: newPlan });
  } catch (error) {
    console.error("🔥 Create Plan Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "فشل إنشاء المخطط",
        error: error.message,
      });
  }
};

// ==========================================
// تحديث مخطط (مع حفظ الملفات الجديدة)
// ==========================================
const updatePlan = async (req, res) => {
  try {
    const { id } = req.params;

    const data = req.body;

    // 🚀 تحويل الصور والخرائط
    const officialMapImagePath = saveBase64ToFile(
      data.officialMapImage,
      "official_map.jpg",
    );
    const googleMapImagePath = saveBase64ToFile(
      data.googleMapImage,
      "google_map.jpg",
    );

    // 🚀 تحويل ومعالجة ملفات المخطط المرفقة
    const processedFiles = (data.files || []).map((f) => ({
      url: saveBase64ToFile(f.url, f.name) || f.url,
      name: f.name,
      desc: f.desc || "",
      type: f.type || "FILE",
    }));

    const updatedPlan = await prisma.riyadhPlan.update({
      where: { id },
      data: {
        planNumber: data.isWithout ? "بدون" : data.planNumber,
        oldNumber: data.oldNumber,
        status: data.status,
        isWithout: data.isWithout,
        properties: parseInt(data.properties || 0),
        plots: parseInt(data.plots || 0),
        hijriYear: data.hijriYear,
        areaKm: data.areaKm?.toString(),
        areaM: data.areaM?.toString(),
        mainUsages: data.mainUsages,
        subUsages: data.subUsages,
        totalPlots: parseInt(data.totalPlots) || 0,
        neighborhoods: data.neighborhoods,
        officialMapUrl: data.officialMapUrl,
        googleMapUrl: data.googleMapUrl,

        officialMapImage: officialMapImagePath,
        googleMapImage: googleMapImagePath,

        notes: data.notes,
        specialRegulations: data.specialRegulations || [],

        districts: data.districtIds
          ? { set: data.districtIds.map((id) => ({ id })) }
          : undefined,

        streets: {
          deleteMany: {},
          create:
            data.streets?.map((s) => ({
              name: s.name,
              width: s.width?.toString(),
              hasSpecialReg: s.hasSpecialReg,
              regDesc: s.regDesc,
            })) || [],
        },

        // 🚀 تحديث الملفات بأمان
        files: {
          deleteMany: {}, // يمسح السجلات القديمة من الداتابيز
          create: processedFiles, // يضيف السجلات الجديدة (التي تتضمن المسارات المحفوظة فعلياً)
        },
      },
      include: { districts: true, streets: true, files: true },
    });

    res.json(updatedPlan);
  } catch (error) {
    console.error("🔥 Update Plan Error:", error);
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

// دالة مساعدة لحساب نسبة النمو
const calculateGrowth = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return parseFloat((((current - previous) / previous) * 100).toFixed(1));
};

const getDashboardStats = async (req, res) => {
  try {
    const { period, sectorId, transactionType } = req.query;

    // إعداد التواريخ لحساب النمو (آخر 30 يوم مقارنة بالـ 30 يوم التي قبلها)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // ==========================================
    // 1. حساب الـ KPIs العلوية الحقيقية
    // ==========================================
    const [
      totalTx,
      prevTx,
      totalClients,
      prevClients,
      totalProps,
      prevProps,
      completedTxCurrent,
      completedTxPrev,
      rejectedTxCurrent,
      rejectedTxPrev,
    ] = await Promise.all([
      prisma.transaction.count(),
      prisma.transaction.count({ where: { createdAt: { lt: thirtyDaysAgo } } }),

      prisma.client.count(),
      prisma.client.count({ where: { createdAt: { lt: thirtyDaysAgo } } }),

      prisma.ownershipFile.count(),
      prisma.ownershipFile.count({
        where: { createdAt: { lt: thirtyDaysAgo } },
      }),

      // المعاملات المنجزة والمرفوضة للشهر الحالي والسابق (لحساب معدلات الإنجاز والرفض)
      prisma.transaction.count({
        where: { status: "Completed", completedDate: { gte: thirtyDaysAgo } },
      }),
      prisma.transaction.count({
        where: {
          status: "Completed",
          completedDate: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        },
      }),

      prisma.transaction.count({
        where: { status: "Rejected", createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.transaction.count({
        where: {
          status: "Rejected",
          createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        },
      }),
    ]);

    // حساب معدلات الرفض
    const currentTotalForRates =
      (await prisma.transaction.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      })) || 1;
    const prevTotalForRates =
      (await prisma.transaction.count({
        where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      })) || 1;

    const rejectionRate = (
      (rejectedTxCurrent / currentTotalForRates) *
      100
    ).toFixed(1);
    const prevRejectionRate = (
      (rejectedTxPrev / prevTotalForRates) *
      100
    ).toFixed(1);

    // حساب متوسط وقت الإنجاز (للمعاملات المكتملة)
    const completedTransactions = await prisma.transaction.findMany({
      where: { status: "Completed", completedDate: { not: null } },
      select: { createdAt: true, completedDate: true },
      take: 100, // نأخذ آخر 100 معاملة كعينة للحساب السريع
    });

    let avgTime = 0;
    if (completedTransactions.length > 0) {
      const totalHours = completedTransactions.reduce((acc, tx) => {
        return acc + Math.abs(tx.completedDate - tx.createdAt) / 36e5; // فرق الساعات
      }, 0);
      avgTime = Math.round(totalHours / completedTransactions.length);
    }

    const kpi = {
      totalTransactions: totalTx,
      transactionsGrowth: calculateGrowth(totalTx, prevTx),
      totalClients: totalClients,
      clientsGrowth: calculateGrowth(totalClients, prevClients),
      totalProperties: totalProps,
      propertiesGrowth: calculateGrowth(totalProps, prevProps),
      avgCompletionTime: avgTime || 24, // ساعة
      completionGrowth: 0, // يمكن تطويرها برمجياً
      rejectionRate: parseFloat(rejectionRate),
      rejectionGrowth: (rejectionRate - prevRejectionRate).toFixed(1),
    };

    // ==========================================
    // 2. تحليل حركة المعاملات (Area Chart) لآخر 6 أشهر
    // ==========================================
    const areaData = [];
    // نولد بيانات آخر 6 شهور ديناميكياً
    for (let i = 5; i >= 0; i--) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(
        now.getFullYear(),
        now.getMonth() - i + 1,
        0,
        23,
        59,
        59,
      );
      const monthName = startOfMonth.toLocaleString("ar-SA", {
        month: "short",
      }); // مثال: يناير

      const newCount = await prisma.transaction.count({
        where: { createdAt: { gte: startOfMonth, lte: endOfMonth } },
      });
      const completedCount = await prisma.transaction.count({
        where: {
          completedDate: { gte: startOfMonth, lte: endOfMonth },
          status: "Completed",
        },
      });

      areaData.push({
        name: monthName,
        new: newCount,
        completed: completedCount,
      });
    }

    // ==========================================
    // 3. توزيع أنواع العملاء الحقيقي (Pie Chart)
    // ==========================================
    const clientsGrouped = await prisma.client.groupBy({
      by: ["type"],
      _count: { id: true },
    });

    const pieColors = {
      "فرد سعودي": "#3b82f6",
      "فرد غير سعودي": "#60a5fa",
      شركة: "#8b5cf6",
      "جهة حكومية": "#10b981",
      ورثة: "#f59e0b",
      وقف: "#14b8a6",
      "مكتب هندسي": "#06b6d4",
    };

    const pieData = clientsGrouped
      .map((group) => ({
        name: group.type || "غير محدد",
        value: group._count.id,
        color: pieColors[group.type] || "#94a3b8", // لون افتراضي
      }))
      .filter((item) => item.value > 0); // إخفاء الأنواع التي قيمتها 0

    // ==========================================
    // 4. الخريطة الحرارية الحقيقية (Heatmap)
    // ==========================================
    let districtFilter = {};
    if (sectorId && sectorId !== "all") {
      districtFilter.sectorId = sectorId;
    }

    // جلب الأحياء مع معاملاتها
    const districts = await prisma.riyadhDistrict.findMany({
      where: districtFilter,
      select: {
        name: true,
        transactions: {
          select: { category: true }, // جلب تصنيف المعاملة لمعرفة نوعها (فرز، دمج...)
        },
      },
    });

    // بناء مصفوفة الخريطة الحرارية
    const heatMapData = districts
      .map((dist) => {
        let evalCount = 0,
          splitCount = 0,
          mergeCount = 0,
          transferCount = 0,
          licenseCount = 0;

        // تصنيف المعاملات الموجودة في هذا الحي (اعتمدت على كلمات دلالية في category)
        dist.transactions.forEach((tx) => {
          const cat = tx.category || "";
          if (cat.includes("تقييم") || cat.includes("تثمين")) evalCount++;
          else if (cat.includes("فرز")) splitCount++;
          else if (cat.includes("دمج")) mergeCount++;
          else if (cat.includes("نقل") || cat.includes("إفراغ"))
            transferCount++;
          else if (cat.includes("رخص") || cat.includes("بناء")) licenseCount++;
          else evalCount++; // افتراضي للأنواع الأخرى
        });

        const total =
          evalCount + splitCount + mergeCount + transferCount + licenseCount;

        return {
          nbh: dist.name,
          eval: evalCount,
          split: splitCount,
          merge: mergeCount,
          transfer: transferCount,
          license: licenseCount,
          total: total,
        };
      })
      .filter((d) => d.total > 0); // عرض الأحياء التي فيها نشاط فقط

    // ترتيب من الأعلى للأقل نشاطاً
    heatMapData.sort((a, b) => b.total - a.total);

    res.json({
      kpi,
      areaData,
      pieData,
      heatMapData: heatMapData.slice(0, 20), // أعلى 20 حي نشاطاً
    });
  } catch (error) {
    console.error("Dashboard Stats Error:", error);
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
      return res.status(400).json({
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

// ===================================================
// 18. جلب بيانات التابات التفصيلية (نسخة محسنة بالـ Relations 🚀)
// ===================================================
const getNodeDetails = async (req, res) => {
  try {
    const { type, id, tab } = req.params;

    // 💡 فلتر ذكي ومباشر بالاعتماد على العلاقة الجديدة (districtId)
    // إذا كان نوع العقد "قطاع"، نجلب كل الملكيات التي تنتمي لأحياء تابعة لهذا القطاع (علاقة متداخلة).
    // إذا كان "حي"، نجلب الملكيات المرتبطة بهذا الحي مباشرة.
    const ownershipWhere =
      type === "sector"
        ? { districtNode: { sectorId: id } }
        : { districtId: id };

    // ===============================================
    // 📊 1. تاب الإحصائيات (Stats)
    // ===============================================
    if (tab === "stats") {
      const transactions = await prisma.transaction.findMany({
        where: { ownership: ownershipWhere }, // 👈 استخدام الفلتر الجديد المباشر
        select: {
          status: true,
          duration: true,
          clientId: true,
          ownership: { select: { districtNode: { select: { name: true } } } }, // جلب اسم الحي عبر العلاقة
        },
      });

      const totalTxs = transactions.length || 1;

      const statusCounts = {
        "قيد المعالجة": 0,
        جديدة: 0,
        مكتملة: 0,
        ملغاة: 0,
        معلقة: 0,
      };
      transactions.forEach((t) => {
        let st = "جديدة";
        if (t.status === "Pending") st = "قيد المعالجة";
        if (t.status === "Draft") st = "جديدة";
        if (t.status === "Completed") st = "مكتملة";
        if (t.status === "Cancelled") st = "ملغاة";
        statusCounts[st] = (statusCounts[st] || 0) + 1;
      });

      const statusDistribution = [
        {
          status: "قيد المعالجة",
          count: statusCounts["قيد المعالجة"],
          percent: Math.round((statusCounts["قيد المعالجة"] / totalTxs) * 100),
          color: "rgb(202, 138, 4)",
        },
        {
          status: "جديدة",
          count: statusCounts["جديدة"],
          percent: Math.round((statusCounts["جديدة"] / totalTxs) * 100),
          color: "rgb(37, 99, 235)",
        },
        {
          status: "مكتملة",
          count: statusCounts["مكتملة"],
          percent: Math.round((statusCounts["مكتملة"] / totalTxs) * 100),
          color: "rgb(22, 163, 74)",
        },
        {
          status: "معلقة",
          count: statusCounts["معلقة"],
          percent: Math.round((statusCounts["معلقة"] / totalTxs) * 100),
          color: "rgb(107, 114, 128)",
        },
        {
          status: "ملغاة",
          count: statusCounts["ملغاة"],
          percent: Math.round((statusCounts["ملغاة"] / totalTxs) * 100),
          color: "rgb(220, 38, 38)",
        },
      ].sort((a, b) => b.count - a.count);

      const distCounts = {};
      transactions.forEach((t) => {
        const dName = t.ownership?.districtNode?.name || "غير محدد"; // 👈 الاسم من الـ Node
        distCounts[dName] = (distCounts[dName] || 0) + 1;
      });

      const topDistricts = Object.entries(distCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({
          name,
          count,
          percent: Math.round((count / totalTxs) * 100),
        }));

      const completedTxs = transactions.filter((t) => t.duration);
      const avgTime = completedTxs.length
        ? Math.round(
            completedTxs.reduce((sum, t) => sum + t.duration, 0) /
              completedTxs.length,
          )
        : 0;

      const clientTxCounts = {};
      transactions.forEach((t) => {
        clientTxCounts[t.clientId] = (clientTxCounts[t.clientId] || 0) + 1;
      });
      const totalClients = Object.keys(clientTxCounts).length;
      const returningClients = Object.values(clientTxCounts).filter(
        (count) => count > 1,
      ).length;
      const clientReturnRate =
        totalClients > 0
          ? Math.round((returningClients / totalClients) * 100)
          : 0;

      return res.json({
        avgTime,
        clientReturnRate,
        statusDistribution,
        topDistricts,
      });
    }

    // ===============================================
    // 📄 2. تاب المعاملات (Transactions)
    // ===============================================
    if (tab === "transactions") {
      const transactions = await prisma.transaction.findMany({
        where: { ownership: ownershipWhere }, // 👈 استخدام الفلتر المباشر
        include: {
          client: { select: { name: true } },
          ownership: {
            select: {
              districtNode: { select: { name: true } },
              planNumber: true,
            },
          },
          transactionEmployees: {
            include: { employee: { select: { name: true } } },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      const formattedData = transactions.map((t) => {
        let clientName = "غير محدد";
        if (t.client?.name) {
          const parsedName =
            typeof t.client.name === "string"
              ? JSON.parse(t.client.name)
              : t.client.name;
          clientName = parsedName.ar || "غير محدد";
        }

        let statusAr = "جديدة";
        if (t.status === "Pending") statusAr = "قيد المعالجة";
        if (t.status === "Completed") statusAr = "مكتملة";
        if (t.status === "Cancelled") statusAr = "ملغاة";

        return {
          id: t.id,
          date: t.createdAt.toISOString().split("T")[0],
          ref: t.transactionCode || "بدون مرجع",
          client: clientName,
          service: t.category || "عامة",
          district: t.ownership?.districtNode?.name || "غير محدد", // 👈 من العلاقة
          street: t.ownership?.planNumber || "غير محدد",
          status: statusAr,
          value: t.totalFees ? t.totalFees.toLocaleString("ar-SA") : "0",
          assignee: t.transactionEmployees?.[0]?.employee?.name || "غير مسند",
        };
      });

      return res.json(formattedData);
    }

    // ===============================================
    // 🏠 3. تاب الملكيات (Properties)
    // ===============================================
    if (tab === "properties") {
      const properties = await prisma.ownershipFile.findMany({
        where: ownershipWhere, // 👈 استخدام الفلتر المباشر
        include: {
          client: { select: { name: true } },
          districtNode: { select: { name: true } }, // 👈 جلب اسم الحي
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      const formattedData = properties.map((p) => {
        let clientName = "غير محدد";
        if (p.client?.name) {
          const parsedName =
            typeof p.client.name === "string"
              ? JSON.parse(p.client.name)
              : p.client.name;
          clientName = parsedName.ar || "غير محدد";
        }

        return {
          id: p.id,
          deedNumber: p.deedNumber || "لا يوجد صك",
          owner: clientName,
          type: p.city ? `صك بمدينة ${p.city}` : "غير محدد",
          district: p.districtNode?.name || "غير محدد", // 👈 من العلاقة
          street: p.planNumber || "غير محدد",
          area: p.area ? p.area.toLocaleString("ar-SA") : "0",
          status: p.status === "Active" ? "مسجلة" : "معلقة",
          lastUpdate: p.updatedAt.toISOString().split("T")[0],
        };
      });

      return res.json(formattedData);
    }

    // ===============================================
    // 👥 4. تاب العملاء (Clients)
    // ===============================================
    if (tab === "clients") {
      const clients = await prisma.client.findMany({
        where: {
          ownerships: { some: ownershipWhere }, // 👈 استخدام الفلتر المباشر بكل قوة
        },
        include: {
          _count: { select: { transactions: true } },
          transactions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
          ownerships: {
            select: { districtNode: { select: { name: true } } },
            take: 1,
          }, // لمعرفة الحي
        },
        take: 50,
      });

      const formattedData = clients.map((c) => {
        let clientName = "غير محدد";
        if (c.name) {
          const parsedName =
            typeof c.name === "string" ? JSON.parse(c.name) : c.name;
          clientName = parsedName.ar || c.officialNameAr || "غير محدد";
        }

        return {
          id: c.id,
          name: clientName,
          code: c.clientCode,
          district: c.ownerships[0]?.districtNode?.name || "متعدد", // 👈 اسم الحي من أول ملكية
          sector: type === "sector" ? "القطاع المحدد" : "قطاع الرياض",
          txCount: c._count.transactions,
          lastTxDate:
            c.transactions.length > 0
              ? c.transactions[0].createdAt.toISOString().split("T")[0]
              : "لا يوجد",
          source: c.category || "مباشر",
          phone: c.mobile || "غير متوفر",
        };
      });

      return res.json(formattedData);
    }
    // ===============================================
    // 🛣️ 5. تاب الشوارع (Streets) الحقيقية
    // ===============================================
    if (tab === "streets") {
      const streets = await prisma.riyadhStreet.findMany({
        where: type === "sector" ? { sectorId: id } : { districtId: id },
        orderBy: { createdAt: "desc" },
      });
      return res.json(streets);
    }

    // ===============================================
    // 📂 6. تاب الوسائط والملفات (Media) الحقيقية
    // ===============================================
    if (tab === "media") {
      const attachments = await prisma.attachment.findMany({
        where: type === "sector" ? { sectorId: id } : { districtId: id },
        include: { uploadedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });

      const formattedMedia = attachments.map((att) => ({
        id: att.id,
        name: att.fileName,
        type: att.fileType.includes("pdf")
          ? "PDF"
          : att.fileType.includes("image")
            ? "صورة"
            : "ملف",
        size: (att.fileSize / (1024 * 1024)).toFixed(2), // بالميجا بايت
        date: att.createdAt.toISOString().split("T")[0],
        source: att.uploadedBy?.name || "النظام",
        url: att.filePath,
      }));
      return res.json(formattedMedia);
    }

    // ===============================================
    // 📝 7. تاب الملاحظات والاشتراطات والسجل
    // ===============================================
    const nodeData =
      type === "sector"
        ? await prisma.riyadhSector.findUnique({
            where: { id },
            select: { notes: true, regulations: true, auditLogs: true },
          })
        : await prisma.riyadhDistrict.findUnique({
            where: { id },
            select: { notes: true, regulations: true, auditLogs: true },
          });

    if (tab === "notes") return res.json(nodeData?.notes || []);
    if (tab === "regulations") return res.json(nodeData?.regulations || []);
    if (tab === "audit") return res.json(nodeData?.auditLogs || []);
    res.json([]);
  } catch (error) {
    console.error("Node Details Error:", error);
    res.status(500).json({ message: "فشل جلب التفاصيل", error: error.message });
  }
};

// إضافة ملاحظة أو اشتراط أو ملف
const addNodeDetail = async (req, res) => {
  try {
    const { type, id, tab } = req.params; // tab = 'notes' أو 'regulations'
    const payload = req.body;

    const model =
      type === "sector" ? prisma.riyadhSector : prisma.riyadhDistrict;
    const currentNode = await model.findUnique({
      where: { id },
      select: { [tab]: true, auditLogs: true },
    });

    const currentList = Array.isArray(currentNode[tab]) ? currentNode[tab] : [];
    const newList = [
      {
        id: Date.now().toString(),
        ...payload,
        createdAt: new Date().toISOString(),
      },
      ...currentList,
    ];

    // تسجيل العملية في سجل التدقيق (Audit Log)
    const currentAudit = Array.isArray(currentNode.auditLogs)
      ? currentNode.auditLogs
      : [];
    const newAudit = [
      {
        id: Date.now().toString(),
        user: req.user?.name || "مدير النظام",
        action: tab === "notes" ? "إضافة ملاحظة" : "إضافة اشتراط",
        newValue: payload.title || payload.type,
        date: new Date().toLocaleString("ar-SA"),
      },
      ...currentAudit,
    ];

    await model.update({
      where: { id },
      data: { [tab]: newList, auditLogs: newAudit },
    });

    res.json({ message: "تمت الإضافة بنجاح" });
  } catch (error) {
    res.status(500).json({ message: "حدث خطأ", error: error.message });
  }
};

// ===================================================
// 19. رفع الملفات والوسائط (Media Upload)
// ===================================================
const uploadMedia = async (req, res) => {
  try {
    const { sectorId, districtId } = req.body;
    const file = req.file; // هذا الملف القادم من multer

    if (!file) {
      return res.status(400).json({ message: "لم يتم إرفاق أي ملف" });
    }

    // 💡 ملحوظة: جدول Attachment يتطلب uploadedById (رقم الموظف)
    // إذا لم يكن لديك نظام تسجيل دخول (Auth) يعمل حالياً، سنجلب أول موظف من الداتابيز لتجنب الأخطاء
    let uploaderId = req.user?.id;
    if (!uploaderId) {
      const defaultEmployee = await prisma.employee.findFirst();
      if (!defaultEmployee) {
        return res
          .status(400)
          .json({ message: "لا يوجد أي موظف مسجل في النظام لربط الملف به!" });
      }
      uploaderId = defaultEmployee.id;
    }

    // إنشاء السجل في قاعدة البيانات
    const newAttachment = await prisma.attachment.create({
      data: {
        fileName: file.originalname,
        filePath: `/uploads/media/${file.filename}`, // المسار الذي سيتم عرضه في الفرونت إند
        fileType: file.mimetype,
        fileSize: file.size,
        uploadedById: uploaderId, // الموظف الذي قام بالرفع
        sectorId: sectorId || null, // ربط بالقطاع إذا تم التمرير
        districtId: districtId || null, // ربط بالحي إذا تم التمرير
      },
    });

    res.status(201).json({ message: "تم الرفع بنجاح", data: newAttachment });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ message: "فشل حفظ الملف", error: error.message });
  }
};

// ==========================================
// جلب تفاصيل القطع المرتبطة بمخطط معين والمشاريع المقامة عليها
// ==========================================
const getPlanPlotsDetails = async (req, res) => {
  try {
    const { id } = req.params; // id الخاص بالمخطط

    // 🚀 التعديل الجذري: البحث في جدول القطع الرئيسي (RiyadhPlanPlot) بدلاً من الجدول الوسيط
    const plots = await prisma.riyadhPlanPlot.findMany({
      where: {
        planId: id, // جلب جميع القطع التابعة لهذا المخطط
      },
      include: {
        // جلب المشاريع المرتبطة بهذه القطعة عبر الجدول الوسيط
        projectPlots: {
          include: {
            project: {
              select: {
                id: true,
                clientId: true,
                licenseNumber: true,
                licenseHijriYear: true,
                requestNumber: true,
                requestYear: true,
                ownerName: true,
                archiveCode: true,
              },
            },
          },
        },
      },
      orderBy: {
        plotNumber: "asc", // الترتيب تصاعدياً حسب رقم القطعة
      },
    });

    // 💡 إعادة صياغة البيانات بشكل مسطح (Flat) لتناسب الفرونت إند كما كان متوقعاً سابقاً
    const formattedPlots = [];
    
    plots.forEach(plotRecord => {
      if (plotRecord.projectPlots && plotRecord.projectPlots.length > 0) {
        // إذا كان هناك مشاريع مرتبطة بالقطعة
        plotRecord.projectPlots.forEach(pp => {
          if (pp.project) {
            formattedPlots.push({
              plotId: plotRecord.id,
              plotNumber: plotRecord.plotNumber,
              plotCode: plotRecord.plotCode,
              project: pp.project
            });
          }
        });
      } else {
        // إذا كانت القطعة مسجلة ولكن لا يوجد عليها مشروع حالياً
        formattedPlots.push({
          plotId: plotRecord.id,
          plotNumber: plotRecord.plotNumber,
          plotCode: plotRecord.plotCode,
          project: null
        });
      }
    });

    res.status(200).json(formattedPlots);

  } catch (error) {
    console.error("Plots Details Error:", error);
    res.status(500).json({ success: false, message: "فشل جلب بيانات القطع", error: error.message });
  }
};

// ==========================================
// 🚀 جلب إحصائيات المخطط (Overview Stats)
// ==========================================
const getPlanStats = async (req, res) => {
  try {
    const { planNumber } = req.query;

    if (!planNumber) {
      return res.status(400).json({ success: false, message: "رقم المخطط مطلوب." });
    }

    // 1. البحث عن المخطط وجلب أعداد العلاقات الصحيحة من الجداول الجديدة
    const plan = await prisma.riyadhPlan.findFirst({
      where: { planNumber: planNumber },
      include: {
        _count: {
          select: {
            RiyadhPlanPlot: true, // 👈 جلب عدد القطع من الجدول الرئيسي الجديد للقطع
            projects: true,       // 👈 جلب عدد المشاريع (الرخص) المرتبطة بالمخطط
          }
        }
      }
    });

    if (!plan) {
      return res.status(404).json({ success: false, message: "المخطط غير موجود." });
    }

    // 2. جلب المشاريع المرتبطة بهذا المخطط لحساب تفاصيل إضافية (مثل نوع المشاريع)
    const projects = await prisma.archivedProject.findMany({
      where: { planId: plan.id },
      select: { projectType: true, totalArea: true }
    });

    // 3. حساب بعض الإحصائيات الذكية
    let residentialCount = 0;
    let commercialCount = 0;
    let totalProjectsArea = 0;

    projects.forEach(p => {
      if (p.projectType && p.projectType.includes("سكني")) residentialCount++;
      if (p.projectType && p.projectType.includes("تجاري")) commercialCount++;
      totalProjectsArea += Number(p.totalArea) || 0;
    });

    // 4. بناء كائن الإحصائيات النهائي
    const stats = {
      planAreaM: plan.areaM || 0, // مساحة المخطط الإجمالية
      totalPlotsExpected: plan.totalPlots || 0, // عدد القطع المدخل يدوياً في معلومات المخطط
      registeredPlots: plan._count?.RiyadhPlanPlot || 0, // القطع المسجلة فعلياً في النظام
      totalProjects: plan._count?.projects || 0, // المعاملات المؤرشفة
      residentialCount,
      commercialCount,
      totalProjectsArea,
    };

    return res.status(200).json({ success: true, data: stats });

  } catch (error) {
    console.error("🔥 Stats Overview Error:", error);
    return res.status(500).json({ success: false, message: "حدث خطأ داخلي أثناء حساب الإحصائيات." });
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
  getNodeDetails,
  addNodeDetail,
  uploadMedia,
  getPlanPlotsDetails,
  getPlanStats,
};

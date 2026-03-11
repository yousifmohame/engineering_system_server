// src/controllers/riyadhZoneController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 1. جلب جميع القطاعات مع أحيائها
const getRiyadhZones = async (req, res) => {
  try {
    const sectors = await prisma.riyadhSector.findMany({
      include: {
        districts: true, // جلب الأحياء التابعة لكل قطاع
      },
    });
    res.json({ success: true, data: sectors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. إضافة حي جديد من الشاشة مباشرة
const addDistrict = async (req, res) => {
  try {
    const { name, sectorId } = req.body;

    if (!name || !sectorId) {
      return res.status(400).json({ success: false, message: "اسم الحي والقطاع مطلوبان" });
    }

    const cleanName = name.trim();

    // 1. التحقق من عدم تكرار الاسم في النظام بأكمله
    const existingDistrictByName = await prisma.riyadhDistrict.findFirst({
      where: { name: cleanName }
    });

    if (existingDistrictByName) {
      return res.status(400).json({ success: false, message: "هذا الحي مسجل مسبقاً في النظام." });
    }

    // 2. توليد الكود التلقائي (يكمل العد بأمان من آخر كود على مستوى النظام)
    let nextNumber = await prisma.riyadhDistrict.count() + 1;
    let autoCode = `NBH-${String(nextNumber).padStart(3, "0")}`;

    // 💡 حلقة تحقق تضمن أن الكود غير مستخدم نهائياً لتفادي أخطاء الحذف السابق
    let isCodeExists = await prisma.riyadhDistrict.findUnique({ where: { code: autoCode } });
    while (isCodeExists) {
      nextNumber++;
      autoCode = `NBH-${String(nextNumber).padStart(3, "0")}`;
      isCodeExists = await prisma.riyadhDistrict.findUnique({ where: { code: autoCode } });
    }

    // 3. إنشاء الحي
    const newDistrict = await prisma.riyadhDistrict.create({
      data: {
        name: cleanName,
        code: autoCode,
        sectorId: sectorId,
      }
    });

    res.json({ success: true, data: newDistrict });
  } catch (error) {
    console.error("Error adding district:", error);
    // في حال حدث تعارض في البيانات بوقت واحد
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: "تعارض في البيانات، الحي أو الكود مسجل مسبقاً." });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteDistrict = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.riyadhDistrict.delete({ where: { id } });
    res.json({ success: true, message: "تم حذف الحي" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getRiyadhZones, addDistrict, deleteDistrict };
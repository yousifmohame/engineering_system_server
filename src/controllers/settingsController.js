const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();


// جلب الإعدادات
const getSettings = async (req, res) => {
  try {
    let settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.systemSettings.create({ data: { id: 1 } });
    }
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// تحديث الإعدادات الشامل
const updateSettings = async (req, res) => {
  try {
    const data = req.body;

    const settings = await prisma.systemSettings.upsert({
      where: { id: 1 },
      update: {
        companyName: data.companyName,
        taxNumber: data.taxNumber,
        currency: data.currency,
        timezone: data.timezone,
        warningDays: data.warningDays ? parseInt(data.warningDays) : undefined,
        overdueDays: data.overdueDays ? parseInt(data.overdueDays) : undefined,
        taxEstimateEnabled: data.taxEstimateEnabled,
        taxPercentage: data.taxPercentage
          ? parseFloat(data.taxPercentage)
          : undefined,
        taxApplyTo: data.taxApplyTo,
        taxExclude: data.taxExclude, // Json
        taxNotes: data.taxNotes,
        officeShareType: data.officeShareType,
        officeShareValue: data.officeShareValue
          ? parseFloat(data.officeShareValue)
          : undefined,
        officeShareCategories: data.officeShareCategories, // Json
        officeShareManual: data.officeShareManual,
        officeShareManualVal: data.officeShareManualVal
          ? parseFloat(data.officeShareManualVal)
          : undefined,
        specialAccounts: data.specialAccounts, // Json
      },
      create: { id: 1, ...data },
    });

    res.json({
      success: true,
      message: "تم تحديث الإعدادات بنجاح",
      data: settings,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSidebarSettings = async (req, res) => {
  try {
    let settings = await prisma.sidebarSettings.findUnique({
      where: { id: 1 }
    });

    // إذا لم يكن هناك إعدادات مسبقة، قم بإنشاء الإعدادات الافتراضية
    if (!settings) {
      settings = await prisma.sidebarSettings.create({
        data: { id: 1 }
      });
    }

    res.json(settings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "فشل جلب إعدادات القائمة الجانبية" });
  }
};

// تحديث إعدادات القائمة الجانبية
const updateSidebarSettings = async (req, res) => {
  try {
    // 💡 استخراج الحقول بدقة لمنع بريسما من محاولة تحديث الـ id
    const { bgColor, textColor, activeColor, width, logoUrl, categoryOrder, customLabels, itemOrder } = req.body;
    
    const updatedSettings = await prisma.sidebarSettings.upsert({
      where: { id: 1 },
      update: {
        bgColor,
        textColor,
        activeColor,
        width: parseInt(width) || 280, // ضمان تحويله لرقم
        logoUrl,
        categoryOrder: categoryOrder || [],
        customLabels: customLabels || {},
        itemOrder: itemOrder || {}
      },
      create: { 
        id: 1, 
        bgColor: bgColor || "#293241", 
        textColor: textColor || "#cbd5e1", 
        activeColor: activeColor || "#2563eb", 
        width: parseInt(width) || 280, 
        logoUrl: logoUrl || "/logo.jpeg",
        categoryOrder: categoryOrder || [],
        customLabels: customLabels || {},
        itemOrder: itemOrder || {}
      }
    });

    res.json(updatedSettings);
  } catch (error) {
    console.error("خطأ في حفظ إعدادات المظهر:", error);
    res.status(500).json({ error: "فشل تحديث إعدادات القائمة الجانبية", details: error.message });
  }
};

module.exports = { getSettings, updateSettings, getSidebarSettings, updateSidebarSettings };

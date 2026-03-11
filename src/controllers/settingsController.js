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

module.exports = { getSettings, updateSettings };

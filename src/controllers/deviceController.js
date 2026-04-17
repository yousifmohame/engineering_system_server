const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

exports.getDevices = async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      orderBy: { createdAt: 'desc' }
    });
    
    // تنسيق التواريخ لتناسب الواجهة
    const formattedDevices = devices.map(dev => ({
      ...dev,
      purchaseDate: dev.purchaseDate ? dev.purchaseDate.toISOString().split('T')[0] : '',
      nextMaintenanceDate: dev.nextMaintenanceDate ? dev.nextMaintenanceDate.toISOString().split('T')[0] : '',
      warrantyEnd: dev.warrantyEnd ? dev.warrantyEnd.toISOString().split('T')[0] : '',
    }));

    res.json({ success: true, data: formattedDevices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createDevice = async (req, res) => {
  try {
    const data = req.body;
    
    // إنشاء كود تلقائي للجهاز DEV-XXX
    const count = await prisma.device.count();
    const deviceCode = `DEV-${String(count + 1).padStart(3, '0')}`;

    const newDevice = await prisma.device.create({
      data: {
        deviceCode,
        type: data.type,
        name: data.name,
        brand: data.brand,
        model: data.model,
        serialNumber: data.serialNumber,
        status: data.status,
        location: data.location,
        assignedTo: data.assignedTo,
        purchasePrice: data.purchasePrice,
        vendor: data.vendor,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        warrantyEnd: data.warrantyEnd ? new Date(data.warrantyEnd) : null,
        specs: data.specs || {},
        network: data.network || {},
        maintenanceHistory: [],
        consumables: [],
        customFields: [],
        aiInsights: { 
          healthScore: 100, 
          maintenancePrediction: 'جهاز جديد، يعمل بكفاءة', 
          anomalies: [] 
        }
      }
    });
    res.status(201).json({ success: true, data: newDevice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateDevice = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updatedDevice = await prisma.device.update({
      where: { id },
      data: {
        ...data,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        nextMaintenanceDate: data.nextMaintenanceDate ? new Date(data.nextMaintenanceDate) : null,
        warrantyEnd: data.warrantyEnd ? new Date(data.warrantyEnd) : null,
      }
    });

    res.json({ success: true, data: updatedDevice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteDevice = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.device.delete({ where: { id } });
    res.json({ success: true, message: "تم حذف الجهاز بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.uploadAttachment = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "لم يتم استلام أي ملف" });
    }

    // بناء الرابط الذي سيتم حفظه في قاعدة البيانات
    // سيتم حفظه بصيغة /uploads/devices/filename.pdf
    const fileUrl = `/uploads/devices/${req.file.filename}`;

    // نرجع الرابط للفرونت إند ليقوم بحفظه مع بيانات الجهاز
    res.json({ success: true, url: fileUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل رفع الملف: " + error.message });
  }
};
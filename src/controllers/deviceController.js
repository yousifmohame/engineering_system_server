const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");

// 💡 1. استيراد الطابور الموحد (تأكد من المسار حسب هيكلة مجلداتك)
const { aiQueue } = require("../queue/aiQueue"); 

exports.getDevices = async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      orderBy: { createdAt: "desc" },
    });

    const formattedDevices = devices.map((dev) => ({
      ...dev,
      purchaseDate: dev.purchaseDate ? dev.purchaseDate.toISOString().split("T")[0] : "",
      nextMaintenanceDate: dev.nextMaintenanceDate ? dev.nextMaintenanceDate.toISOString().split("T")[0] : "",
      warrantyEnd: dev.warrantyEnd ? dev.warrantyEnd.toISOString().split("T")[0] : "",
    }));

    res.json({ success: true, data: formattedDevices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createDevice = async (req, res) => {
  try {
    const data = req.body;
    const count = await prisma.device.count();
    const deviceCode = `DEV-${String(count + 1).padStart(3, "0")}`;

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
        depreciationRate: data.depreciationRate,
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
          maintenancePrediction: "جهاز جديد، يعمل بكفاءة",
          anomalies: [],
        },
      },
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
      },
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
    if (!req.file) return res.status(400).json({ success: false, message: "لم يتم استلام أي ملف" });
    const fileUrl = `/uploads/devices/${req.file.filename}`;
    res.json({ success: true, url: fileUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل رفع الملف: " + error.message });
  }
};

// =========================================================================
// 🚀 الذكاء الاصطناعي: استخراج المواصفات والماك أدريس (تم نقل المعالجة للطابور)
// =========================================================================
exports.extractSpecsFromImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "الرجاء إرفاق صورة المواصفات" });
    }

    // 💡 يجب إرسال deviceId من الواجهة لكي نعرف أي جهاز نُحدثه في الداتا بيز
    const { deviceId } = req.body; 
    if (!deviceId) {
      // إذا فشل العميل في إرسال الـ ID، نمسح الصورة المرفوعة لتوفير المساحة
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: "معرف الجهاز (deviceId) مطلوب لتحديث بياناته." });
    }

    const employeeId = req.user?.id; // من التوكن (لمعرفة من أرسل الطلب)

    // 1. إنشاء سجل في جدول AiJob لكي يتتبعه المستخدم كشريط تحميل (Progress Bar)
    const newAiJob = await prisma.aiJob.create({
      data: {
        jobType: "EXTRACT_DEVICE_SPECS",
        status: "PENDING",
        progress: 0,
        createdBy: employeeId || "SYSTEM",
      }
    });

    // 2. إرسال المهمة للطابور المركزي
    await aiQueue.add("extract-device-specs", {
      jobType: "EXTRACT_DEVICE_SPECS",
      dbJobId: newAiJob.id,
      deviceId: deviceId,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      employeeId: employeeId
    });

    const imageUrl = `/uploads/devices/${req.file.filename}`;

    // 3. الرد فوراً (202 Accepted) لكي تُغلق النافذة في الواجهة ويكمل المستخدم عمله
    res.status(202).json({ 
      success: true, 
      message: "بدأت عملية تحليل صورة الجهاز في الخلفية. سيصلك إشعار فور اكتمالها.",
      jobId: newAiJob.id,
      imageUrl: imageUrl 
    });

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error("Device Specs Queue Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCategories = async (req, res) => {
  try {
    const categories = await prisma.deviceCategory.findMany({ orderBy: { createdAt: "asc" } });
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addCategory = async (req, res) => {
  try {
    const { label, value } = req.body;
    const newCategory = await prisma.deviceCategory.create({ data: { label, value } });
    res.status(201).json({ success: true, data: newCategory });
  } catch (error) {
    if (error.code === "P2002") return res.status(400).json({ success: false, message: "التصنيف موجود مسبقاً" });
    res.status(500).json({ success: false, message: error.message });
  }
};
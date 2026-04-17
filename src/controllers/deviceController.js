const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); // تأكد من وجود المفتاح في .env

exports.getDevices = async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      orderBy: { createdAt: 'desc' }
    });
    
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
        depreciationRate: data.depreciationRate, // 💡 حفظ معدل الإهلاك
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

// 🚀 رفع مرفقات الفواتير والضمان
exports.uploadAttachment = (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "لم يتم استلام أي ملف" });
    const fileUrl = `/uploads/devices/${req.file.filename}`;
    res.json({ success: true, url: fileUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل رفع الملف: " + error.message });
  }
};

// 🚀 الذكاء الاصطناعي: استخراج المواصفات من صورة
exports.extractSpecsFromImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "الرجاء إرفاق صورة المواصفات" });

    console.log("🤖 جاري تحليل صورة مواصفات الجهاز...");

    // تحويل الصورة إلى Base64 لقرائتها عبر Gemini
    const fileBytes = fs.readFileSync(req.file.path).toString("base64");
    
    const promptInstruction = `
      قم بتحليل هذه الصورة التي تحتوي على مواصفات جهاز كمبيوتر أو لابتوب.
      استخرج البيانات التالية بدقة شديدة وقم بإرجاعها ككائن JSON حصرياً (بدون أي نصوص إضافية أو علامات Markdown).
      المفاتيح المطلوبة في الـ JSON هي:
      {
        "cpu": "اسم المعالج بدقة",
        "ram": "سعة الذاكرة العشوائية",
        "storage": "سعة ونوع التخزين (إن وجد)",
        "gpu": "كرت الشاشة (إن وجد)",
        "os": "نظام التشغيل (إن وجد)"
      }
      إذا لم تجد معلومة معينة، اترك قيمتها فارغة "".
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: fileBytes, mimeType: req.file.mimetype } },
            { text: promptInstruction }
          ]
        }
      ],
      config: { temperature: 0.1, responseMimeType: "application/json" }
    });

    const cleanJson = response.text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const specsData = JSON.parse(cleanJson);

    // حذف الصورة بعد معالجتها لتوفير المساحة
    fs.unlinkSync(req.file.path);

    res.json({ success: true, data: specsData });
  } catch (error) {
    console.error("AI Specs Extraction Error:", error);
    // تنظيف الصورة في حالة الخطأ
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: "فشل الذكاء الاصطناعي في قراءة الصورة" });
  }
};

// جلب التصنيفات المخصصة
exports.getCategories = async (req, res) => {
  try {
    const categories = await prisma.deviceCategory.findMany({
      orderBy: { createdAt: 'asc' }
    });
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// إضافة تصنيف جديد
exports.addCategory = async (req, res) => {
  try {
    const { label, value } = req.body;
    const newCategory = await prisma.deviceCategory.create({
      data: { label, value }
    });
    res.status(201).json({ success: true, data: newCategory });
  } catch (error) {
    // التحقق إذا كان التصنيف موجود مسبقاً
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: "هذا التصنيف موجود مسبقاً" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};
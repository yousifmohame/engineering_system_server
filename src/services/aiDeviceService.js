// src/services/aiDeviceService.js
const fs = require("fs");
const { GoogleGenAI } = require("@google/genai");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.processDeviceImageJob = async (jobData, updateProgress) => {
  const { deviceId, filePath, mimeType } = jobData;

  try {
    await updateProgress(10); // بدأت العملية

    // تحويل الصورة إلى Base64
    const fileBytes = fs.readFileSync(filePath).toString("base64");
    await updateProgress(30);

    const promptInstruction = `
      قم بتحليل هذه الصورة التي تحتوي على مواصفات جهاز كمبيوتر، لابتوب، أو معدات شبكة.
      استخرج البيانات التالية بدقة شديدة وقم بإرجاعها ككائن JSON حصرياً (بدون Markdown):
      {
        "cpu": "اسم المعالج بدقة",
        "ram": "سعة الذاكرة العشوائية",
        "storage": "سعة ونوع التخزين",
        "gpu": "كرت الشاشة",
        "os": "نظام التشغيل",
        "macAddresses": ["الماك أدريس الأول", "الماك أدريس الثاني"]
      }
      إذا لم تجد معلومة معينة، اترك قيمتها فارغة "".
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          { inlineData: { data: fileBytes, mimeType: mimeType } },
          { text: promptInstruction },
        ],
      }],
      config: { temperature: 0.1, responseMimeType: "application/json" },
    });

    const cleanJson = response.text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const specsData = JSON.parse(cleanJson);
    
    await updateProgress(70); // تمت الترجمة بنجاح، جاري التحديث

    // 💡 1. جلب الجهاز القديم لكي ندمج البيانات الجديدة مع القديمة (Merge) ولا نمسح ما تم إدخاله يدوياً
    const existingDevice = await prisma.device.findUnique({
      where: { id: deviceId }
    });

    if (!existingDevice) {
      throw new Error(`الجهاز برقم ${deviceId} غير موجود في قاعدة البيانات.`);
    }

    const currentSpecs = typeof existingDevice.specs === 'object' && existingDevice.specs !== null ? existingDevice.specs : {};
    const currentNetwork = typeof existingDevice.network === 'object' && existingDevice.network !== null ? existingDevice.network : {};

    // 💡 2. تحديث الحقول بذكاء (الاحتفاظ بالبيانات القديمة إذا لم يجد الذكاء الاصطناعي شيئاً جديداً)
    const newSpecs = {
      ...currentSpecs,
      cpu: specsData.cpu || currentSpecs.cpu || "",
      ram: specsData.ram || currentSpecs.ram || "",
      storage: specsData.storage || currentSpecs.storage || "",
      gpu: specsData.gpu || currentSpecs.gpu || "",
      os: specsData.os || currentSpecs.os || "",
    };

    const newNetwork = {
      ...currentNetwork,
      macAddresses: (specsData.macAddresses && specsData.macAddresses.length > 0) ? specsData.macAddresses : (currentNetwork.macAddresses || []),
    };

    // 💡 3. حفظ التحديثات في الداتا بيز
    await prisma.device.update({
      where: { id: deviceId },
      data: {
        specs: newSpecs,
        network: newNetwork
      },
    });

    await updateProgress(95);

    return { success: true, message: "تم تحديث مواصفات الجهاز بنجاح." };

  } catch (error) {
    console.error("❌ [AI Device Service Error]:", error.message);
    throw error;
  }
};
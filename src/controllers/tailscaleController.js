// src/controllers/tailscaleController.js
const { PrismaClient } = require("@prisma/client");
const axios = require("axios"); // تأكد من تثبيت axios في الباك إند
const prisma = new PrismaClient();

// 1. جلب إعدادات Tailscale
exports.getConfig = async (req, res) => {
  try {
    const config = await prisma.tailscaleConfig.findFirst();
    if (!config) {
      return res.json({ success: true, data: null });
    }
    
    // 🔒 أمان: لا نرسل المفتاح الحقيقي للفرونت إند، بل نرسل مؤشر على وجوده
    res.json({
      success: true,
      data: {
        id: config.id,
        tailnet: config.tailnet,
        isActive: config.isActive,
        hasKey: !!config.apiKey, // true إذا كان هناك مفتاح محفوظ
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. حفظ أو تحديث الإعدادات
exports.saveConfig = async (req, res) => {
  try {
    const { tailnet, apiKey, isActive } = req.body;

    let config = await prisma.tailscaleConfig.findFirst();

    const dataToSave = {
      tailnet,
      isActive,
    };

    // نحدث المفتاح فقط إذا أرسل المستخدم مفتاحاً جديداً
    if (apiKey && apiKey.trim() !== "") {
      dataToSave.apiKey = apiKey;
    }

    if (config) {
      config = await prisma.tailscaleConfig.update({
        where: { id: config.id },
        data: dataToSave,
      });
    } else {
      config = await prisma.tailscaleConfig.create({
        data: dataToSave,
      });
    }

    res.json({ success: true, message: "تم حفظ إعدادات Tailscale بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. اختبار الاتصال الفعلي مع Tailscale API
exports.testConnection = async (req, res) => {
  try {
    const config = await prisma.tailscaleConfig.findFirst();
    
    if (!config || !config.apiKey || !config.tailnet) {
      return res.status(400).json({ success: false, message: "بيانات Tailscale غير مكتملة." });
    }

    // Tailscale API يستخدم Basic Auth حيث يكون اليوزر هو الـ API Key والباسوورد فارغ
    const authHeader = Buffer.from(`${config.apiKey}:`).toString('base64');

    // طلب قائمة الأجهزة (Devices) في الشبكة كاختبار للاتصال
    const response = await axios.get(
      `https://api.tailscale.com/api/v2/tailnet/${config.tailnet}/devices`,
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
        },
      }
    );

    res.json({ 
      success: true, 
      message: "تم الاتصال بنجاح!", 
      devicesCount: response.data.devices?.length || 0 
    });
  } catch (error) {
    console.error("Tailscale Connection Error:", error.response?.data || error.message);
    res.status(401).json({ 
      success: false, 
      message: "فشل الاتصال: تأكد من صحة المفتاح واسم الـ Tailnet." 
    });
  }
};

// في ملف tailscaleController.js
exports.getProvisioningCommand = async (req, res) => {
  try {
    // 🛡️ حماية 1: التحقق من الـ Token السري في الرابط
    // مثال: يجب أن يكون الرابط /api/tailscale/provision?token=my_super_secret_123
    const PROVISION_TOKEN = process.env.PROVISION_TOKEN || "my_super_secret_01003625969"; 
    if (req.query.token !== PROVISION_TOKEN) {
      return res.status(403).send("echo 'Access Denied: Invalid Token'; exit 1;");
    }

    const config = await prisma.tailscaleConfig.findFirst();
    if (!config || !config.authKey) {
      return res.status(404).send("echo 'No Auth Key found in database'; exit 1;");
    }

    // 🛡️ حماية 2: تنظيف الـ Auth Key (Sanitization)
    // مفاتيح Tailscale تحتوي فقط على حروف وأرقام وعلامة الناقص (tskey-auth-...)
    // نمنع أي رموز أخرى (مثل الفواصل المنقوطة ;) لمنع ثغرة Command Injection
    const safeAuthKey = config.authKey.trim();
    if (!/^[a-zA-Z0-9-]+$/.test(safeAuthKey)) {
        return res.status(400).send("echo 'Security Alert: Invalid Key Format'; exit 1;");
    }

    // نرسل الأمر كاملاً جاهزاً للتنفيذ
    const command = `sudo tailscale up --authkey=${safeAuthKey} --accept-routes`;
    res.send(command);
  } catch (error) {
    res.status(500).send(`echo 'Server Error: ${error.message}'; exit 1;`);
  }
};
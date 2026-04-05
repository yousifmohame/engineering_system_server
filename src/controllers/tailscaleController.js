// src/controllers/tailscaleController.js
const { PrismaClient } = require("@prisma/client");
const axios = require("axios"); // تأكد من تثبيت axios في الباك إند
const prisma = new PrismaClient();
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

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
        hasKey: !!config.apiKey, // true إذا كان هناك API Key
        hasAuthKey: !!config.authKey, // 💡 true إذا كان هناك Auth Key
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// 2. حفظ أو تحديث الإعدادات
exports.saveConfig = async (req, res) => {
  try {
    // 💡 1. أضفنا authKey هنا لاستلامه من الفرونت إند
    const { tailnet, apiKey, authKey, isActive } = req.body;

    let config = await prisma.tailscaleConfig.findFirst();

    const dataToSave = {
      tailnet,
      isActive,
    };

    // نحدث مفتاح API فقط إذا أرسل المستخدم مفتاحاً جديداً
    if (apiKey && apiKey.trim() !== "") {
      dataToSave.apiKey = apiKey;
    }

    // 💡 2. نحدث مفتاح الربط Auth Key فقط إذا أرسل المستخدم مفتاحاً جديداً
    if (authKey && authKey.trim() !== "") {
      dataToSave.authKey = authKey;
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
      return res
        .status(400)
        .json({ success: false, message: "بيانات Tailscale غير مكتملة." });
    }

    // Tailscale API يستخدم Basic Auth حيث يكون اليوزر هو الـ API Key والباسوورد فارغ
    const authHeader = Buffer.from(`${config.apiKey}:`).toString("base64");

    // طلب قائمة الأجهزة (Devices) في الشبكة كاختبار للاتصال
    const response = await axios.get(
      `https://api.tailscale.com/api/v2/tailnet/${config.tailnet}/devices`,
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
        },
      },
    );

    res.json({
      success: true,
      message: "تم الاتصال بنجاح!",
      devicesCount: response.data.devices?.length || 0,
    });
  } catch (error) {
    console.error(
      "Tailscale Connection Error:",
      error.response?.data || error.message,
    );
    res.status(401).json({
      success: false,
      message: "فشل الاتصال: تأكد من صحة المفتاح واسم الـ Tailnet.",
    });
  }
};

// في ملف tailscaleController.js
exports.getProvisioningCommand = async (req, res) => {
  try {
    const PROVISION_TOKEN =
      process.env.PROVISION_TOKEN || "my_super_secret_01003625969";

    if (req.query.token !== PROVISION_TOKEN) {
      return res.send("echo 'Access Denied: Invalid Token'; exit 1;");
    }

    const config = await prisma.tailscaleConfig.findFirst();
    if (!config || !config.authKey) {
      return res.send("echo 'Error: No Auth Key found in database'; exit 1;");
    }

    const safeAuthKey = config.authKey.trim();
    const command = `sudo tailscale up --authkey=${safeAuthKey} --accept-routes`;
    res.send(command);
  } catch (error) {
    res.send(`echo 'Server Error: ${error.message}'; exit 1;`);
  }
};

// 4. جلب قائمة الأجهزة (Exit Nodes) من حسابك
exports.getDevices = async (req, res) => {
  try {
    const config = await prisma.tailscaleConfig.findFirst();
    if (!config || !config.apiKey) {
      return res.status(400).json({ success: false, message: "مفتاح API غير متوفر." });
    }

    const authHeader = Buffer.from(`${config.apiKey}:`).toString('base64');
    
    // استخدام علامة - تجعل Tailscale يتعرف على شبكتك تلقائياً
    const response = await axios.get(
      `https://api.tailscale.com/api/v2/tailnet/-/devices`,
      { headers: { Authorization: `Basic ${authHeader}` } }
    );

    // تنسيق البيانات لتصبح سهلة للفرونت إند
    const devices = response.data.devices.map(dev => ({
      id: dev.id,
      name: dev.hostname,
      ip: dev.addresses[0], // الـ IP الخاص بالجهاز داخل شبكة Tailscale
      os: dev.os,
      status: dev.clientStatus || "offline"
    }));

    res.json({ success: true, devices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. تعيين وإلغاء الـ Exit Node على السيرفر
exports.setExitNode = async (req, res) => {
  try {
    const { exitNodeIp } = req.body; // نستلم الـ IP من الفرونت إند

    let command;
    if (exitNodeIp) {
      // أمر تفعيل الـ Exit Node باستخدام الـ IP المختار
      command = `sudo tailscale set --exit-node=${exitNodeIp} --exit-node-allow-lan-access=true`;
    } else {
      // إذا أرسل قيمة فارغة، نلغي الـ Exit Node ليعود السيرفر للإنترنت العادي
      command = `sudo tailscale set --exit-node=`; 
    }

    // تنفيذ الأمر على نظام التشغيل Ubuntu
    await execPromise(command);

    res.json({ 
      success: true, 
      message: exitNodeIp ? `تم توجيه الإنترنت عبر الجهاز المختار بنجاح!` : "تم إلغاء توجيه الإنترنت (الوضع الطبيعي)." 
    });
  } catch (error) {
    console.error("Set Exit Node Error:", error);
    res.status(500).json({ success: false, message: "فشل في تغيير مسار الإنترنت. تأكد أن السيرفر يمتلك صلاحيات." });
  }
};
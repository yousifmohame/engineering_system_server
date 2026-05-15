// src/services/stampSecurityService.js
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. دالة توليد 8 أرقام عشوائية
const generate8DigitToken = () => {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
};

// 2. دالة توليد QR Code (الآن ستصبح المربعات كبيرة جداً وواضحة)
const generateQR = async (text) => {
  try {
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M', // حماية متوسطة تكفي جداً للروابط القصيرة
      margin: 1,
      scale: 10, // تكبير جودة الصورة
      color: { dark: '#1d3d75', light: '#ffffff' } 
    });
  } catch (err) {
    throw new Error('فشل توليد QR Code');
  }
};

// 3. دالة توليد Barcode (محسنة للقراءة السريعة)
const generateBarcode = async (text) => {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: "code128",
        text: text,
        scale: 3,
        height: 10,
        includetext: false,
        textxalign: "center",
      },
      function (err, png) {
        if (err) reject(err);
        else resolve("data:image/png;base64," + png.toString("base64"));
      },
    );
  });
};

// 4. الدالة الرئيسية
exports.generateSecureStampData = async (deviceId, deviceCode) => {
  // توليد رمز فريد من 4 حروف لهذه الطباعة (لدمجه في الباركود)
  const uniquePrintId = crypto.randomBytes(2).toString('hex').toUpperCase(); 
  const dynamicBarcodeText = `${deviceCode}-${uniquePrintId}`;

  // 💡 توليد توكن من 8 أرقام والتأكد من عدم تكراره في الداتا بيز
  let token = generate8DigitToken();
  let isUnique = false;
  while (!isUnique) {
    const exists = await prisma.deviceStamp.findUnique({ where: { token } });
    if (!exists) {
      isUnique = true;
    } else {
      token = generate8DigitToken(); // توليد رقم جديد إذا كان مكرراً
    }
  }

  // الرابط أصبح الآن قصيراً جداً جداً!
  const verifyUrl = `https://details-worksystem1.com/v/${token}`;

  // توليد الصور
  const qrBase64 = await generateQR(verifyUrl);
  const barcodeBase64 = await generateBarcode(dynamicBarcodeText);

  // 💡 حفظ التوكن (الـ 8 أرقام) في الداتا بيز لكي يتعرف عليه النظام عند الفحص
  await prisma.deviceStamp.create({
    data: {
      token: token,
      deviceId: deviceId,
      printId: uniquePrintId
    }
  });

  return {
    qrBase64,
    barcodeBase64,
    dynamicBarcodeText,
    token
  };
};
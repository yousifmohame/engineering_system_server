const QRCode = require('qrcode');

// =========================================================================
// 1. دالة لتوليد الصورة بصيغة Base64 SVG (للـ PDF)
// =========================================================================
const generateQRDataURL = async (text) => {
  try {
    const svgCode = await QRCode.toString(text, {
      type: 'svg',
      // 🚀 مستوى L أو M يجعل المربعات كبيرة جداً وواضحة في المسح
      errorCorrectionLevel: 'M', 
      margin: 1,
      color: {
        dark: '#123f59', // اللون الكحلي الخاص بهويتكم
        light: '#ffffff'
      }
    });

    const base64Svg = Buffer.from(svgCode).toString('base64');
    return `data:image/svg+xml;base64,${base64Svg}`;
  } catch (err) {
    console.error('QR Gen Error:', err);
    return null;
  }
};

// =========================================================================
// 2. دالة لتوليد الصورة كـ Buffer SVG (للفرونت إند والموبايل)
// =========================================================================
const generateQRBuffer = async (text) => {
  try {
    const svgCode = await QRCode.toString(text, {
      type: 'svg',
      // 🚀 نفس الإعداد لتكبير المربعات
      errorCorrectionLevel: 'M',
      margin: 1,
      color: {
        dark: '#123f59',
        light: '#ffffff'
      }
    });

    return Buffer.from(svgCode, 'utf-8');
  } catch (err) {
    console.error('QR Buffer Error:', err);
    return null;
  }
};

module.exports = { generateQRDataURL, generateQRBuffer };
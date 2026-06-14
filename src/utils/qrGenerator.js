const QRCode = require('qrcode');

// =========================================================================
// 1. دالة لتوليد الصورة بصيغة Base64 SVG (للـ PDF)
// =========================================================================
const generateQRDataURL = async (text) => {
  try {
    // 🚀 نستخدم PNG عالي الدقة بدلاً من SVG لأن Gotenberg يعشقه ولا يواجه معه مشاكل
    const qrDataUrl = await QRCode.toDataURL(text, {
      type: 'image/png',
      errorCorrectionLevel: 'M', 
      margin: 1,
      width: 500, // حجم كبير جداً لمنع البكسلة والخطوط الرمادية
      color: {
        dark: '#123f59', // اللون الكحلي الخاص بهويتكم
        light: '#ffffff'
      }
    });

    // سترجع الصيغة هكذا: data:image/png;base64,iVBORw0KGgo...
    return qrDataUrl; 
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
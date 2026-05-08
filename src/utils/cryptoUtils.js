// ملف: src/utils/cryptoUtils.js
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'MySuperSecretEncryptionKey1234567!'; // يجب أن يكون 32 حرفاً
const ALGORITHM = 'aes-256-cbc';

// دالة التشفير (تُنتج نصاً عشوائياً مختلفاً في كل مرة حتى لنفس المفتاح!)
exports.encrypt = (text) => {
  if (!text) return text;
  try {
    const iv = crypto.randomBytes(16); // توليد متجه عشوائي لكل عملية تشفير
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    // نحفظ الـ IV مع النص المشفر لنتمكن من فك تشفيره لاحقاً
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error("🔥 خطأ في التشفير:", error.message);
    return text;
  }
};

// دالة فك التشفير
exports.decrypt = (encryptedText) => {
  if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
  try {
    const textParts = encryptedText.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedData = textParts.join(':');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error("🔥 خطأ في فك التشفير:", error.message);
    return encryptedText; // إرجاع النص الأصلي إذا فشل الفك (حماية في حالة تغيير المفتاح الرئيسي)
  }
};
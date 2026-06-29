// convertFonts.js (سكربت مؤقت لتوليد الـ Base64)
const fs = require('fs');
const path = require('path');

// ضع أسماء ملفات الخطوط التي قمت بتنزيلها هنا
const fonts = ['Tajawal-Regular.ttf', 'Cairo-Regular.ttf', 'Almarai-Regular.ttf', 'Arial-Regular.ttf'];

let outputFileContent = `// src/utils/fontsBase64.js\n// هذا الملف يحتوي على الخطوط المشفرة لاستخدامها في توليد الـ PDF\n\nmodule.exports = {\n`;

fonts.forEach(fontName => {
  const fontPath = path.join(__dirname, 'temp_fonts', fontName);
  if (fs.existsSync(fontPath)) {
    const fontBuffer = fs.readFileSync(fontPath);
    const base64String = fontBuffer.toString('base64');
    // استخراج اسم الخط (مثلا Tajawal) ليكون مفتاحاً في الـ Object
    const keyName = fontName.split('-')[0].toLowerCase(); 
    outputFileContent += `  ${keyName}: "${base64String}",\n`;
    console.log(`✅ تم تحويل ${fontName} بنجاح!`);
  } else {
    console.log(`❌ لم يتم العثور على ${fontName}`);
  }
});

outputFileContent += `};\n`;
fs.writeFileSync(path.join(__dirname, 'src/utils/fontsBase64.js'), outputFileContent);
console.log('🎉 تم إنشاء ملف src/utils/fontsBase64.js بنجاح!');
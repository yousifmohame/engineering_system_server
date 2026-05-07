// ملف: src/utils/fileOptimizer.js
const sharp = require("sharp");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * دالة ذكية لضغط الملفات بناءً على مستوى الجودة المطلوب
 * @param {String} inputPath - مسار الملف الأصلي
 * @param {String} mimeType - نوع الملف
 * @param {String} level - مستوى الضغط: 'none', 'low', 'medium', 'high'
 * @returns {Promise<String>}
 */
exports.optimizeFile = (inputPath, mimeType, level = 'medium') => {
  return new Promise(async (resolve, reject) => {
    // 1. إذا كان المستخدم لا يريد الضغط، نرجع مسار الملف كما هو فوراً
    if (level === 'none') {
      return resolve(inputPath);
    }

    try {
      const ext = path.extname(inputPath);
      const dir = path.dirname(inputPath);
      const baseName = path.basename(inputPath, ext);
      const outputPath = path.join(dir, `${baseName}_optimized${ext}`);

      // ========================================================
      // إعدادات الضغط الديناميكية (Mapping)
      // ========================================================
      let imageQuality = 60; // الافتراضي
      let pdfSetting = '/ebook'; // الافتراضي

      switch (level) {
        case 'low': // جودة عالية، ضغط خفيف
          imageQuality = 80;
          pdfSetting = '/printer'; // جودة طباعة ممتازة (300 dpi)
          break;
        case 'medium': // توازن (موصى به)
          imageQuality = 60;
          pdfSetting = '/ebook'; // جودة شاشة ممتازة (150 dpi)
          break;
        case 'high': // أقصى ضغط، جودة منخفضة
          imageQuality = 40;
          pdfSetting = '/screen'; // جودة عادية (72 dpi) - أسرع رفع
          break;
      }

      // ========================================================
      // 2. معالجة الصور بذكاء (JPG, PNG, WEBP)
      // ========================================================
      if (mimeType.startsWith("image/")) {
        console.log(`🖼️ جاري ضغط الصورة: ${baseName} (مستوى: ${level})`);
        
        // استخدام sharp مع الحفاظ على صيغة الصورة الأصلية (force: false)
        // هذا يمنع تحويل الـ PNG الشفاف إلى JPG ذو خلفية سوداء
        await sharp(inputPath)
          .resize({ width: 2000, withoutEnlargement: true })
          .jpeg({ quality: imageQuality, force: false })
          .png({ quality: imageQuality, force: false })
          .webp({ quality: imageQuality, force: false })
          .toFile(outputPath);

        fs.unlinkSync(inputPath); 
        fs.renameSync(outputPath, inputPath);
        return resolve(inputPath);
      } 
      
      // ========================================================
      // 3. معالجة ملفات PDF باستخدام Ghostscript
      // ========================================================
      else if (mimeType === "application/pdf") {
        console.log(`📄 جاري ضغط ملف الـ PDF: ${baseName} (مستوى: ${level})`);
        
        const gsCommand = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=${pdfSetting} -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;

        exec(gsCommand, (error, stdout, stderr) => {
          if (error) {
            console.error("🔥 فشل ضغط الـ PDF، سيتم الاحتفاظ بالملف الأصلي:", error);
            return resolve(inputPath); 
          } else {
            // التحقق من أن حجم الملف الجديد أصغر من القديم، وإلا نلغي الضغط
            const oldSize = fs.statSync(inputPath).size;
            const newSize = fs.statSync(outputPath).size;
            
            if (newSize < oldSize) {
              fs.unlinkSync(inputPath);
              fs.renameSync(outputPath, inputPath);
            } else {
              // أحياناً ضغط الـ PDF يزيد حجمه إذا كان مضغوطاً مسبقاً بشدة!
              fs.unlinkSync(outputPath); // نحذف الملف الجديد الكبير
            }
            return resolve(inputPath);
          }
        });
      } 
      
      // 4. صيغ أخرى (Word, Excel)
      else {
        return resolve(inputPath);
      }

    } catch (error) {
      console.error("🔥 خطأ أثناء محاولة تحسين الملف:", error);
      return resolve(inputPath); 
    }
  });
};
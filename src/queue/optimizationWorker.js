// ملف: src/queue/optimizationWorker.js
const { Worker } = require('bullmq');
const { connection } = require('./aiQueue');
const { optimizeFile } = require('../utils/fileOptimizer');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const optimizationWorker = new Worker('FILE_OPTIMIZATION_QUEUE', async (job) => {
  const { fileId, filePath, mimeType, compressionLevel } = job.data;

  console.log(`[Optimization Worker] 🗜️ بدء ضغط الملف: ${filePath} (مستوى: ${compressionLevel})`);

  try {
    if (compressionLevel !== 'none' && fs.existsSync(filePath)) {
      // 1. تشغيل دالة الضغط
      await optimizeFile(filePath, mimeType, compressionLevel);

      // 2. قراءة الحجم الجديد للملف بعد الضغط
      const newSize = fs.statSync(filePath).size;

      // 3. تحديث الحجم في قاعدة البيانات (مع درع الحماية ضد الحذف المفاجئ)
      try {
        await prisma.archivedProjectFile.update({
          where: { id: fileId },
          data: { fileSize: newSize }
        });
        console.log(`[Optimization Worker] ✅ تم ضغط الملف وتحديث حجمه بنجاح.`);
      } catch (dbError) {
        // 🛡️ حماية P2025: إذا لم يجد الملف (تم حذفه أو دمجه)، يتجاهل الخطأ بهدوء
        if (dbError.code === 'P2025') {
          console.warn(`[Optimization Worker] ⚠️ تم تجاهل التحديث: الملف (ID: ${fileId}) غير موجود في قاعدة البيانات (ربما تم حذفه مسبقاً).`);
        } else {
          // إذا كان خطأ آخر في قاعدة البيانات، نقوم برميه ليتم تسجيله
          throw dbError;
        }
      }
    }
    
    // إرجاع نجاح المهمة لكي يقوم BullMQ بإزالتها من الطابور
    return { success: true, fileId };
    
  } catch (error) {
    console.error(`[Optimization Worker] 🔥 فشل ضغط الملف:`, error);
    throw error;
  }
}, { 
  connection,
  concurrency: 3 // 👈 السماح بضغط 3 ملفات في نفس اللحظة (يستغل أنوية المعالج بفاعلية)
});

module.exports = optimizationWorker;
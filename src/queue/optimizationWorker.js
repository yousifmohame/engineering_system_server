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

      // 3. تحديث الحجم في قاعدة البيانات لكي يظهر بشكل صحيح في الواجهة
      await prisma.archivedProjectFile.update({
        where: { id: fileId },
        data: { fileSize: newSize }
      });

      console.log(`[Optimization Worker] ✅ تم ضغط الملف بنجاح.`);
    }
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
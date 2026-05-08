// ملف: src/queue/optimizationQueue.js
const { Queue } = require('bullmq');
const { connection } = require('./aiQueue'); // نستعمل نفس اتصال Redis

// إنشاء طابور مخصص لعمليات ضغط الملفات
const optimizationQueue = new Queue('FILE_OPTIMIZATION_QUEUE', { connection });

module.exports = { optimizationQueue };
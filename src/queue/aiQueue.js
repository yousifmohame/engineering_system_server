const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  keepAlive: 10000, 
  connectTimeout: 30000, 
  tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
});

connection.on('error', (err) => {
  console.error('⚠️ [Redis] خطأ في الاتصال:', err.message);
});

// الطابور القديم للمستندات
const aiQueue = new Queue('AI_PROCESSING_QUEUE', { connection });

// الطابور الجديد المستقل للإيميلات 🚀
const emailAiQueue = new Queue('EMAIL_AI_QUEUE', { connection });

module.exports = { aiQueue, emailAiQueue, connection };
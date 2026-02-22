const si = require('systeminformation');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// 1. جلب بيانات السيرفر (المعالج، الرام، الهارد)
exports.getServerStats = async (req, res) => {
  try {
    const cpu = await si.currentLoad();
    const mem = await si.mem();
    const disk = await si.fsSize();
    
    // نبحث عن الهارد الأساسي (المسار /)
    const mainDisk = disk.find(d => d.mount === '/');

    res.json({
      cpuLoad: cpu.currentLoad.toFixed(2), // نسبة استهلاك المعالج
      ram: {
        total: (mem.total / (1024 ** 3)).toFixed(2), // بالجيجابايت
        used: (mem.active / (1024 ** 3)).toFixed(2),
        percent: ((mem.active / mem.total) * 100).toFixed(2)
      },
      disk: {
        total: (mainDisk.size / (1024 ** 3)).toFixed(2),
        used: (mainDisk.used / (1024 ** 3)).toFixed(2),
        percent: mainDisk.use.toFixed(2)
      }
    });
  } catch (error) {
    console.error('Error fetching server stats:', error);
    res.status(500).json({ error: 'فشل في جلب بيانات السيرفر' });
  }
};

// 2. أخذ نسخة احتياطية من قاعدة البيانات وتحميلها
exports.downloadBackup = (req, res) => {
  const date = new Date().toISOString().split('T')[0];
  const fileName = `engineering_backup_${date}.sql`;
  const filePath = path.join(__dirname, '../../', fileName);

  // أمر النسخ الاحتياطي (استخدمنا الباسورد والبورت 5433 الخاصين بك)
  const command = `PGPASSWORD="MyStrongPass123" pg_dump -U admin -h localhost -p 5433 engineering_db > ${filePath}`;

  exec(command, (error) => {
    if (error) {
      console.error('Backup Error:', error);
      return res.status(500).json({ error: 'فشل إنشاء النسخة الاحتياطية' });
    }

    // إرسال الملف للمستخدم لتحميله
    res.download(filePath, fileName, (err) => {
      // حذف الملف من السيرفر بعد انتهاء التحميل لتوفير المساحة
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  });
};

// 3. إعادة تشغيل الباك إند (اختياري)
exports.restartServer = (req, res) => {
  res.json({ message: 'جاري إعادة تشغيل السيرفر...' });
  setTimeout(() => {
    exec('pm2 restart backend');
  }, 1000);
};
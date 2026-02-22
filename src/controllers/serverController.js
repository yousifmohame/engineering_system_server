const si = require('systeminformation');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

// 1. جلب بيانات السيرفر (المعالج، الرام، الهارد)
exports.getServerStats = async (req, res) => {
  try {
    const cpu = await si.currentLoad();
    const cpuData = await si.cpu();
    const mem = await si.mem();
    const memLayout = await si.memLayout(); // لمعرفة شرائح الرام
    const disks = await si.fsSize(); // لمعرفة كل الهاردات

    // تجهيز قائمة بكل الهاردات المتاحة
    const allDisks = disks.map(d => ({
      mount: d.mount, // مسار الهارد (مثل C: أو /)
      type: d.type,
      total: (d.size / (1024 ** 3)).toFixed(2),
      used: (d.used / (1024 ** 3)).toFixed(2),
      percent: d.use.toFixed(2)
    }));

    // تجهيز قائمة بشرائح الرام الفيزيائية
    const allRams = memLayout.map(m => ({
      bank: m.bank || 'N/A', // مكان الشريحة
      type: m.type || 'Unknown', // نوعها DDR4 مثلا
      size: m.size ? (m.size / (1024 ** 3)).toFixed(2) : 0, // حجمها
      clockSpeed: m.clockSpeed || 'N/A' // سرعتها
    }));

    res.json({
      cpu: {
        load: cpu.currentLoad.toFixed(2),
        model: `${cpuData.manufacturer} ${cpuData.brand}`,
        cores: cpuData.cores
      },
      ram: {
        total: (mem.total / (1024 ** 3)).toFixed(2),
        used: (mem.active / (1024 ** 3)).toFixed(2),
        percent: ((mem.active / mem.total) * 100).toFixed(2),
        sticks: allRams // الشرائح التفصيلية
      },
      disks: allDisks // كل الهاردات
    });
  } catch (error) {
    console.error('Error fetching server stats:', error);
    res.status(500).json({ error: 'فشل في جلب بيانات السيرفر' });
  }
};

// 2. أخذ نسخة احتياطية من قاعدة البيانات وتحميلها
exports.downloadBackup = (req, res) => {
  // 1. جلب رابط قاعدة البيانات من ملف البيئة
  const dbUrlString = process.env.DATABASE_URL;
  
  if (!dbUrlString) {
    return res.status(500).json({ error: 'DATABASE_URL غير موجود في ملف البيئة' });
  }

  try {
    // 2. تفكيك الرابط لاستخراج البيانات منه تلقائياً
    const dbUrl = new URL(dbUrlString);
    const host = dbUrl.hostname;
    const port = dbUrl.port || 5432;
    const user = dbUrl.username;
    const pass = dbUrl.password;
    const dbName = dbUrl.pathname.substring(1); // إزالة الشرطة المائلة /

    const date = new Date().toISOString().split('T')[0];
    const fileName = `engineering_backup_${date}.sql`;
    const filePath = path.join(__dirname, '../../', fileName);

    // 3. بناء أمر النسخ الاحتياطي بالبيانات الحقيقية
    const command = `PGPASSWORD="${pass}" pg_dump -U ${user} -h ${host} -p ${port} ${dbName} > "${filePath}"`;

    exec(command, (error) => {
      if (error) {
        console.error('Backup Error:', error);
        return res.status(500).json({ error: 'فشل اتصال pg_dump بقاعدة البيانات' });
      }

      // 4. إرسال الملف للمستخدم ثم حذفه من السيرفر لتوفير المساحة
      res.download(filePath, fileName, (err) => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    });
  } catch (err) {
    console.error('URL Parsing Error:', err);
    res.status(500).json({ error: 'صيغة DATABASE_URL غير صحيحة' });
  }
};

// 3. إعادة تشغيل الباك إند (اختياري)
exports.restartServer = (req, res) => {
  res.json({ message: 'جاري إعادة تشغيل السيرفر...' });
  setTimeout(() => {
    exec('pm2 restart backend');
  }, 1000);
};
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. دالة الترحيب (Handshake)
exports.handshake = async (req, res) => {
  // 💡 إضافة استكشافية: طباعة الرابط الكامل الذي طلبه الجهاز
  console.log(`\n[ZKTeco Debug] الرابط المطلوب: ${req.originalUrl}`);
  console.log(`[ZKTeco Debug] المتغيرات (Query):`, req.query);
  console.log(`[ZKTeco Debug] الترويسات (Headers):`, req.headers);

  // 💡 التعديل هنا: التقاط SN أو sn أو التقاطه من الهيدر
  const SN = req.query.SN || req.query.sn || req.headers['sn'] || "غير_معروف"; 
  
  console.log(`[ZKTeco] جهاز بصمة جديد يتصل الآن. السيريال: ${SN}`);
  
  // يجب أن نرد بكلمة OK لكي يعرف الجهاز أن السيرفر يعمل ويستعد لإرسال البصمات
  res.status(200).send("OK");
};

// 2. دالة استقبال البصمات (Receive Data)
exports.receiveData = async (req, res) => {
  try {
    const SN = req.query.SN || req.query.sn || "غير_معروف"; 
    const table = req.query.table;
    const rawData = req.body; // البيانات الخام القادمة من الجهاز

    // إذا كانت البيانات المرسلة هي سجل حضور وانصراف
    if (table === 'ATTLOG') {
      console.log(`[ZKTeco] استلام بصمات جديدة من الجهاز: ${SN}`);
      
      // تفكيك السطور (كل سطر يمثل بصمة موظف)
      const lines = rawData.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        /*
          شكل السطر القادم من الجهاز يكون هكذا:
          "1001\t2026-05-12 08:30:00\t0\t1\t0\t0"
          الترتيب: (رقم الموظف) (الوقت) (حالة البصمة: 0 حضور، 1 انصراف) ...
        */
        const [empIdInDevice, punchTimeStr, status] = line.split('\t');

        if (!empIdInDevice || !punchTimeStr) continue;

        // البحث عن الموظف في الداتا بيز (بناءً على رقمه في جهاز البصمة)
        const employee = await prisma.employee.findFirst({
          where: { fingerprintId: empIdInDevice.trim() } // تأكد من إضافة هذا الحقل لنموذج الموظف
        });

        if (employee) {
          try {
            await prisma.attendanceLog.create({
              data: {
                employeeId: employee.id,
                deviceUid: SN, // السيريال نمبر للجهاز
                punchTime: new Date(punchTimeStr),
                type: status === '0' ? 'حضور' : 'انصراف'
              }
            });
            console.log(`✅ تم تسجيل بصمة للموظف: ${employee.name}`);
          } catch (err) {
            // تجاهل الخطأ إذا كانت البصمة محفوظة مسبقاً
          }
        }
      }
    }

    // يجب دائماً الرد بـ OK وبعدد السطور المحفوظة لكي يمسحها الجهاز من ذاكرته كـ "مرسلة"
    res.status(200).send("OK");

  } catch (error) {
    console.error("[ZKTeco Error]", error);
    res.status(500).send("ERROR");
  }
};

// 3. دالة إرسال الأوامر (إبقاء الجهاز متصلاً)
exports.getCommands = (req, res) => {
  // للرد بكلمة OK لإبقاء الاتصال حياً (Keep-Alive)
  res.status(200).send("OK"); 
};
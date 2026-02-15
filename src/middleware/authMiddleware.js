const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// (لقد استخدمت الاسم 'protect' بناءً على ملفك الأصلي)
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // 1. استخراج التوكن
      token = req.headers.authorization.split(' ')[1];

      // 2. التحقق من التوكن
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 3. جلب الموظف (بدون كلمة المرور)
      const employee = await prisma.employee.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          employeeCode: true,
          name: true,
          email: true,
          phone: true,
          position: true,
          department: true,
          // (أضف أي حقول أخرى تحتاجها أن تكون متاحة في 'req.user')
        }
      });

      if (!employee) {
        return res.status(401).json({ message: 'غير مصرح لك، لم يتم العثور على الموظف' });
      }

      // 4. إرفاق بيانات الموظف بالـ request
      req.user = employee;
      next();

    } catch (error) {
      console.error(error); // (لأغراض التصحيح)

      // --- 💡 هذا هو التعديل المطلوب ---
      // (إذا انتهت صلاحية التوكن، أرسل 401)
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'غير مصرح لك، انتهت صلاحية التوكن' });
      }
      // (إذا كان التوكن غير صالح لأي سبب آخر)
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ message: 'غير مصرح لك، التوكن غير صالح' });
      }
      
      // لأي أخطاء أخرى
      return res.status(500).json({ message: 'خطأ في الخادم' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'غير مصرح لك، لا يوجد توكن' });
  }
};

// (التصدير كما في ملفك الأصلي)
module.exports = { protect };
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');

      // 👈 التعديل هنا: استخدام include بدلاً من select لجلب العلاقات
      const employee = await prisma.employee.findUnique({
        where: { id: decoded.id },
        include: {
          roles: {
            include: { permissions: true }
          },
          specialPermissions: true
        }
      });

      if (!employee) {
        return res.status(401).json({ message: 'غير مصرح لك، لم يتم العثور على الموظف' });
      }

      // تجميع الصلاحيات
      const permissionCodes = new Set();
      employee.roles.forEach(role => {
        role.permissions.forEach(perm => permissionCodes.add(perm.code));
      });
      employee.specialPermissions.forEach(perm => permissionCodes.add(perm.code));

      // إزالة الباسورد لأسباب أمنية
      delete employee.password;

      // 👈 إرفاق الموظف مع مصفوفة الصلاحيات النظيفة بالـ request
      req.user = {
        ...employee,
        permissions: Array.from(permissionCodes)
      };

      next();

    } catch (error) {
      console.error("Auth Middleware Error:", error); 
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'غير مصرح لك، انتهت صلاحية التوكن' });
      }
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ message: 'غير مصرح لك، التوكن غير صالح' });
      }
      return res.status(500).json({ message: 'خطأ في الخادم' });
    }
  } else {
    res.status(401).json({ message: 'غير مصرح لك، لا يوجد توكن' });
  }
};

module.exports = { protect };
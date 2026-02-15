// src/controllers/authController.js
const prisma = require('../utils/prisma');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 1. تسجيل موظف جديد (لإنشاء أول مستخدم في النظام)
exports.register = async (req, res) => {
  try {
    const { 
      name, 
      email, 
      password, 
      nationalId, 
      phone, 
      position, 
      department, 
      hireDate 
    } = req.body;

    // التحقق من البيانات الأساسية
    if (!name || !email || !password || !nationalId || !phone) {
      return res.status(400).json({ message: 'جميع الحقول الأساسية مطلوبة' });
    }

    // التحقق من التكرار (البريد، الهوية، الهاتف)
    const existingEmployee = await prisma.employee.findFirst({
      where: {
        OR: [
          { email },
          { nationalId },
          { phone }
        ]
      }
    });

    if (existingEmployee) {
      return res.status(400).json({ message: 'الموظف موجود مسبقاً (البريد أو الهوية أو الهاتف مستخدم)' });
    }

    // تشفير كلمة المرور
    const hashedPassword = await bcrypt.hash(password, 10);

    // إنشاء الموظف في قاعدة البيانات
    const newEmployee = await prisma.employee.create({
      data: {
        name,
        email,
        password: hashedPassword,
        nationalId,
        phone,
        position: position || 'مهندس', // قيمة افتراضية
        department: department || 'الإدارة الهندسية', // قيمة افتراضية
        hireDate: hireDate ? new Date(hireDate) : new Date(),
        // إنشاء كود موظف تلقائي
        employeeCode: `EMP-${Date.now().toString().slice(-6)}` 
      }
    });

    res.status(201).json({ 
      message: 'تم إنشاء حساب الموظف بنجاح', 
      employeeId: newEmployee.id 
    });

  } catch (error) {
    console.error('Register Error:', error);
    res.status(500).json({ message: 'حدث خطأ في السيرفر أثناء التسجيل', error: error.message });
  }
};

// 2. تسجيل الدخول
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // البحث عن الموظف
    const employee = await prisma.employee.findUnique({
      where: { email }
    });

    if (!employee) {
      return res.status(401).json({ message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    // التحقق من صحة كلمة المرور
    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    // التحقق من حالة الحساب
    if (employee.status !== 'active') {
      return res.status(403).json({ message: 'هذا الحساب غير نشط، يرجى مراجعة الإدارة' });
    }

    // إنشاء التوكن (JWT)
    const token = jwt.sign(
      { 
        id: employee.id, 
        role: employee.position,
        department: employee.department 
      },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '12h' }
    );

    // إرسال الرد
    res.json({
      message: 'تم تسجيل الدخول بنجاح',
      token,
      user: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        position: employee.position,
        department: employee.department
      }
    });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء تسجيل الدخول' });
  }
};
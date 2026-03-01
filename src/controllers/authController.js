// src/controllers/authController.js
const prisma = require("../utils/prisma");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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
      hireDate,
    } = req.body;

    // التحقق من البيانات الأساسية
    if (!name || !email || !password || !nationalId || !phone) {
      return res.status(400).json({ message: "جميع الحقول الأساسية مطلوبة" });
    }

    // التحقق من التكرار (البريد، الهوية، الهاتف)
    const existingEmployee = await prisma.employee.findFirst({
      where: {
        OR: [{ email }, { nationalId }, { phone }],
      },
    });

    if (existingEmployee) {
      return res.status(400).json({
        message: "الموظف موجود مسبقاً (البريد أو الهوية أو الهاتف مستخدم)",
      });
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
        position: position || "مهندس", // قيمة افتراضية
        department: department || "الإدارة الهندسية", // قيمة افتراضية
        hireDate: hireDate ? new Date(hireDate) : new Date(),
        // إنشاء كود موظف تلقائي
        employeeCode: `EMP-${Date.now().toString().slice(-6)}`,
      },
    });

    res.status(201).json({
      message: "تم إنشاء حساب الموظف بنجاح",
      employeeId: newEmployee.id,
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({
      message: "حدث خطأ في السيرفر أثناء التسجيل",
      error: error.message,
    });
  }
};

// 2. تسجيل الدخول
exports.login = async (req, res) => {
  try {
    // 1. استقبال identifier (الاسم الجديد) أو email (للتوافق القديم)
    const { identifier, email, password } = req.body;

    // 2. تحديد قيمة الدخول بغض النظر عن اسم المتغير القادم من الواجهة
    const rawLoginValue = identifier || email;

    if (!rawLoginValue || !password) {
      return res
        .status(400)
        .json({ message: "يرجى إدخال بيانات الدخول وكلمة المرور" });
    }

    // 3. 🚨 خطوة هامة جداً: إزالة أي مسافات زائدة قد يكتبها المستخدم بالخطأ
    const loginValue = rawLoginValue.trim();

    console.log(`[Login Attempt] Value: "${loginValue}"`); // 👈 سطر للطباعة في الكونسول لتتأكد بنفسك

    // 4. البحث باستخدام OR (إيميل أو جوال أو رقم وظيفي أو هوية)
    const employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { email: loginValue },
          { phone: loginValue },
          { employeeCode: loginValue },
          { nationalId: loginValue },
        ],
      },
      include: {
        roles: {
          include: { permissions: true }, // جلب صلاحيات كل دور
        },
        specialPermissions: true, // جلب الصلاحيات الاستثنائية إن وجدت
      },
    });

    if (!employee) {
      console.log(`[Login Failed] User not found for: ${loginValue}`);
      return res
        .status(401)
        .json({ message: "بيانات الدخول غير صحيحة أو غير مسجلة" });
    }

    // 👇 أضف هذا السطر لكشف الحساب الحقيقي الذي وجده النظام!
    console.log(
      `[Login Found User] Name: ${employee.name} | Email: ${employee.email} | Code: ${employee.employeeCode}`,
    );

    // 5. مطابقة كلمة المرور
    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      console.log(`[Login Failed] Wrong password for: ${loginValue}`);
      return res.status(401).json({ message: "كلمة المرور غير صحيحة" });
    }

    // 6. التحقق من حالة الحساب
    if (employee.status !== "active") {
      return res
        .status(403)
        .json({ message: "هذا الحساب غير نشط، يرجى مراجعة الإدارة" });
    }

    // 7. إنشاء التوكن
    const token = jwt.sign(
      {
        id: employee.id,
        role: employee.position,
        department: employee.department,
      },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "12h" },
    );

    // 8. تجميع كل أكواد الصلاحيات في مصفوفة واحدة (بدون تكرار)
    const permissionCodes = new Set();

    if (employee.roles) {
      employee.roles.forEach((role) => {
        if (role.permissions) {
          role.permissions.forEach((perm) => permissionCodes.add(perm.code));
        }
      });
    }

    if (employee.specialPermissions) {
      employee.specialPermissions.forEach((perm) =>
        permissionCodes.add(perm.code),
      );
    }

    res.json({
      message: "تم تسجيل الدخول بنجاح",
      token,
      user: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        employeeCode: employee.employeeCode, // إضافة الرقم الوظيفي
        position: employee.position,
        department: employee.department,
        permissions: Array.from(permissionCodes),
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "حدث خطأ أثناء تسجيل الدخول" });
  }
};

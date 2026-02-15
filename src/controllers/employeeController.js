// controllers/employeeController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs');
// ===============================================
// 1. جلب الموظف الحالي (من الـ Token)
// GET /api/employees/me
// ===============================================
const getMe = (req, res) => {
  // هذه الوظيفة نأخذها من (protect middleware)
  // req.employee تم إرفاقه في الوسيط
  if (req.employee) {
    res.status(200).json(req.employee);
  } else {
    res.status(404).json({ message: "لم يتم العثور على الموظف" });
  }
};

// ===============================================
// 2. جلب جميع الموظفين (لشاشة 817 - القائمة)
// GET /api/employees
// ===============================================
const getAllEmployees = async (req, res) => {
  try {
    const employees = await prisma.employee.findMany({
      orderBy: {
        createdAt: "desc",
      },
      // لا نرسل كلمة المرور
      select: {
        id: true,
        employeeCode: true,
        name: true,
        nameEn: true,
        nationalId: true,
        email: true,
        phone: true,
        position: true,
        department: true,
        hireDate: true,
        baseSalary: true,
        jobLevel: true,
        type: true,
        status: true,
        nationality: true,
        gosiNumber: true,
        iqamaNumber: true,
        performanceRating: true,
        frozenUntil: true,
        frozenReason: true,
        createdAt: true,
        updatedAt: true,
        roles: true, // جلب الأدوار المرتبطة
        // جلب عدد الصلاحيات الخاصة
        _count: {
          select: { specialPermissions: true },
        },
      },
    });
    res.status(200).json(employees);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

const createEmployee = async (req, res) => {
  try {
    const {
      name,
      nameEn,
      nationalId,
      email,
      phone,
      password,
      position,
      department,
      hireDate,
      baseSalary,
      type,
      status,
      nationality,
      gosiNumber,
      iqamaNumber
    } = req.body;

    // التحقق من الحقول الإلزامية
    if (!name || !nationalId || !email || !phone || !password || !position || !department || !hireDate || !type) {
      return res.status(400).json({ message: 'الرجاء إدخال جميع الحقول الإلزامية' });
    }

    // التحقق من وجود الموظف (برقم الهوية أو الإيميل أو الجوال)
    const employeeExists = await prisma.employee.findFirst({
      where: {
        OR: [
          { nationalId: nationalId },
          { email: email },
          { phone: phone }
        ]
      }
    });

    if (employeeExists) {
      return res.status(400).json({ message: 'موظف مسجل بالفعل بنفس رقم الهوية أو الإيميل أو الجوال' });
    }

    // تشفير كلمة المرور
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // إنشاء الموظف
    const newEmployee = await prisma.employee.create({
      data: {
        name,
        nameEn,
        nationalId,
        email,
        phone,
        password: hashedPassword,
        position,
        department,
        // تحويل تاريخ التعيين من نص إلى كائن تاريخ
        hireDate: new Date(hireDate), 
        baseSalary: baseSalary ? parseFloat(baseSalary) : null,
        type,
        status: status || 'active', // قيمة افتراضية
        nationality,
        gosiNumber,
        iqamaNumber,
        // (يمكن إضافة باقي الحقول هنا)
      }
    });

    // حذف كلمة المرور قبل إرسال الرد
    delete newEmployee.password;

    res.status(201).json({ message: "تم إنشاء الموظف بنجاح", employee: newEmployee });

  } catch (error) {
    console.error("Error creating employee:", error);
    if (error.code === 'P2002') {
      // خطأ في حالة تكرار حقل فريد
      return res.status(400).json({ message: `الحقل ${error.meta.target.join(', ')} مستخدم بالفعل` });
    }
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};
// ===============================================
// 3. تحديث بيانات موظف (لشاشة 817 - تعديل)
// PUT /api/employees/:id
// ===============================================
const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    // (ملاحظة: لا نسمح بتحديث كلمة المرور من هنا)
    delete data.password;
    // (ولا نسمح بتحديث البريد أو الرقم القومي بسهولة)
    delete data.email;
    delete data.nationalId;

    const updatedEmployee = await prisma.employee.update({
      where: { id: id },
      data: data,
    });
    res.status(200).json(updatedEmployee);
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "الموظف غير موجود" });
    }
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// ===============================================
// 4. حذف موظف (أو أرشفته)
// DELETE /api/employees/:id
// ===============================================
const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    // الأفضل هو "تعطيل" الحساب بدلاً من الحذف الكامل
    // لأن الموظف مرتبط ببيانات تاريخية (معاملات، مهام، ...إلخ)

    const archivedEmployee = await prisma.employee.update({
      where: { id: id },
      data: {
        status: "inactive", // تغيير الحالة إلى "غير نشط"
      },
    });

    res
      .status(200)
      .json({ message: "تم أرشفة الموظف بنجاح", employee: archivedEmployee });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "الموظف غير موجود" });
    }
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// @desc    جلب سجل الحضور لموظف
// @route   GET /api/employees/:id/attendance
const getEmployeeAttendance = async (req, res) => {
  try {
    const { id } = req.params;

    // (يمكنك إضافة بيانات تجريبية مؤقتًا إذا أردت)
    // const mockAttendance = [
    //   { id: 'att1', date: '2025-11-10', status: 'Present', checkIn: '08:55', checkOut: '17:05' },
    //   { id: 'att2', date: '2025-11-09', status: 'Absent', checkIn: null, checkOut: null },
    // ];
    // return res.status(200).json(mockAttendance);

    const attendanceRecords = await prisma.employeeAttendance.findMany({
      where: { employeeId: id },
      orderBy: { date: "desc" },
    });

    res.status(200).json(attendanceRecords);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Error fetching attendance records",
        error: error.message,
      });
  }
};

// @desc    جلب طلبات الإجازة لموظف
// @route   GET /api/employees/:id/leave-requests
const getEmployeeLeaveRequests = async (req, res) => {
  try {
    const { id } = req.params;

    const leaveRequests = await prisma.employeeLeaveRequest.findMany({
      where: { employeeId: id },
      orderBy: { startDate: "desc" },
    });

    res.status(200).json(leaveRequests);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching leave requests", error: error.message });
  }
};


// --- تاب 817-08 ---
const getEmployeeSkills = async (req, res) => {
  try {
    const skills = await prisma.employeeSkill.findMany({
      where: { employeeId: req.params.id },
    });
    res.status(200).json(skills);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching skills', error: error.message });
  }
};

const getEmployeeCertifications = async (req, res) => {
  try {
    const certifications = await prisma.employeeCertification.findMany({
      where: { employeeId: req.params.id },
    });
    res.status(200).json(certifications);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching certifications', error: error.message });
  }
};

// --- تاب 817-09 ---
const getEmployeeEvaluations = async (req, res) => {
  try {
    const evaluations = await prisma.employeeEvaluation.findMany({
      where: { employeeId: req.params.id },
      orderBy: { date: 'desc' },
    });
    res.status(200).json(evaluations);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching evaluations', error: error.message });
  }
};

// --- تاب 817-10 ---
const getEmployeePromotions = async (req, res) => {
  try {
    const promotions = await prisma.employeePromotion.findMany({
      where: { employeeId: req.params.id },
      orderBy: { date: 'desc' },
    });
    res.status(200).json(promotions);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching promotions', error: error.message });
  }
};

// --- تاب 817-11 (يستخدم نموذج Attachment الموجود) ---
const getEmployeeAttachments = async (req, res) => {
  try {
    // نموذج المرفقات لديك يستخدم uploadedById بدلاً من employeeId
    const attachments = await prisma.attachment.findMany({
      where: { uploadedById: req.params.id }, 
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(attachments);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching attachments', error: error.message });
  }
};

// --- نافذة الصلاحيات (902) ---
const getEmployeePermissions = async (req, res) => {
  try {
    // هذا استعلام معقد يجلب الصلاحيات المباشرة + الصلاحيات من الأدوار
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: {
        specialPermissions: true, // الصلاحيات المباشرة
        roles: { // الأدوار
          include: {
            permissions: true, // صلاحيات كل دور
          },
        },
      },
    });

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    // دمج الصلاحيات ومنع التكرار
    const permissionsMap = new Map();
    employee.specialPermissions.forEach(perm => permissionsMap.set(perm.id, perm));
    employee.roles.forEach(role => {
      role.permissions.forEach(perm => permissionsMap.set(perm.id, perm));
    });

    const allPermissions = Array.from(permissionsMap.values());
    res.status(200).json(allPermissions);

  } catch (error) {
    res.status(500).json({ message: 'Error fetching permissions', error: error.message });
  }
};

// --- النوافذ المنبثقة (تحديث الحالة) ---
const updateEmployeeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, frozenUntil, frozenReason } = req.body;

    const updatedEmployee = await prisma.employee.update({
      where: { id },
      data: {
        status: status,
        frozenUntil: frozenUntil ? new Date(frozenUntil) : null,
        frozenReason: frozenReason,
      },
    });
    res.status(200).json(updatedEmployee);
  } catch (error) {
    res.status(500).json({ message: 'Error updating employee status', error: error.message });
  }
};

// --- النوافذ المنبثقة (ترقية/تخفيض) ---
const updateEmployeePromotion = async (req, res) => {
  try {
    const { id } = req.params;
    // 'newLevel' و 'newPosition' و 'notes' تأتي من الواجهة
    const { newLevel, newPosition, notes } = req.body; 

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    // 1. تحديث الموظف نفسه
    const updatedEmployee = await prisma.employee.update({
      where: { id },
      data: {
        jobLevel: newLevel,
        position: newPosition,
      },
    });

    // 2. تسجيل الترقية في السجل (الجدول الجديد الذي أنشأناه)
    await prisma.employeePromotion.create({
      data: {
        employeeId: id,
        date: new Date(),
        oldPosition: employee.position,
        newPosition: newPosition,
        oldLevel: employee.jobLevel || 0,
        newLevel: newLevel,
        notes: notes,
      },
    });

    res.status(200).json(updatedEmployee);
  } catch (error) {
    res.status(500).json({ message: 'Error processing promotion', error: error.message });
  }
};
const getEmployeesWithStats = async (req, res) => {
  try {
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        employeeCode: true,
        name: true,
        department: true,
        position: true,
        status: true,
        // (الآن نجلب حالات المهام فقط، وهو خفيف جداً)
        assignedTasks: {
          select: {
            status: true
          }
        }
      }
    });

    // 💡 (نقوم بحساب الإحصائيات هنا في الـ Backend)
    const stats = employees.map(emp => {
      
      // (حساب المهام النشطة - يمكن تعديل هذه الحالات)
      const activeTasks = emp.assignedTasks.filter(
        t => t.status === 'in-progress' || t.status === 'pending' || t.status === 'not-received'
      ).length;
      
      // (حساب المهام المكتملة)
      const completedTasks = emp.assignedTasks.filter(
        t => t.status === 'completed'
      ).length;

      const totalTasks = activeTasks + completedTasks;
      
      return {
        id: emp.id,
        code: emp.employeeCode,
        name: emp.name,
        department: emp.department,
        position: emp.position,
        activeTasks: activeTasks,
        completedTasks: completedTasks,
        // (منطق أداء افتراضي محسن)
        performance: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 100,
        // (منطق "متاح" افتراضي محسن)
        available: emp.status === 'active' && activeTasks < 5, // (افترض أن الموظف مشغول إذا كان لديه 5 مهام أو أكثر)
      }
    });

    res.status(200).json(stats);

  } catch (error) {
    console.error(error); // (مهم لطباعة الخطأ الحقيقي في الـ console)
    res.status(500).json({ message: 'Error fetching employee stats', error: error.message });
  }
};

// تصدير جميع الوظائف
module.exports = {
  getMe,
  getAllEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeAttachments,
  getEmployeeAttendance,
  getEmployeeLeaveRequests,
  getEmployeeSkills,
  getEmployeeCertifications,
  getEmployeeEvaluations,
  getEmployeePromotions,
  getEmployeePermissions,
  updateEmployeeStatus,
  updateEmployeePromotion,
  getEmployeesWithStats,
};
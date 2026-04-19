// controllers/employeeController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcryptjs");

// ===============================================
// 1. جلب الموظف الحالي (من الـ Token)
// GET /api/employees/me
// ===============================================
const getMe = (req, res) => {
  if (req.user) {
    res.status(200).json(req.user);
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
      orderBy: { createdAt: "desc" },
      // لا نرسل كلمة المرور، ونجلب كل الحقول الجديدة
      select: {
        id: true,
        employeeCode: true,
        name: true,
        nameEn: true,
        firstNameAr: true,
        secondNameAr: true,
        thirdNameAr: true,
        fourthNameAr: true,
        firstNameEn: true,
        secondNameEn: true,
        thirdNameEn: true,
        fourthNameEn: true,
        profilePicture: true,
        isPhotoVisible: true,
        isAgeVisible: true,
        isInternalTitleVisible: true,
        birthDate: true,
        nationality: true,
        nationalId: true,
        email: true,
        phone: true,
        position: true,
        qiwaPosition: true,
        department: true,
        hireDate: true,
        actualStartDate: true,
        baseSalary: true,
        jobLevel: true,
        type: true,
        status: true,
        gosiNumber: true,
        iqamaNumber: true,
        performanceRating: true,
        frozenUntil: true,
        frozenReason: true,
        shortAddress: true,
        streetNameAr: true,
        streetNameEn: true,
        districtAr: true,
        districtEn: true,
        buildingNumber: true,
        unitNumber: true,
        floorNumber: true,
        postalCode: true,
        additionalNumber: true,
        cityAr: true,
        cityEn: true,
        createdAt: true,
        updatedAt: true,
        roles: true,
        _count: { select: { specialPermissions: true } },
      },
    });
    res.status(200).json(employees);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// ===============================================
// 3. إنشاء موظف جديد
// POST /api/employees
// ===============================================
const createEmployee = async (req, res) => {
  try {
    const {
      employeeCode,
      // 💡 دمج الاسم إذا لم يُرسل صراحة
      firstNameAr,
      secondNameAr,
      thirdNameAr,
      fourthNameAr,
      firstNameEn,
      secondNameEn,
      thirdNameEn,
      fourthNameEn,
      name,
      nameEn,

      profilePicture,
      isPhotoVisible,
      isAgeVisible,
      isInternalTitleVisible,
      birthDate,
      nationalId,
      email,
      phone,
      password,
      position,
      qiwaPosition,
      department,
      hireDate,
      actualStartDate,
      baseSalary,
      type,
      status,
      nationality,
      gosiNumber,
      iqamaNumber,

      // 💡 حقول العنوان الوطني
      shortAddress,
      streetNameAr,
      streetNameEn,
      districtAr,
      districtEn,
      buildingNumber,
      unitNumber,
      floorNumber,
      postalCode,
      additionalNumber,
      cityAr,
      cityEn,

      roleIds,
    } = req.body;

    if (
      !employeeCode ||
      !nationalId ||
      !email ||
      !phone ||
      !password ||
      !position ||
      !department ||
      !hireDate ||
      !type
    ) {
      return res
        .status(400)
        .json({ message: "الرجاء إدخال جميع الحقول الإلزامية" });
    }

    const employeeExists = await prisma.employee.findFirst({
      where: { OR: [{ nationalId }, { email }, { phone }, { employeeCode }] },
    });

    if (employeeExists) {
      return res
        .status(400)
        .json({
          message:
            "موظف مسجل بالفعل بنفس رقم الهوية، الإيميل، الجوال، أو الرقم الوظيفي",
        });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 💡 تجميع الاسم الكامل برمجياً لضمان عمل الشاشات القديمة
    const fullNameAr =
      name ||
      [firstNameAr, secondNameAr, thirdNameAr, fourthNameAr]
        .filter(Boolean)
        .join(" ");
    const fullNameEn =
      nameEn ||
      [firstNameEn, secondNameEn, thirdNameEn, fourthNameEn]
        .filter(Boolean)
        .join(" ");

    const newEmployee = await prisma.employee.create({
      data: {
        employeeCode,
        name: fullNameAr,
        nameEn: fullNameEn,
        firstNameAr,
        secondNameAr,
        thirdNameAr,
        fourthNameAr,
        firstNameEn,
        secondNameEn,
        thirdNameEn,
        fourthNameEn,

        profilePicture,
        isPhotoVisible: isPhotoVisible ?? true,
        isAgeVisible: isAgeVisible ?? true,
        isInternalTitleVisible: isInternalTitleVisible ?? true,

        birthDate: birthDate ? new Date(birthDate) : null,
        nationalId,
        email,
        phone,
        password: hashedPassword,
        position,
        qiwaPosition,
        department,
        type,
        status: status || "active",
        nationality,
        gosiNumber,
        iqamaNumber,
        hireDate: new Date(hireDate),
        actualStartDate: actualStartDate ? new Date(actualStartDate) : null,
        baseSalary: baseSalary ? parseFloat(baseSalary) : null,

        shortAddress,
        streetNameAr,
        streetNameEn,
        districtAr,
        districtEn,
        buildingNumber,
        unitNumber,
        floorNumber,
        postalCode,
        additionalNumber,
        cityAr,
        cityEn,

        roles: {
          connect:
            roleIds && roleIds.length > 0 ? roleIds.map((id) => ({ id })) : [],
        },
      },
      include: { roles: true },
    });

    delete newEmployee.password;
    res
      .status(201)
      .json({ message: "تم إنشاء الموظف بنجاح", employee: newEmployee });
  } catch (error) {
    console.error("Error creating employee:", error);
    if (error.code === "P2002")
      return res.status(400).json({ message: "البيانات مستخدمة بالفعل" });
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// ===============================================
// 4. تحديث بيانات موظف
// PUT /api/employees/:id
// ===============================================
const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      employeeCode,
      firstNameAr,
      secondNameAr,
      thirdNameAr,
      fourthNameAr,
      firstNameEn,
      secondNameEn,
      thirdNameEn,
      fourthNameEn,
      name,
      nameEn,

      profilePicture,
      isPhotoVisible,
      isAgeVisible,
      isInternalTitleVisible,
      birthDate,
      phone,
      position,
      qiwaPosition,
      department,
      hireDate,
      actualStartDate,
      baseSalary,
      type,
      status,
      nationality,
      gosiNumber,
      iqamaNumber,

      shortAddress,
      streetNameAr,
      streetNameEn,
      districtAr,
      districtEn,
      buildingNumber,
      unitNumber,
      floorNumber,
      postalCode,
      additionalNumber,
      cityAr,
      cityEn,

      roleIds,
      password,
    } = req.body;

    const fullNameAr =
      name ||
      [firstNameAr, secondNameAr, thirdNameAr, fourthNameAr]
        .filter(Boolean)
        .join(" ");
    const fullNameEn =
      nameEn ||
      [firstNameEn, secondNameEn, thirdNameEn, fourthNameEn]
        .filter(Boolean)
        .join(" ");

    const updateData = {
      employeeCode,
      name: fullNameAr,
      nameEn: fullNameEn,
      firstNameAr,
      secondNameAr,
      thirdNameAr,
      fourthNameAr,
      firstNameEn,
      secondNameEn,
      thirdNameEn,
      fourthNameEn,

      profilePicture,
      isPhotoVisible,
      isAgeVisible,
      isInternalTitleVisible,

      phone,
      position,
      qiwaPosition,
      department,
      type,
      status,
      nationality,
      gosiNumber,
      iqamaNumber,

      shortAddress,
      streetNameAr,
      streetNameEn,
      districtAr,
      districtEn,
      buildingNumber,
      unitNumber,
      floorNumber,
      postalCode,
      additionalNumber,
      cityAr,
      cityEn,
    };

    if (birthDate) updateData.birthDate = new Date(birthDate);
    if (hireDate) updateData.hireDate = new Date(hireDate);
    if (actualStartDate) updateData.actualStartDate = new Date(actualStartDate);
    if (baseSalary !== undefined)
      updateData.baseSalary = baseSalary ? parseFloat(baseSalary) : null;

    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    if (roleIds && Array.isArray(roleIds)) {
      updateData.roles = { set: roleIds.map((roleId) => ({ id: roleId })) };
    }

    const updatedEmployee = await prisma.employee.update({
      where: { id: id },
      data: updateData,
      include: { roles: true },
    });

    delete updatedEmployee.password;
    res.status(200).json(updatedEmployee);
  } catch (error) {
    if (error.code === "P2025")
      return res.status(404).json({ message: "الموظف غير موجود" });
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// ===============================================
// الدوال الأخرى (تبقى كما هي بدون تغيير لأنها تخص جداول منفصلة)
// ===============================================
const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const archivedEmployee = await prisma.employee.update({
      where: { id: id },
      data: { status: "inactive" },
    });
    res
      .status(200)
      .json({ message: "تم أرشفة الموظف بنجاح", employee: archivedEmployee });
  } catch (error) {
    if (error.code === "P2025")
      return res.status(404).json({ message: "الموظف غير موجود" });
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

const getEmployeeAttendance = async (req, res) => {
  try {
    const attendanceRecords = await prisma.employeeAttendance.findMany({
      where: { employeeId: req.params.id },
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

const getEmployeeLeaveRequests = async (req, res) => {
  try {
    const leaveRequests = await prisma.employeeLeaveRequest.findMany({
      where: { employeeId: req.params.id },
      orderBy: { startDate: "desc" },
    });
    res.status(200).json(leaveRequests);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching leave requests", error: error.message });
  }
};

const getEmployeeSkills = async (req, res) => {
  try {
    const skills = await prisma.employeeSkill.findMany({
      where: { employeeId: req.params.id },
    });
    res.status(200).json(skills);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching skills", error: error.message });
  }
};

const getEmployeeCertifications = async (req, res) => {
  try {
    const certifications = await prisma.employeeCertification.findMany({
      where: { employeeId: req.params.id },
    });
    res.status(200).json(certifications);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching certifications", error: error.message });
  }
};

const getEmployeeEvaluations = async (req, res) => {
  try {
    const evaluations = await prisma.employeeEvaluation.findMany({
      where: { employeeId: req.params.id },
      orderBy: { date: "desc" },
    });
    res.status(200).json(evaluations);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching evaluations", error: error.message });
  }
};

const getEmployeePromotions = async (req, res) => {
  try {
    const promotions = await prisma.employeePromotion.findMany({
      where: { employeeId: req.params.id },
      orderBy: { date: "desc" },
    });
    res.status(200).json(promotions);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching promotions", error: error.message });
  }
};

const getEmployeeAttachments = async (req, res) => {
  try {
    const attachments = await prisma.attachment.findMany({
      where: { uploadedById: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json(attachments);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching attachments", error: error.message });
  }
};

const getEmployeePermissions = async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: {
        specialPermissions: true,
        roles: { include: { permissions: true } },
      },
    });
    if (!employee)
      return res.status(404).json({ message: "Employee not found" });
    const permissionsMap = new Map();
    employee.specialPermissions.forEach((perm) =>
      permissionsMap.set(perm.id, perm),
    );
    employee.roles.forEach((role) =>
      role.permissions.forEach((perm) => permissionsMap.set(perm.id, perm)),
    );
    res.status(200).json(Array.from(permissionsMap.values()));
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching permissions", error: error.message });
  }
};

const updateEmployeeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, frozenUntil, frozenReason } = req.body;
    const updatedEmployee = await prisma.employee.update({
      where: { id },
      data: {
        status,
        frozenUntil: frozenUntil ? new Date(frozenUntil) : null,
        frozenReason,
      },
    });
    res.status(200).json(updatedEmployee);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Error updating employee status",
        error: error.message,
      });
  }
};

const updateEmployeePromotion = async (req, res) => {
  try {
    const { id } = req.params;
    const { newLevel, newPosition, notes } = req.body;
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee)
      return res.status(404).json({ message: "Employee not found" });

    const updatedEmployee = await prisma.employee.update({
      where: { id },
      data: { jobLevel: newLevel, position: newPosition },
    });

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
    res
      .status(500)
      .json({ message: "Error processing promotion", error: error.message });
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
        assignedTasks: { select: { status: true } },
      },
    });

    const stats = employees.map((emp) => {
      const activeTasks = emp.assignedTasks.filter((t) =>
        ["in-progress", "pending", "not-received"].includes(t.status),
      ).length;
      const completedTasks = emp.assignedTasks.filter(
        (t) => t.status === "completed",
      ).length;
      const totalTasks = activeTasks + completedTasks;

      return {
        id: emp.id,
        code: emp.employeeCode,
        name: emp.name,
        department: emp.department,
        position: emp.position,
        activeTasks,
        completedTasks,
        performance:
          totalTasks > 0
            ? Math.round((completedTasks / totalTasks) * 100)
            : 100,
        available: emp.status === "active" && activeTasks < 5,
      };
    });
    res.status(200).json(stats);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching employee stats", error: error.message });
  }
};

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

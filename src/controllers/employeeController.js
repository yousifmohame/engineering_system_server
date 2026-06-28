// controllers/employeeController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

// ===============================================
// 1. جلب الموظف الحالي (تغذي بوابة الموظف الشاملة)
// GET /api/employees/me
// ===============================================
const getMe = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "غير مصرح لك بالوصول" });
    }

    // جلب بيانات الموظف الشاملة
    const employee = await prisma.employee.findUnique({
      where: { id: req.user.id },
      include: {
        roles: true,
      },
    });

    if (!employee) {
      return res.status(404).json({ message: "لم يتم العثور على الموظف" });
    }

    // إزالة كلمة المرور المشفرة لدواعي أمنية
    delete employee.password;

    // --- حساب رصيد الإجازات الديناميكي ---
    // 1. جلب الإجازات السنوية المعتمدة في السنة الحالية
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(`${currentYear}-01-01T00:00:00.000Z`);
    const endOfYear = new Date(`${currentYear}-12-31T23:59:59.999Z`);

    const approvedLeaves = await prisma.employeeLeave.findMany({
      where: {
        employeeId: employee.id,
        status: "APPROVED",
        type: "إجازة سنوية", // نخصم من الرصيد الإجازات السنوية فقط
        startDate: { gte: startOfYear },
        endDate: { lte: endOfYear }
      }
    });

    // 2. حساب عدد الأيام المستهلكة فعلياً
    let usedLeaveDays = 0;
    approvedLeaves.forEach(leave => {
      const diffTime = Math.abs(new Date(leave.endDate) - new Date(leave.startDate));
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
      usedLeaveDays += diffDays;
    });

    // 3. الرصيد السنوي (21 يوم كافتراضي إذا لم يتم تحديده في العقد)
    const annualAllowance = employee.annualLeaveAllowance || 21;
    employee.leaveBalance = Math.max(0, annualAllowance - usedLeaveDays);

    // توحيد مسمى الراتب الأساسي ليتوافق مع الواجهة
    employee.basicSalary = employee.baseSalary || 0;

    res.status(200).json(employee);
  } catch (error) {
    console.error("Error fetching current employee:", error);
    res.status(500).json({ message: "خطأ في الخادم أثناء جلب بيانات البوابة" });
  }
};
// ===============================================
// 1. ✅ دالة إنشاء طلب الإجازة المصححة (تستخدم النموذج الصحيح وتستبعد حقل days)
// POST /api/employees/:id/leave-requests
// ===============================================
const createEmployeeLeaveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, startDate, endDate, reason } = req.body;

    if (!type || !startDate || !endDate) {
      return res
        .status(400)
        .json({ message: "الرجاء إدخال نوع الإجازة وتاريخ البدء والانتهاء" });
    }

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return res.status(404).json({ message: "الموظف غير موجود" });

    // إنشاء السجل في جدول EmployeeLeave المعتمد في الـ Schema الخاص بك
    const newLeave = await prisma.employeeLeave.create({
      data: {
        employeeId: id,
        type,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason: reason || null,
        status: "PENDING", // حالة افتراضية قيد الانتظار
      },
    });

    res
      .status(201)
      .json({ message: "تم رفع طلب الإجازة بنجاح", leaveRequest: newLeave });
  } catch (error) {
    console.error("Error creating leave request:", error);
    res.status(500).json({ message: "خطأ في الخادم أثناء معالجة الطلب" });
  }
};

// ===============================================
// 2. 🚀 جديد: جلب جميع طلبات الإجازات لجميع الموظفين (لوحة تحكم HR)
// GET /api/employees/all/leave-requests
// ===============================================
const getAllLeaveRequests = async (req, res) => {
  try {
    const leaveRequests = await prisma.employeeLeave.findMany({
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            name: true,
            position: true,
            department: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json(leaveRequests);
  } catch (error) {
    console.error("Error fetching all leaves:", error);
    res.status(500).json({ message: "خطأ في الخادم أثناء جلب طلبات الإجازات" });
  }
};

// ===============================================
// 3. 🚀 جديد: تحديث حالة الطلب من قبل الإدارة (اعتماد / رفض)
// PUT /api/employees/leave-requests/:leaveId/status
// ===============================================
const updateLeaveRequestStatus = async (req, res) => {
  try {
    const { leaveId } = req.params;
    const { status } = req.body; // EXPECTS: 'APPROVED' or 'REJECTED'

    if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
      return res.status(400).json({ message: "حالة الطلب غير صالحة" });
    }

    const updatedLeave = await prisma.employeeLeave.update({
      where: { id: leaveId },
      data: { status },
    });

    res
      .status(200)
      .json({
        message: "تم تحديث حالة طلب الإجازة بنجاح",
        leave: updatedLeave,
      });
  } catch (error) {
    console.error("Error updating leave status:", error);
    res.status(500).json({ message: "خطأ في الخادم أثناء تحديث الطلب" });
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
      select: {
        id: true,
        employeeCode: true,
        fingerprintId: true,
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
        shiftType: true, // 👈 جديد: نوع الدوام
        shiftStartTime: true,
        shiftEndTime: true,
        requiredDailyHours: true, // 👈 جديد: ساعات الدوام المرن
        customWorkingDays: true, // 👈 جديد: أيام عمل مخصصة
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
      fingerprintId,
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
      shiftType,
      shiftStartTime,
      shiftEndTime,
      requiredDailyHours,
      customWorkingDays,
      roleIds,
      jobOfferId
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
      return res.status(400).json({
        message:
          "موظف مسجل بالفعل بنفس رقم الهوية، الإيميل، الجوال، أو الرقم الوظيفي",
      });
    }

    if (fingerprintId && String(fingerprintId).trim() !== "") {
      const fingerprintExists = await prisma.employee.findFirst({
        where: { fingerprintId: String(fingerprintId).trim() },
      });
      if (fingerprintExists) {
        return res
          .status(400)
          .json({ message: "رقم البصمة هذا مستخدم مسبقاً لموظف آخر" });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

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
        fingerprintId:
          fingerprintId && String(fingerprintId).trim() !== ""
            ? String(fingerprintId).trim()
            : null,
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

        // 🚀 إعدادات الدوام الجديدة
        shiftType: shiftType || "FIXED",
        shiftStartTime: shiftStartTime || "08:00",
        shiftEndTime: shiftEndTime || "17:00",
        requiredDailyHours: requiredDailyHours
          ? parseFloat(requiredDailyHours)
          : 8.0,
        customWorkingDays: customWorkingDays ? customWorkingDays : null,
        jobOffer: jobOfferId ? { connect: { id: jobOfferId } } : undefined,
        roles: {
          connect:
            roleIds && roleIds.length > 0 ? roleIds.map((id) => ({ id })) : [],
        },
      },
      include: { roles: true },
    });

    if (jobOfferId) {
      const offer = await prisma.jobOffer.findUnique({ where: { id: jobOfferId } });
      if (offer) {
        const documentsToCreate = [];
        
        if (offer.cvFilePath) {
          documentsToCreate.push({
            fileName: "السيرة الذاتية - من العرض الوظيفي",
            filePath: offer.cvFilePath,
            fileType: "application/pdf", // أو حسب نوعها
            fileSize: 0,
            category: "OTHER",
            employeeId: newEmployee.id,
            uploadedById: req.user?.id || req.employee?.id
          });
        }
        
        if (offer.signedOfferPath) {
          documentsToCreate.push({
            fileName: "العرض الوظيفي الموقع",
            filePath: offer.signedOfferPath,
            fileType: "application/pdf",
            fileSize: 0,
            category: "CONTRACT", // تصنيفها كعقد/وثيقة رسمية
            employeeId: newEmployee.id,
            uploadedById: req.user?.id || req.employee?.id
          });
        }

        if (documentsToCreate.length > 0) {
          await prisma.employeeDocument.createMany({ data: documentsToCreate });
        }
      }
    }

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
// ===============================================
// 4. تحديث بيانات موظف (يدعم التحديث الجزئي بأمان)
// PUT /api/employees/:id
// ===============================================
const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      employeeCode,
      fingerprintId,
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
      email, // 👈 تمت إضافة الإيميل هنا
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
      shiftType,
      shiftStartTime,
      shiftEndTime,
      requiredDailyHours,
      customWorkingDays,
      roleIds,
      password,
    } = req.body;

    // 1. التحقق من رقم البصمة إذا تم إرساله
    if (fingerprintId !== undefined && String(fingerprintId).trim() !== "") {
      const fingerprintExists = await prisma.employee.findFirst({
        where: { fingerprintId: String(fingerprintId).trim(), id: { not: id } },
      });
      if (fingerprintExists) {
        return res
          .status(400)
          .json({ message: "رقم البصمة هذا مستخدم مسبقاً لموظف آخر" });
      }
    }

    // 2. تجميع البيانات الأساسية للتحديث (Prisma يتجاهل أي حقل قيمته undefined تلقائياً)
    const updateData = {
      employeeCode,
      profilePicture,
      isPhotoVisible,
      isAgeVisible,
      isInternalTitleVisible,
      email, // 👈 سيتم تحديث الإيميل الآن
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
      shiftType,
      shiftStartTime,
      shiftEndTime,
      customWorkingDays,
    };

    // 3. 🚨 الحل الجذري لمشكلة حذف الاسم: تحديث الاسم فقط إذا تم إرساله فعلياً من الواجهة
    if (name !== undefined || firstNameAr !== undefined) {
      const computedNameAr =
        name ||
        [firstNameAr, secondNameAr, thirdNameAr, fourthNameAr]
          .filter(Boolean)
          .join(" ");
      if (computedNameAr.trim() !== "") updateData.name = computedNameAr;
    }

    if (nameEn !== undefined || firstNameEn !== undefined) {
      const computedNameEn =
        nameEn ||
        [firstNameEn, secondNameEn, thirdNameEn, fourthNameEn]
          .filter(Boolean)
          .join(" ");
      if (computedNameEn.trim() !== "") updateData.nameEn = computedNameEn;
    }

    if (fingerprintId !== undefined) {
      updateData.fingerprintId =
        String(fingerprintId).trim() !== ""
          ? String(fingerprintId).trim()
          : null;
    }

    // 4. معالجة التواريخ والأرقام بأمان
    if (birthDate !== undefined)
      updateData.birthDate = birthDate ? new Date(birthDate) : null;
    if (hireDate !== undefined)
      updateData.hireDate = hireDate ? new Date(hireDate) : null;
    if (actualStartDate !== undefined)
      updateData.actualStartDate = actualStartDate
        ? new Date(actualStartDate)
        : null;
    if (baseSalary !== undefined)
      updateData.baseSalary = baseSalary ? parseFloat(baseSalary) : null;
    if (requiredDailyHours !== undefined)
      updateData.requiredDailyHours = requiredDailyHours
        ? parseFloat(requiredDailyHours)
        : undefined;

    // 5. تحديث وتشفير كلمة المرور في حال تم طلب تغييرها
    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    // 6. تحديث الأدوار (الصلاحيات) إن وجدت
    if (roleIds && Array.isArray(roleIds)) {
      updateData.roles = { set: roleIds.map((roleId) => ({ id: roleId })) };
    }

    // 7. تنفيذ التحديث في قاعدة البيانات
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
    res
      .status(500)
      .json({ message: "خطأ في الخادم أثناء تحديث بيانات الموظف" });
  }
};

// ===============================================
// 🚀 5. محرك تحليل التايم شيت (Time Sheet Engine)
// GET /api/employees/:id/attendance-analysis
// ===============================================
const getEmployeeAttendanceAnalysis = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetDate } = req.query; // يمرر كـ YYYY-MM-DD

    if (!targetDate)
      return res.status(400).json({ message: "تاريخ اليوم مطلوب للتحليل" });

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return res.status(404).json({ message: "الموظف غير موجود" });

    const date = new Date(targetDate);
    date.setHours(0, 0, 0, 0);

    // 1. هل اليوم إجازة رسمية؟
    const publicHoliday = await prisma.publicHoliday.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: date } },
    });
    if (publicHoliday)
      return res
        .status(200)
        .json({ status: "PUBLIC_HOLIDAY", note: publicHoliday.name });

    // 2. هل الموظف في إجازة خاصة؟
    const employeeLeave = await prisma.employeeLeave.findFirst({
      where: {
        employeeId: employee.id,
        startDate: { lte: date },
        endDate: { gte: date },
        status: "APPROVED",
      },
    });
    if (employeeLeave)
      return res
        .status(200)
        .json({ status: "ON_LEAVE", note: employeeLeave.type });

    // 3. هل اليوم يوم راحة (Weekend)؟
    const dayOfWeek = date.getDay();
    let isWeekend = false;

    if (employee.customWorkingDays) {
      const daysMap = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      isWeekend = !employee.customWorkingDays[daysMap[dayOfWeek]];
    } else {
      const companyDays = await prisma.companyWorkingDays.findUnique({
        where: { id: "global_working_days" },
      });
      const daysMap = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      isWeekend = companyDays
        ? !companyDays[daysMap[dayOfWeek]]
        : dayOfWeek === 5 || dayOfWeek === 6;
    }

    if (isWeekend)
      return res.status(200).json({ status: "WEEKEND", note: "يوم راحة" });

    // 4. جلب البصمات لهذا اليوم
    const startOfDay = new Date(date);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const logs = await prisma.attendanceLog.findMany({
      where: {
        employeeId: employee.id,
        punchTime: { gte: startOfDay, lte: endOfDay },
      },
      orderBy: { punchTime: "asc" },
    });

    if (logs.length === 0)
      return res.status(200).json({ status: "ABSENT", note: "غياب بدون عذر" });

    // 5. حساب الدوام (FIXED vs FLEXIBLE)
    if (employee.shiftType === "FIXED") {
      const checkIn = logs[0].punchTime;
      const checkOut = logs[logs.length - 1].punchTime;

      const [shiftHour, shiftMin] = (employee.shiftStartTime || "08:00")
        .split(":")
        .map(Number);
      const expectedCheckIn = new Date(date);
      expectedCheckIn.setHours(shiftHour, shiftMin, 0, 0);

      let lateMinutes = 0;
      if (checkIn > expectedCheckIn) {
        lateMinutes = Math.floor((checkIn - expectedCheckIn) / 60000);
      }

      return res.status(200).json({
        status: "PRESENT",
        checkIn,
        checkOut,
        lateMinutes,
        note: lateMinutes > 0 ? `تأخير ${lateMinutes} دقيقة` : "حضور منتظم",
      });
    } else {
      // FLEXIBLE
      let totalMinutesWorked = 0;
      for (let i = 0; i < logs.length; i += 2) {
        if (logs[i + 1]) {
          totalMinutesWorked += Math.floor(
            (logs[i + 1].punchTime - logs[i].punchTime) / 60000,
          );
        }
      }

      const requiredMinutes = (employee.requiredDailyHours || 8) * 60;
      const difference = totalMinutesWorked - requiredMinutes;

      return res.status(200).json({
        status: "PRESENT_FLEX",
        totalWorkedHours: (totalMinutesWorked / 60).toFixed(2),
        shortageMinutes: difference < 0 ? Math.abs(difference) : 0,
        overtimeMinutes: difference > 0 ? difference : 0,
        note:
          difference < 0
            ? `نقص ${(Math.abs(difference) / 60).toFixed(1)} ساعة`
            : "حضور مكتمل",
      });
    }
  } catch (error) {
    console.error("Attendance Analysis Error:", error);
    res.status(500).json({ message: "خطأ في تحليل الدوام" });
  }
};

// ===============================================
// الدوال الأخرى (تبقى كما هي)
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
    res.status(500).json({
      message: "Error fetching attendance records",
      error: error.message,
    });
  }
};

// ===============================================
// جلب إجازات موظف محدد (تُستخدم في بوابة الموظف)
// GET /api/employees/:id/leave-requests
// ===============================================
const getEmployeeLeaveRequests = async (req, res) => {
  try {
    const { id } = req.params;

    // جلب الإجازات من جدول employeeLeave الخاصة بهذا الموظف فقط
    const leaveRequests = await prisma.employeeLeave.findMany({
      where: {
        employeeId: id,
      },
      orderBy: {
        createdAt: "desc", // ترتيب من الأحدث للأقدم
      },
    });

    res.status(200).json(leaveRequests);
  } catch (error) {
    console.error("Error fetching employee leave requests:", error);
    res.status(500).json({ message: "خطأ في الخادم أثناء جلب أرشيف الإجازات" });
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
    res.status(500).json({
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

// ===============================================
// جلب تفاصيل موظف محدد بواسطة المعرف (ID)
// GET /api/employees/:id
// ===============================================
const getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;

    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        roles: {
          include: {
            permissions: true, // جلب الصلاحيات المرتبطة بالأدوار
          },
        },
        specialPermissions: true, // جلب الصلاحيات الخاصة إن وجدت
      },
    });

    if (!employee) {
      return res.status(404).json({ message: "الموظف غير موجود" });
    }

    // إزالة الباسورد لأسباب أمنية
    delete employee.password;

    // استخراج جميع الصلاحيات في مصفوفة واحدة مسطحة لتسهيل التعامل في الواجهة الأمامية
    const allPermissions = new Map();

    if (employee.roles) {
      employee.roles.forEach((role) => {
        if (role.permissions) {
          role.permissions.forEach((perm) => allPermissions.set(perm.id, perm));
        }
      });
    }

    if (employee.specialPermissions) {
      employee.specialPermissions.forEach((perm) =>
        allPermissions.set(perm.id, perm),
      );
    }

    // إضافة حقل 'permissions' يحتوي على جميع الصلاحيات
    employee.permissions = Array.from(allPermissions.values());

    res.status(200).json({ data: employee });
  } catch (error) {
    console.error("Error fetching employee by ID:", error);
    res.status(500).json({ message: "خطأ في الخادم أثناء جلب بيانات الموظف" });
  }
};

// 1. جلب مرفقات الموظف (النشطة فقط)
// GET /api/employees/:id/attachments
const getEmployeeAttachments = async (req, res) => {
  try {
    const { id } = req.params;
    const documents = await prisma.employeeDocument.findMany({
      where: { 
        employeeId: id,
        status: "ACTIVE" // 👈 جلب المستندات السارية فقط (لإخفاء الأرشيف القديم)
      },
      include: {
        uploadedBy: { select: { name: true } }
      },
      orderBy: { createdAt: "desc" },
    });
    
    res.status(200).json(documents);
  } catch (error) {
    console.error("Error fetching employee documents:", error);
    res.status(500).json({ message: "خطأ في جلب مستندات الموظف" });
  }
};

// 2. رفع مرفق جديد للموظف
// POST /api/employees/:id/attachments
const uploadEmployeeAttachment = async (req, res) => {
  try {
    const { id: employeeId } = req.params;
    const { category, notes, customName, issueDate, expiryDate, isPermanent } = req.body; 
    const uploaderId = req.user?.id || req.employee?.id; 

    if (!uploaderId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(401).json({ message: "غير مصرح لك بالرفع" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "الرجاء إرفاق ملف" });
    }

    const targetEmployee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!targetEmployee) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: "الموظف غير موجود" });
    }

    const dbFilePath = `/uploads/employees/${req.file.filename}`;

    const originalNameUtf8 = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const newDocument = await prisma.employeeDocument.create({
      data: {
        fileName: originalNameUtf8, // 👈 استخدام الاسم المعالج
        customName: customName || originalNameUtf8,
        filePath: dbFilePath,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        notes: notes || null,
        category: category || "OTHER",
        issueDate: issueDate && issueDate !== "null" ? new Date(issueDate) : null, // 👈 تواريخ
        expiryDate: expiryDate && expiryDate !== "null" && isPermanent !== 'true' ? new Date(expiryDate) : null,
        isPermanent: isPermanent === 'true' || isPermanent === true, // 👈 هل هو دائم؟
        status: "ACTIVE",
        employee: { connect: { id: employeeId } },
        uploadedBy: { connect: { id: uploaderId } }
      },
      include: {
        uploadedBy: { select: { name: true } }
      }
    });

    res.status(201).json({ message: "تم رفع المستند بنجاح", attachment: newDocument });
  } catch (error) {
    console.error("Error uploading employee document:", error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: "خطأ في الخادم أثناء حفظ المستند" });
  }
};

// 3. 🚀 جديد: تجديد مستند منتهي 
// POST /api/employees/attachments/:attachmentId/renew
const renewEmployeeAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const { customName, issueDate, expiryDate, isPermanent, notes } = req.body;
    const uploaderId = req.user?.id || req.employee?.id;

    // جلب المستند القديم
    const oldDocument = await prisma.employeeDocument.findUnique({
      where: { id: attachmentId }
    });

    if (!oldDocument) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: "المستند المراد تجديده غير موجود" });
    }

    // تحديد مسار الملف (إما ملف جديد مرفوع، أو استخدام نفس الملف القديم إذا تم تحديث التواريخ فقط)
    let dbFilePath = oldDocument.filePath;
    let fileType = oldDocument.fileType;
    let fileSize = oldDocument.fileSize;
    let fileName = oldDocument.fileName;

    if (req.file) {
      dbFilePath = `/uploads/employees/${req.file.filename}`;
      fileType = req.file.mimetype;
      fileSize = req.file.size;
      fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    }

    // 1. أرشفة المستند القديم (إيقاف تنشيطه)
    await prisma.employeeDocument.update({
      where: { id: attachmentId },
      data: { status: "ARCHIVED" }
    });

    // 2. إنشاء المستند الجديد وربطه بالقديم
    const renewedDocument = await prisma.employeeDocument.create({
      data: {
        fileName: fileName,
        customName: customName || oldDocument.customName,
        filePath: dbFilePath,
        fileType: fileType,
        fileSize: fileSize,
        notes: notes || null,
        category: oldDocument.category,
        issueDate: issueDate && issueDate !== "null" ? new Date(issueDate) : null,
        expiryDate: expiryDate && expiryDate !== "null" && isPermanent !== 'true' ? new Date(expiryDate) : null,
        isPermanent: isPermanent === 'true' || isPermanent === true,
        status: "ACTIVE",
        parentDocId: oldDocument.id, // 👈 ربط بالأرشيف
        employee: { connect: { id: oldDocument.employeeId } },
        uploadedBy: { connect: { id: uploaderId } }
      },
      include: {
        uploadedBy: { select: { name: true } }
      }
    });

    res.status(201).json({ message: "تم تجديد المستند بنجاح", attachment: renewedDocument });
  } catch (error) {
    console.error("Error renewing employee document:", error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: "خطأ أثناء محاولة تجديد المستند" });
  }
};

// 3. حذف مستند خاص بالموظف
// DELETE /api/employees/attachments/:attachmentId
const deleteEmployeeAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;

    const document = await prisma.employeeDocument.findUnique({
      where: { id: attachmentId },
    });

    if (!document) {
      return res.status(404).json({ message: "المستند غير موجود" });
    }

    const absolutePath = path.join(__dirname, "../../", document.filePath);

    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    await prisma.employeeDocument.delete({ where: { id: attachmentId } });

    res.status(200).json({ message: "تم حذف المستند بنجاح" });
  } catch (error) {
    console.error("Error deleting employee document:", error);
    res.status(500).json({ message: "خطأ أثناء محاولة حذف المستند" });
  }
};

// ==============================================================
// 7. جلب جميع عقود الموظفين
// GET /api/employees/all/contracts
// ==============================================================
const getAllEmployeeContracts = async (req, res) => {
  try {
    const contracts = await prisma.employeeContract.findMany({
      include: { 
        employee: { 
          select: { 
            name: true, // 👈 تم تصحيحها من nameAr لأن الحقل في الداتا بيز اسمه name
            nationalId: true 
          } 
        } 
      },
      orderBy: { 
        uploadedAt: 'desc' // 👈 تم تصحيحها من createdAt إلى uploadedAt لتطابق الـ Schema
      }
    });
    res.status(200).json({ contracts });
  } catch (error) {
    console.error("Error fetching contracts:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب العقود" });
  }
};
// ==============================================================
// 6. حفظ عقد رسمي للموظف (منصة الرفع العامة مع الإنشاء التلقائي واليدوي)
// POST /api/employees/contracts/auto-link
// ==============================================================
const createEmployeeContract = async (req, res) => {
  try {
    const {
      employeeId, // 👈 نستقبل الـ ID إذا تم تحديده يدوياً من المنسدلة
      contractType,
      source,
      startDate,
      endDate,
      isActive,
      isRenewable,
      autoRenew,
      firstPartyName,
      firstPartyRep,
      secondPartyName,
      secondPartyIdNumber,
      secondPartyNationality, 
      secondPartyPhone,
      secondPartyEmail,
      jobTitle,
      fileUrl,
      basicSalary,
      totalSalary,
      aiExtractedData
    } = req.body;

    let employee = null;
    let isNewEmployee = false;

    // 1. إذا قام المشرف باختيار الموظف يدوياً من القائمة المنسدلة
    if (employeeId) {
      employee = await prisma.employee.findUnique({
        where: { id: employeeId }
      });
      if (!employee) return res.status(404).json({ message: "الموظف المختار غير موجود في النظام." });
    } 
    // 2. إذا لم يختاره (الربط التلقائي)، نبحث بالهوية المستخرجة
    else if (secondPartyIdNumber) {
      employee = await prisma.employee.findUnique({
        where: { nationalId: secondPartyIdNumber }
      });
    }

    // 3. إذا لم يجد الموظف لا يدوياً ولا بالهوية، يقوم بإنشائه (Auto-Onboarding)
    if (!employee) {
      if (!secondPartyIdNumber) {
        return res.status(400).json({ message: "يرجى اختيار الموظف يدوياً، أو التأكد من استخراج رقم الهوية لإنشائه." });
      }

      const tempEmpNumber = `EMP-${Math.floor(10000 + Math.random() * 90000)}`;

      employee = await prisma.employee.create({
        data: {
          name: secondPartyName || "موظف جديد (مسجل تلقائياً)", 
          firstNameAr: secondPartyName?.split(" ")[0] || "", 
          nationalId: secondPartyIdNumber,
          employeeCode: tempEmpNumber, 
          email: secondPartyEmail || `temp-${secondPartyIdNumber}@company.com`,
          phone: secondPartyPhone || `TEMP-${Math.floor(Math.random() * 999999999)}`, 
          nationality: secondPartyNationality || "",
          position: jobTitle || "غير محدد",
          department: "غير محدد", 
          password: "TempPassword123!", 
          hireDate: startDate ? new Date(startDate) : new Date(),
          baseSalary: basicSalary ? parseFloat(basicSalary) : 0,
          status: "active"
        }
      });
      isNewEmployee = true;
    } else {
      // 4. إذا الموظف موجود (سواء مختار يدوياً أو آلياً)، نحدّث راتبه ومسماه فقط
      await prisma.employee.update({
        where: { id: employee.id },
        data: {
          baseSalary: basicSalary ? parseFloat(basicSalary) : undefined,
          position: jobTitle || undefined
        }
      });
    }

    const uploaderId = req.user?.id || req.employee?.id;

    // 5. إنشاء العقد وربطه
    const newContract = await prisma.employeeContract.create({
      data: {
        employeeId: employee.id, // تم الربط بشكل مؤكد!
        contractType: contractType || "غير محدد",
        source: source || "غير محدد",
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isActive: Boolean(isActive),
        isRenewable: Boolean(isRenewable),
        autoRenew: Boolean(autoRenew),
        firstPartyName,
        firstPartyRep,
        secondPartyName,
        fileUrl,
        aiExtractedData: aiExtractedData || {},
        uploadedById: uploaderId
      }
    });

    res.status(201).json({ 
      message: isNewEmployee 
        ? "تم إنشاء ملف الموظف تلقائياً وربط العقد به بنجاح!" 
        : "تم حفظ العقد وربطه بملف الموظف بنجاح!", 
      contract: newContract,
      isNewEmployee
    });

  } catch (error) {
    console.error("Error linking employee contract:", error);
    res.status(500).json({ message: "حدث خطأ أثناء حفظ العقد." });
  }
};

module.exports = {
  getMe,
  createEmployeeLeaveRequest,
  getAllLeaveRequests,
  updateLeaveRequestStatus,
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
  getEmployeeAttendanceAnalysis,
  getEmployeeById,
  uploadEmployeeAttachment,
  deleteEmployeeAttachment,
  createEmployeeContract,
  getAllEmployeeContracts,
  renewEmployeeAttachment
};

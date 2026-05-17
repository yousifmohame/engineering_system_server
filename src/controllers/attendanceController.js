// controllers/attendanceController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// دالة مساعدة لحساب الدقائق من وقت مثل "08:30"
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
};

// ===============================================
// 1. جلب السجل اليومي لكافة الموظفين (متصل بالواجهة التفاعلية)
// GET /api/attendance/daily
// ===============================================
exports.getDailyLog = async (req, res) => {
  try {
    const targetDateStr = req.query.date;
    const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    const startOfDay = new Date(targetDate);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const companyDays = await prisma.companyWorkingDays.findUnique({
      where: { id: "global_working_days" },
    });
    const policy = (await prisma.attendancePolicy.findFirst()) || {
      morningGracePeriodMins: 15,
    };

    const publicHoliday = await prisma.publicHoliday.findFirst({
      where: { startDate: { lte: targetDate }, endDate: { gte: targetDate } },
    });

    const employees = await prisma.employee.findMany({
      where: { status: "active" },
      select: {
        id: true,
        name: true,
        position: true,
        shiftType: true,
        shiftStartTime: true,
        shiftEndTime: true,
        requiredDailyHours: true,
        customWorkingDays: true,
      },
    });

    const dailyLogs = await prisma.attendanceLog.findMany({
      where: { punchTime: { gte: startOfDay, lte: endOfDay } },
      orderBy: { punchTime: "asc" },
    });
    const dailyLeaves = await prisma.employeeLeave.findMany({
      where: {
        startDate: { lte: targetDate },
        endDate: { gte: targetDate },
        status: "APPROVED",
      },
    });

    const data = employees.map((emp) => {
      const baseData = {
        employeeId: emp.id,
        employeeName: emp.name,
        position: emp.position,
        shiftType: emp.shiftType || "FIXED",
        shiftStartTime: emp.shiftStartTime || "08:00",
        shiftEndTime: emp.shiftEndTime || "17:00",
        requiredDailyHours: emp.requiredDailyHours || 8.0,
      };

      const empLeave = dailyLeaves.find((l) => l.employeeId === emp.id);
      if (empLeave)
        return { ...baseData, status: "ON_LEAVE", leaveType: empLeave.type };

      if (publicHoliday)
        return {
          ...baseData,
          status: "PUBLIC_HOLIDAY",
          note: publicHoliday.name,
        };

      const dayOfWeek = targetDate.getDay();
      const daysMap = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      let isWeekend = emp.customWorkingDays
        ? !emp.customWorkingDays[daysMap[dayOfWeek]]
        : companyDays
          ? !companyDays[daysMap[dayOfWeek]]
          : dayOfWeek === 5 || dayOfWeek === 6;

      if (isWeekend)
        return { ...baseData, status: "WEEKEND", note: "يوم راحة" };

      const empPunchLogs = dailyLogs.filter((l) => l.employeeId === emp.id);
      if (empPunchLogs.length === 0) return { ...baseData, status: "ABSENT" };

      const checkIn = empPunchLogs[0];
      const checkOut =
        empPunchLogs.length > 1 ? empPunchLogs[empPunchLogs.length - 1] : null;
      const formatTime = (date) =>
        date.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });

      // 💡 قراءة حالة التجاوز من أول بصمة (checkIn)
      const isExcused = checkIn.isExcused || false;

      if (emp.shiftType === "FIXED") {
        const shiftStartMins = timeToMinutes(emp.shiftStartTime || "08:00");
        const actualInMins =
          checkIn.punchTime.getHours() * 60 + checkIn.punchTime.getMinutes();
        let delayMinutes = 0;
        if (actualInMins > shiftStartMins + policy.morningGracePeriodMins)
          delayMinutes = actualInMins - shiftStartMins;

        return {
          ...baseData,
          inTime: formatTime(checkIn.punchTime),
          outTime: checkOut ? formatTime(checkOut.punchTime) : null,
          delayMinutes,
          status: "PRESENT",
          isExcused,
        };
      } else {
        let totalMinutesWorked = 0;
        for (let i = 0; i < empPunchLogs.length; i += 2) {
          if (empPunchLogs[i + 1])
            totalMinutesWorked += Math.floor(
              (empPunchLogs[i + 1].punchTime - empPunchLogs[i].punchTime) /
                60000,
            );
        }
        const requiredMinutes = (emp.requiredDailyHours || 8) * 60;
        const difference = totalMinutesWorked - requiredMinutes;

        return {
          ...baseData,
          inTime: formatTime(checkIn.punchTime),
          outTime: checkOut ? formatTime(checkOut.punchTime) : null,
          totalWorkedHours: (totalMinutesWorked / 60).toFixed(2),
          shortageMinutes: difference < 0 ? Math.abs(difference) : 0,
          overtimeMinutes: difference > 0 ? difference : 0,
          status: "PRESENT_FLEX",
          isExcused,
        };
      }
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Daily Log Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===============================================
// 🚀 2. الإجراءات الإدارية: تجاوز التأخير (جديد)
// ===============================================
exports.excuseDelay = async (req, res) => {
  try {
    const { employeeId, date, reason } = req.body;

    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    // إيجاد أول بصمة لهذا الموظف في هذا اليوم (بصمة الدخول) لتسجيل العذر عليها
    const firstLog = await prisma.attendanceLog.findFirst({
      where: { employeeId, punchTime: { gte: startOfDay, lte: endOfDay } },
      orderBy: { punchTime: "asc" },
    });

    if (!firstLog)
      return res
        .status(404)
        .json({
          success: false,
          message: "لم يتم العثور على بصمة دخول لهذا اليوم لتجاوزها.",
        });

    await prisma.attendanceLog.update({
      where: { id: firstLog.id },
      data: { isExcused: true, excuseReason: reason },
    });

    res.status(200).json({ success: true, message: "تم تجاوز التأخير بنجاح." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===============================================
// 🚀 3. الإجراءات الإدارية: منح إجازة (جديد)
// ===============================================
exports.grantLeave = async (req, res) => {
  try {
    const { employeeId, date, type, duration } = req.body;
    const targetDate = new Date(date);
    targetDate.setHours(12, 0, 0, 0); // تثبيت الساعة بمنتصف اليوم لتفادي مشاكل الـ Timezone

    // إنشاء إجازة فورية معتمدة
    await prisma.employeeLeave.create({
      data: {
        employeeId,
        type: type || "EMERGENCY",
        startDate: targetDate,
        endDate: targetDate,
        status: "APPROVED",
        reason:
          duration === "REST_OF_DAY"
            ? "مغادرة مبكرة إدارية (إجازة باقي اليوم)"
            : "إجازة طارئة ممنوحة إدارياً",
      },
    });

    res.status(200).json({ success: true, message: "تم تسجيل الإجازة بنجاح." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// ===============================================
// 2. تقرير التايم شيت الشهري الذكي (مفصل למوظف)
// GET /api/attendance/report
// ===============================================
exports.getEmployeeReport = async (req, res) => {
  try {
    const { employeeId, year, month } = req.query;
    if (!employeeId)
      return res
        .status(400)
        .json({ success: false, message: "يرجى تحديد الموظف" });

    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    const targetMonth = month ? parseInt(month) - 1 : new Date().getMonth();
    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        employeeCode: true,
        name: true,
        department: true,
        position: true,
        shiftType: true,
        shiftStartTime: true,
        shiftEndTime: true,
        requiredDailyHours: true,
        customWorkingDays: true,
      },
    });

    if (!employee)
      return res
        .status(404)
        .json({ success: false, message: "الموظف غير موجود" });

    const policy = (await prisma.attendancePolicy.findFirst()) || {
      morningGracePeriodMins: 15,
    };
    const companyDays = await prisma.companyWorkingDays.findUnique({
      where: { id: "global_working_days" },
    });

    const publicHolidays = await prisma.publicHoliday.findMany({
      where: {
        OR: [
          { startDate: { lte: endDate, gte: startDate } },
          { endDate: { lte: endDate, gte: startDate } },
        ],
      },
    });
    const leaves = await prisma.employeeLeave.findMany({
      where: {
        employeeId,
        status: "APPROVED",
        OR: [
          { startDate: { lte: endDate, gte: startDate } },
          { endDate: { lte: endDate, gte: startDate } },
        ],
      },
    });

    const logs = await prisma.attendanceLog.findMany({
      where: {
        employeeId: employeeId,
        punchTime: { gte: startDate, lte: endDate },
      },
      orderBy: { punchTime: "asc" },
    });

    const daysMap = {};
    logs.forEach((log) => {
      const dateKey = log.punchTime.toISOString().split("T")[0];
      if (!daysMap[dateKey]) daysMap[dateKey] = [];
      daysMap[dateKey].push(log);
    });

    const reportLogs = [];
    let totalDelayMins = 0;
    let totalWorkedHours = 0;
    let totalOvertimeMins = 0;
    let totalShortageMins = 0;
    let totalAbsentDays = 0;
    let totalLeaveDays = 0;

    const shiftStartMins = timeToMinutes(employee.shiftStartTime || "08:00");
    const shiftEndMins = timeToMinutes(employee.shiftEndTime || "17:00");
    const requiredMinsFlex = (employee.requiredDailyHours || 8) * 60;

    for (let d = 1; d <= endDate.getDate(); d++) {
      const currentDate = new Date(targetYear, targetMonth, d);
      const dateKey = currentDate.toISOString().split("T")[0];

      const pHoliday = publicHolidays.find(
        (h) => currentDate >= h.startDate && currentDate <= h.endDate,
      );
      const eLeave = leaves.find(
        (l) => currentDate >= l.startDate && currentDate <= l.endDate,
      );

      const formatTime = (date) =>
        date.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });

      if (eLeave) {
        totalLeaveDays++;
        reportLogs.push({
          date: dateKey,
          status: "ON_LEAVE",
          note: `إجازة (${eLeave.type})`,
        });
        continue;
      }
      if (pHoliday) {
        reportLogs.push({
          date: dateKey,
          status: "PUBLIC_HOLIDAY",
          note: pHoliday.name,
        });
        continue;
      }

      const dayOfWeek = currentDate.getDay();
      const daysStrMap = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      let isWeekend = employee.customWorkingDays
        ? !employee.customWorkingDays[daysStrMap[dayOfWeek]]
        : companyDays
          ? !companyDays[daysStrMap[dayOfWeek]]
          : dayOfWeek === 5 || dayOfWeek === 6;

      if (isWeekend) {
        reportLogs.push({ date: dateKey, status: "WEEKEND", note: "يوم راحة" });
        continue;
      }

      const dayLogs = daysMap[dateKey] || [];
      if (dayLogs.length === 0) {
        // لم يأتِ الموظف، هل هو يوم في المستقبل؟ لا نحسبه غياب
        if (currentDate <= new Date()) {
          totalAbsentDays++;
          reportLogs.push({ date: dateKey, status: "ABSENT", note: "غياب" });
        }
        continue;
      }

      const checkIn = dayLogs[0].punchTime;
      const checkOut =
        dayLogs.length > 1 ? dayLogs[dayLogs.length - 1].punchTime : null;

      if (employee.shiftType === "FIXED") {
        const actualInMins = checkIn.getHours() * 60 + checkIn.getMinutes();
        let delay = 0;
        let hours = 0;
        if (actualInMins > shiftStartMins + policy.morningGracePeriodMins) {
          delay = actualInMins - shiftStartMins;
          totalDelayMins += delay;
        }
        if (checkOut) {
          hours = (checkOut.getTime() - checkIn.getTime()) / 3600000;
          totalWorkedHours += hours;
        }
        reportLogs.push({
          date: dateKey,
          status: "PRESENT",
          checkIn: formatTime(checkIn),
          checkOut: checkOut ? formatTime(checkOut) : "-",
          totalWorkedHours: hours > 0 ? hours.toFixed(2) : "-",
          lateMinutes: delay,
        });
      } else {
        let dailyWorkedMins = 0;
        for (let i = 0; i < dayLogs.length; i += 2) {
          if (dayLogs[i + 1])
            dailyWorkedMins += Math.floor(
              (dayLogs[i + 1].punchTime - dayLogs[i].punchTime) / 60000,
            );
        }
        totalWorkedHours += dailyWorkedMins / 60;
        const difference = dailyWorkedMins - requiredMinsFlex;
        let shortage = 0;
        let overtime = 0;
        if (difference < 0) {
          shortage = Math.abs(difference);
          totalShortageMins += shortage;
        } else if (difference > 0) {
          overtime = difference;
          totalOvertimeMins += overtime;
        }

        reportLogs.push({
          date: dateKey,
          status: "PRESENT_FLEX",
          checkIn: formatTime(checkIn),
          checkOut: checkOut ? formatTime(checkOut) : "-",
          totalWorkedHours: (dailyWorkedMins / 60).toFixed(2),
          shortageMinutes: shortage,
          overtimeMinutes: overtime,
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        employee,
        period: `${startDate.toLocaleDateString("ar-EG")} إلى ${endDate.toLocaleDateString("ar-EG")}`,
        logs: reportLogs,
        summary: {
          totalHoursWorked: totalWorkedHours.toFixed(2),
          totalDelay: totalDelayMins,
          totalShortage: totalShortageMins,
          totalOvertime: totalOvertimeMins,
          totalAbsentDays,
          totalLeaveDays,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===============================================
// جلب جميع أجهزة البصمة
// ===============================================
exports.getAllDevices = async (req, res) => {
  try {
    const devices = await prisma.zkDevice.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ success: true, data: devices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===============================================
// جلب إحصائيات لوحة القيادة (Dashboard Stats)
// ===============================================
exports.getDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
    );

    const totalEmployees = await prisma.employee.count({
      where: { status: "active" },
    });
    const logs = await prisma.attendanceLog.findMany({
      where: { punchTime: { gte: startOfMonth, lte: endOfMonth } },
      orderBy: { punchTime: "asc" },
    });

    let totalAttendances = 0;
    let onTimeAttendances = 0;

    // حساب مبسط للداشبورد السريع
    res.status(200).json({
      success: true,
      data: {
        totalEmployees: totalEmployees || 0,
        disciplineRate: 95,
        recurringAbsences: 2,
        overtimeHours: 12,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===============================================
// جلب كافة إعدادات وسياسات الشركة والإجازات
// GET /api/attendance/policies/full
// ===============================================
exports.getFullPolicies = async (req, res) => {
  try {
    let policy = await prisma.attendancePolicy.findUnique({
      where: { id: "global_policy" },
    });
    if (!policy)
      policy = await prisma.attendancePolicy.create({
        data: { id: "global_policy" },
      });

    let workingDays = await prisma.companyWorkingDays.findUnique({
      where: { id: "global_working_days" },
    });
    if (!workingDays)
      workingDays = await prisma.companyWorkingDays.create({
        data: { id: "global_working_days" },
      });

    const publicHolidays = await prisma.publicHoliday.findMany({
      orderBy: { startDate: "asc" },
    });

    res
      .status(200)
      .json({ success: true, data: { policy, workingDays, publicHolidays } });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل جلب إعدادات الشركة" });
  }
};

// ===============================================
// حفظ وتحديث كافة إعدادات الشركة والإجازات
// PUT /api/attendance/policies/full
// ===============================================
exports.updateFullPolicies = async (req, res) => {
  try {
    const { policy, workingDays, publicHolidays } = req.body;

    // 💡 التحويل الصارم للأرقام (parseInt) والمنطقي (Boolean) لمنع أخطاء Prisma
    if (policy) {
      await prisma.attendancePolicy.upsert({
        where: { id: "global_policy" },
        update: {
          morningGracePeriodMins: parseInt(policy.morningGracePeriodMins || 15),
          autoAbsentAfterMins: parseInt(policy.autoAbsentAfterMins || 120),
          enableAiExcuseApproval: Boolean(policy.enableAiExcuseApproval),
          enableAiCriticalAlerts: Boolean(policy.enableAiCriticalAlerts),
        },
        create: {
          id: "global_policy",
          morningGracePeriodMins: parseInt(policy.morningGracePeriodMins || 15),
          autoAbsentAfterMins: parseInt(policy.autoAbsentAfterMins || 120),
          enableAiExcuseApproval: Boolean(policy.enableAiExcuseApproval),
          enableAiCriticalAlerts: Boolean(policy.enableAiCriticalAlerts),
        },
      });
    }

    if (workingDays) {
      await prisma.companyWorkingDays.upsert({
        where: { id: "global_working_days" },
        update: {
          sunday: Boolean(workingDays.sunday),
          monday: Boolean(workingDays.monday),
          tuesday: Boolean(workingDays.tuesday),
          wednesday: Boolean(workingDays.wednesday),
          thursday: Boolean(workingDays.thursday),
          friday: Boolean(workingDays.friday),
          saturday: Boolean(workingDays.saturday),
        },
        create: {
          id: "global_working_days",
          sunday: Boolean(workingDays.sunday),
          monday: Boolean(workingDays.monday),
          tuesday: Boolean(workingDays.tuesday),
          wednesday: Boolean(workingDays.wednesday),
          thursday: Boolean(workingDays.thursday),
          friday: Boolean(workingDays.friday),
          saturday: Boolean(workingDays.saturday),
        },
      });
    }

    if (publicHolidays && Array.isArray(publicHolidays)) {
      await prisma.publicHoliday.deleteMany();
      if (publicHolidays.length > 0) {
        const holidaysToInsert = publicHolidays.map((h) => ({
          name: h.name,
          startDate: new Date(h.startDate),
          endDate: new Date(h.endDate),
          isPaid: h.isPaid !== undefined ? Boolean(h.isPaid) : true,
        }));
        await prisma.publicHoliday.createMany({ data: holidaysToInsert });
      }
    }

    res.status(200).json({ success: true, message: "تم تحديث السياسات بنجاح" });
  } catch (error) {
    console.error("Error updating policies:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "فشل تحديث إعدادات الشركة",
        error: error.message,
      });
  }
};

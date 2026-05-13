// src/controllers/attendanceController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// دالة مخصصة لفرونت إند (React) لجلب سجل اليوم
exports.getDailyLog = async (req, res) => {
  try {
    const targetDate = req.query.date ? new Date(req.query.date) : new Date();
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    // نجلب الموظفين النشطين مع بصماتهم لهذا اليوم فقط
    const employees = await prisma.employee.findMany({
      where: { status: "active" },
      include: {
        AttendanceLog: {
          where: { punchTime: { gte: startOfDay, lte: endOfDay } },
          orderBy: { punchTime: "asc" },
        },
      },
    });

    const data = employees.map((emp) => {
      const logs = emp.AttendanceLog;
      const inLog = logs.find((l) => l.type === "حضور") || logs[0];
      const outLog =
        logs.find((l) => l.type === "انصراف") ||
        (logs.length > 1 ? logs[logs.length - 1] : null);

      return {
        employeeName: emp.name,
        position: emp.position,
        inTime: inLog
          ? inLog.punchTime.toLocaleTimeString("ar-EG", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : null,
        outTime: outLog
          ? outLog.punchTime.toLocaleTimeString("ar-EG", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : null,
        delayMinutes: 0,
        status: inLog ? "حاضر" : "غياب",
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// جلب جميع أجهزة البصمة
exports.getAllDevices = async (req, res) => {
  try {
    // نجلب الأجهزة من جدول ZkDevice
    const devices = await prisma.zkDevice.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ success: true, data: devices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// جلب إحصائيات لوحة القيادة (Dashboard Stats)
exports.getDashboardStats = async (req, res) => {
  try {
    // 1. تحديد النطاق الزمني (من بداية الشهر الحالي حتى اللحظة)
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

    // 2. إجمالي الموظفين النشطين
    const totalEmployees = await prisma.employee.count({
      where: { status: "active" },
    });

    // 3. جلب جميع حركات البصمة للشهر الحالي فقط
    const logs = await prisma.attendanceLog.findMany({
      where: { punchTime: { gte: startOfMonth, lte: endOfMonth } },
      orderBy: { punchTime: "asc" },
    });

    // 4. خوارزمية تجميع الحركات (Grouping) لكل موظف في كل يوم
    const attendanceMap = {}; // هيكل البيانات: { empId: { dateKey: { in, out } } }

    logs.forEach((log) => {
      // استخراج التاريخ كـ (مفتاح) لتجميع بصمات نفس اليوم
      const dateKey = `${log.punchTime.getFullYear()}-${log.punchTime.getMonth()}-${log.punchTime.getDate()}`;

      if (!attendanceMap[log.employeeId]) attendanceMap[log.employeeId] = {};
      if (!attendanceMap[log.employeeId][dateKey]) {
        attendanceMap[log.employeeId][dateKey] = { in: null, out: null };
      }

      // تسجيل أول بصمة دخول وآخر بصمة خروج في اليوم الواحد
      if (log.type === "حضور" && !attendanceMap[log.employeeId][dateKey].in) {
        attendanceMap[log.employeeId][dateKey].in = log.punchTime;
      } else if (log.type === "انصراف") {
        attendanceMap[log.employeeId][dateKey].out = log.punchTime; // سيتم تحديثها بآخر خروج
      }
    });

    // 5. متغيرات التحليل وحساب الإحصائيات
    let totalAttendances = 0;
    let onTimeAttendances = 0;
    let totalOvertimeMinutes = 0;

    // 💡 سياسات افتراضية (يمكنك لاحقاً جلبها من جدول Policies)
    const SHIFT_START_HOUR = 8; // الدوام يبدأ 8:00 صباحاً
    const GRACE_PERIOD_MINS = 15; // سماحية 15 دقيقة
    const STANDARD_WORK_HOURS = 8.5; // 8 ساعات عمل + نصف ساعة راحة

    Object.keys(attendanceMap).forEach((empId) => {
      const empDays = attendanceMap[empId];

      Object.keys(empDays).forEach((dateKey) => {
        const { in: checkIn, out: checkOut } = empDays[dateKey];
        totalAttendances++;

        // --- أ. حساب نسبة الانضباط (الحضور المبكر أو على الوقت) ---
        if (checkIn) {
          const hour = checkIn.getHours();
          const minute = checkIn.getMinutes();
          // إذا حضر قبل 8:00 أو في حدود وقت السماحية 8:15
          if (
            hour < SHIFT_START_HOUR ||
            (hour === SHIFT_START_HOUR && minute <= GRACE_PERIOD_MINS)
          ) {
            onTimeAttendances++;
          }
        }

        // --- ب. حساب الساعات الإضافية ---
        if (checkIn && checkOut) {
          // حساب مدة البقاء في الشركة بالساعات
          const workedMs = checkOut.getTime() - checkIn.getTime();
          const workedHours = workedMs / (1000 * 60 * 60);

          // إذا تجاوز مدة الدوام الرسمي
          if (workedHours > STANDARD_WORK_HOURS) {
            totalOvertimeMinutes += (workedHours - STANDARD_WORK_HOURS) * 60;
          }
        }
      });
    });

    // --- ج. حساب الغياب المتكرر ---
    // حساب عدد أيام العمل التي مرت في هذا الشهر (باستثناء الجمعة والسبت)
    let workingDaysPassed = 0;
    for (let d = 1; d <= now.getDate(); d++) {
      const dayOfWeek = new Date(now.getFullYear(), now.getMonth(), d).getDay();
      if (dayOfWeek !== 5 && dayOfWeek !== 6) {
        // 5 = الجمعة، 6 = السبت
        workingDaysPassed++;
      }
    }

    let recurringAbsences = 0;
    Object.keys(attendanceMap).forEach((empId) => {
      // كم يوم حضر الموظف فعلياً؟
      const attendedDays = Object.keys(attendanceMap[empId]).length;
      const missedDays = workingDaysPassed - attendedDays;

      // إذا غاب الموظف أكثر من يومين في الشهر الحالي بدون إجازة، يعتبر غياب متكرر
      if (missedDays >= 2) {
        recurringAbsences++;
      }
    });

    // 6. استخراج وتغليف الأرقام النهائية
    const disciplineRate =
      totalAttendances > 0
        ? Math.round((onTimeAttendances / totalAttendances) * 100)
        : 100; // الافتراضي 100% إذا لم يكن هناك بصمات بعد

    const overtimeHours = Math.round(totalOvertimeMinutes / 60);

    const stats = {
      totalEmployees: totalEmployees || 0,
      disciplineRate: disciplineRate,
      recurringAbsences: recurringAbsences,
      overtimeHours: overtimeHours,
    };

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error("[Stats Error]", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 1. جلب سياسات الدوام
exports.getPolicies = async (req, res) => {
  try {
    let policy = await prisma.attendancePolicy.findFirst();
    // إذا لم تكن موجودة مسبقاً، ننشئها بالقيم الافتراضية
    if (!policy) {
      policy = await prisma.attendancePolicy.create({ data: {} });
    }
    res.status(200).json({ success: true, data: policy });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. تحديث سياسات الدوام
exports.updatePolicies = async (req, res) => {
  try {
    const {
      morningGracePeriodMins,
      autoAbsentAfterMins,
      enableAiExcuseApproval,
      enableAiCriticalAlerts,
    } = req.body;

    let policy = await prisma.attendancePolicy.findFirst();

    const updatedPolicy = await prisma.attendancePolicy.update({
      where: { id: policy.id },
      data: {
        morningGracePeriodMins: parseInt(morningGracePeriodMins),
        autoAbsentAfterMins: parseInt(autoAbsentAfterMins),
        enableAiExcuseApproval: Boolean(enableAiExcuseApproval),
        enableAiCriticalAlerts: Boolean(enableAiCriticalAlerts),
      },
    });

    res.status(200).json({ success: true, data: updatedPolicy });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. جلب تقرير مفصل لموظف (Timesheet)
// دالة مساعدة لتحويل الوقت "08:30" إلى دقائق (لتسهيل العمليات الحسابية)
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
};

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

    // 1. جلب بيانات الموظف (مع مواعيد دوامه الخاصة)
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        employeeCode: true,
        name: true,
        department: true,
        position: true,
        shiftStartTime: true,
        shiftEndTime: true,
      },
    });

    if (!employee)
      return res
        .status(404)
        .json({ success: false, message: "الموظف غير موجود" });

    const policy = (await prisma.attendancePolicy.findFirst()) || {
      morningGracePeriodMins: 15,
    };

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
      if (!daysMap[dateKey]) daysMap[dateKey] = { in: null, out: null };
      if (log.type === "حضور" && !daysMap[dateKey].in)
        daysMap[dateKey].in = log.punchTime;
      else if (log.type === "انصراف") daysMap[dateKey].out = log.punchTime;
    });

    const reportLogs = [];
    let totalDelayMins = 0;
    let totalWorkedHours = 0;
    let totalOvertimeMins = 0; // 👈 إضافة الساعات الإضافية

    // 💡 أوقات دوام الموظف الخاصة
    const shiftStartMins = timeToMinutes(employee.shiftStartTime || "08:00");
    const shiftEndMins = timeToMinutes(employee.shiftEndTime || "17:00");

    Object.keys(daysMap)
      .sort()
      .forEach((date) => {
        const { in: checkIn, out: checkOut } = daysMap[date];
        let delay = 0;
        let hours = 0;
        let status = "حاضر";

        if (checkIn) {
          // حساب وقت الدخول الفعلي بالدقائق
          const actualInMins = checkIn.getHours() * 60 + checkIn.getMinutes();

          // حساب التأخير (إذا تأخر عن وقت بداية دوامه + فترة السماحية)
          if (actualInMins > shiftStartMins + policy.morningGracePeriodMins) {
            delay = actualInMins - shiftStartMins;
            totalDelayMins += delay;
            status = "تأخير";
          }

          if (checkOut) {
            hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
            totalWorkedHours += hours;

            // حساب الساعات الإضافية (إذا خرج بعد وقت نهاية دوامه)
            const actualOutMins =
              checkOut.getHours() * 60 + checkOut.getMinutes();
            if (actualOutMins > shiftEndMins) {
              totalOvertimeMins += actualOutMins - shiftEndMins;
            }
          }
        } else {
          status = "غياب";
        }

        reportLogs.push({
          date: date,
          inTime: checkIn
            ? checkIn.toLocaleTimeString("ar-EG", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "-",
          outTime: checkOut
            ? checkOut.toLocaleTimeString("ar-EG", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "-",
          hours: hours > 0 ? hours.toFixed(2) : "-",
          delay: delay > 0 ? delay : 0,
          status: status,
        });
      });

    res.status(200).json({
      success: true,
      data: {
        employee,
        period: `${startDate.toLocaleDateString("ar-EG")} إلى ${endDate.toLocaleDateString("ar-EG")}`,
        logs: reportLogs.reverse(),
        summary: {
          totalHours: totalWorkedHours.toFixed(2),
          totalDelay: totalDelayMins,
          totalOvertime: (totalOvertimeMins / 60).toFixed(2), // 👈 إرجاع الساعات الإضافية
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

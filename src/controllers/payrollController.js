const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ===============================================
// 1. توليد مسير الرواتب لشهر محدد (نظامي)
// POST /api/payrolls/generate
// ===============================================
const generatePayroll = async (req, res) => {
  try {
    const { month } = req.body; 
    if (!month) return res.status(400).json({ message: "يرجى تحديد الشهر" });

    const activeEmployees = await prisma.employee.findMany({
      where: { status: 'active' }
    });

    let generatedCount = 0;

    for (const emp of activeEmployees) {
      const existingRecord = await prisma.payrollRecord.findUnique({
        where: { employeeId_month: { employeeId: emp.id, month: month } }
      });

      if (!existingRecord) {
        const base = emp.baseSalary || 0;
        const housing = base * 0.10; 
        const transport = base * 0.05; 
        const deductions = 0;
        const net = (base + housing + transport) - deductions;

        await prisma.payrollRecord.create({
          data: {
            employeeId: emp.id,
            month: month,
            baseSalary: base,
            housingAllow: housing,
            transportAllow: transport,
            deductions: deductions,
            netSalary: net,
            source: "SYSTEM", // تحديد المصدر كنظام داخلي
            status: "PENDING"
          }
        });
        generatedCount++;
      }
    }

    res.status(200).json({ message: `تم توليد مسير الرواتب بنجاح لـ ${generatedCount} موظف.` });
  } catch (error) {
    console.error("Generate Payroll Error:", error);
    res.status(500).json({ message: "خطأ في خادم قاعدة البيانات أثناء التوليد" });
  }
};

// ===============================================
// 2. جلب مسيرات الرواتب (مع دعم الفلترة)
// GET /api/payrolls?month=2026-05&source=ALL
// ===============================================
const getPayrolls = async (req, res) => {
  try {
    const { month, source } = req.query;
    
    // بناء استعلام الفلترة بناءً على ما يأتي من الفرونت إند
    const queryFilter = {};
    if (month) queryFilter.month = month;
    if (source && source !== 'ALL') queryFilter.source = source;

    const records = await prisma.payrollRecord.findMany({
      where: queryFilter,
      include: {
        employee: {
          select: { name: true, employeeCode: true, department: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json(records);
  } catch (error) {
    console.error("Get Payrolls Error:", error);
    res.status(500).json({ message: "خطأ في جلب بيانات المسيرات" });
  }
};

// ===============================================
// 3. تحديث بيانات القسيمة مالياً
// PUT /api/payrolls/:id
// ===============================================
const updatePayroll = async (req, res) => {
  try {
    const { id } = req.params;
    const { baseSalary, housingAllow, transportAllow, deductions } = req.body;

    const netSalary = (parseFloat(baseSalary) + parseFloat(housingAllow) + parseFloat(transportAllow)) - parseFloat(deductions);

    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: {
        baseSalary: parseFloat(baseSalary),
        housingAllow: parseFloat(housingAllow),
        transportAllow: parseFloat(transportAllow),
        deductions: parseFloat(deductions),
        netSalary: netSalary,
        // لا نحدث الحالة هنا، لتحديث الحالة نستخدم دوال مخصصة
      },
      include: {
        employee: { select: { name: true, employeeCode: true, department: true } }
      }
    });

    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ message: "خطأ أثناء تحديث المسير" });
  }
};

// ===============================================
// 4. إرسال المسير لمشرف العمليات (طلب مراجعة من الموارد البشرية)
// PATCH /api/payrolls/:id/request-review
// ===============================================
const requestSupervisorReview = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: { status: "UNDER_REVIEW" }, // تحويل الحالة للمشرف
      include: { employee: { select: { name: true } } }
    });
    res.status(200).json({ message: "تم إرسال المسير لمشرف العمليات للمراجعة", data: updated });
  } catch (error) {
    res.status(500).json({ message: "خطأ في إرسال طلب المراجعة" });
  }
};

// ===============================================
// 5. اعتماد المسير (خاص بشاشة مشرف العمليات)
// PATCH /api/payrolls/:id/approve
// ===============================================
const approvePayroll = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: { status: "APPROVED" }, // اعتماد نهائي
      include: { employee: { select: { name: true } } }
    });
    res.status(200).json({ message: "تم اعتماد المسير بنجاح", data: updated });
  } catch (error) {
    res.status(500).json({ message: "خطأ في اعتماد المسير" });
  }
};

// ===============================================
// 6. رفع وتحليل ملف مسير مدد
// POST /api/payrolls/upload-mudad
// ===============================================
const uploadMudadPayroll = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "لم يتم رفع أي ملف" });

    // 💡 هنا يتم استدعاء سكريبت الذكاء الاصطناعي الفعلي (Python AI Service)
    // لمحاكاة الأمر: سنفترض أن الذكاء الاصطناعي استخرج الشهر (مثلاً الشهر الحالي) 
    // وقام بتحديث جميع مسيرات النظام للشهر الحالي إلى مدفوعة PAID ومصدرها MUDAD

    const currentMonth = new Date().toISOString().slice(0, 7);

    // محاكاة التحديث: أي مسير معتمد لهذا الشهر يصبح "مدفوع" عبر منصة مدد
    const updateResult = await prisma.payrollRecord.updateMany({
      where: { 
        month: currentMonth,
        status: "APPROVED" // يتم دفع المعتمد فقط
      },
      data: {
        status: "PAID",
        source: "MUDAD"
      }
    });

    res.status(200).json({ 
      message: "تم تحليل ملف مدد ومطابقته بنجاح", 
      processedRecords: updateResult.count 
    });
  } catch (error) {
    console.error("Mudad Upload Error:", error);
    res.status(500).json({ message: "حدث خطأ أثناء تحليل ملف مدد" });
  }
};

// ===============================================
// إجراءات المشرف (اعتماد / إرجاع / رفض)
// POST /api/payrolls/:id/supervisor-action
// ===============================================
const handleSupervisorAction = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, note } = req.body; // action: 'APPROVE', 'RETURN', 'REJECT'

    let newStatus = "UNDER_REVIEW";
    if (action === "APPROVE") newStatus = "APPROVED";
    else if (action === "RETURN") newStatus = "RETURNED";
    else if (action === "REJECT") newStatus = "REJECTED";
    else return res.status(400).json({ message: "إجراء غير صالح" });

    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: { 
        status: newStatus,
        supervisorNote: note || null 
      },
      include: { employee: { select: { name: true } } }
    });

    res.status(200).json({ message: `تم تسجيل الإجراء: ${newStatus}`, data: updated });
  } catch (error) {
    res.status(500).json({ message: "خطأ في تنفيذ إجراء المشرف" });
  }
};

// ===============================================
// إلغاء الاعتماد (Revoke Approval)
// PATCH /api/payrolls/:id/revoke
// ===============================================
const revokeApproval = async (req, res) => {
  try {
    const { id } = req.params;
    
    // إرجاع الحالة إلى "مُرجع للتعديل" لكي يتمكن الموظف المختص من تعديل الأرقام
    const updated = await prisma.payrollRecord.update({
      where: { id, status: "APPROVED" }, // التأكد أنه معتمد فعلاً
      data: { 
        status: "RETURNED",
        supervisorNote: "تم إلغاء الاعتماد لغرض التعديل وإعادة الرفع."
      }
    });

    res.status(200).json({ message: "تم إلغاء الاعتماد وإرجاع المسير للتعديل", data: updated });
  } catch (error) {
    res.status(500).json({ message: "خطأ في إلغاء الاعتماد (قد يكون المسير مدفوعاً بالفعل)" });
  }
};

// ===============================================
// جلب إحصائيات الرواتب لشهر محدد
// GET /api/payrolls/stats?month=2026-05
// ===============================================
const getPayrollStats = async (req, res) => {
  try {
    const { month } = req.query;
    
    // فلتر الشهر إذا تم تمريره
    const whereClause = month ? { month } : {};

    // 1. حساب الإجماليات باستخدام Prisma Aggregate
    const aggregations = await prisma.payrollRecord.aggregate({
      where: whereClause,
      _sum: {
        baseSalary: true,
        housingAllow: true,
        transportAllow: true,
        deductions: true,
        netSalary: true,
      },
      _count: {
        id: true // إجمالي عدد المسيرات
      }
    });

    // 2. حساب عدد المسيرات المدفوعة فقط
    const paidCount = await prisma.payrollRecord.count({
      where: {
        ...whereClause,
        status: 'PAID'
      }
    });

    // تجهيز كائن الاستجابة
    const stats = {
      totalBaseSalary: aggregations._sum.baseSalary || 0,
      totalAllowances: (aggregations._sum.housingAllow || 0) + (aggregations._sum.transportAllow || 0),
      totalDeductions: aggregations._sum.deductions || 0,
      totalNetSalary: aggregations._sum.netSalary || 0,
      totalEmployees: aggregations._count.id || 0,
      paidEmployeesCount: paidCount
    };

    res.status(200).json(stats);
  } catch (error) {
    console.error("Get Payroll Stats Error:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب إحصائيات الرواتب" });
  }
};

module.exports = { 
  generatePayroll, 
  getPayrolls, 
  updatePayroll,
  requestSupervisorReview,
  approvePayroll,
  uploadMudadPayroll,
  handleSupervisorAction,
  revokeApproval,
  getPayrollStats
};
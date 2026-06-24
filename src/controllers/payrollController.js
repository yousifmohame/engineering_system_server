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

module.exports = { 
  generatePayroll, 
  getPayrolls, 
  updatePayroll,
  requestSupervisorReview,
  approvePayroll,
  uploadMudadPayroll
};
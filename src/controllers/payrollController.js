const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ===============================================
// 1. توليد مسير الرواتب لشهر محدد (للموظفين النشطين)
// POST /api/payrolls/generate
// ===============================================
const generatePayroll = async (req, res) => {
  try {
    const { month } = req.body; // مثال: "2026-05"
    if (!month) return res.status(400).json({ message: "يرجى تحديد الشهر" });

    // جلب جميع الموظفين النشطين
    const activeEmployees = await prisma.employee.findMany({
      where: { status: 'active' }
    });

    let generatedCount = 0;

    for (const emp of activeEmployees) {
      // التحقق مما إذا كان هناك مسير رواتب منشأ مسبقاً لهذا الموظف في هذا الشهر
      const existingRecord = await prisma.payrollRecord.findUnique({
        where: { employeeId_month: { employeeId: emp.id, month: month } }
      });

      if (!existingRecord) {
        // افتراضات (يمكنك جلب البدلات من جدول خاص إذا وجد)
        const base = emp.baseSalary || 0;
        const housing = base * 0.10; // بدل سكن 10% كمثال
        const transport = base * 0.05; // بدل نقل 5% كمثال
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
            status: "PENDING"
          }
        });
        generatedCount++;
      }
    }

    res.status(200).json({ message: `تم توليد مسير الرواتب بنجاح لـ ${generatedCount} موظف.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في خادم قاعدة البيانات أثناء التوليد" });
  }
};

// ===============================================
// 2. جلب مسيرات الرواتب لشهر محدد
// GET /api/payrolls?month=2026-05
// ===============================================
const getPayrolls = async (req, res) => {
  try {
    const { month } = req.query;
    const records = await prisma.payrollRecord.findMany({
      where: month ? { month } : {},
      include: {
        employee: {
          select: { name: true, employeeCode: true, department: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json(records);
  } catch (error) {
    res.status(500).json({ message: "خطأ في جلب بيانات المسيرات" });
  }
};

// ===============================================
// 3. تحديث قسيمة الراتب (تعديل بدلات/خصومات أو الحالة)
// PUT /api/payrolls/:id
// ===============================================
const updatePayroll = async (req, res) => {
  try {
    const { id } = req.params;
    const { baseSalary, housingAllow, transportAllow, deductions, status } = req.body;

    const netSalary = (parseFloat(baseSalary) + parseFloat(housingAllow) + parseFloat(transportAllow)) - parseFloat(deductions);

    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: {
        baseSalary: parseFloat(baseSalary),
        housingAllow: parseFloat(housingAllow),
        transportAllow: parseFloat(transportAllow),
        deductions: parseFloat(deductions),
        netSalary: netSalary,
        status: status
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

module.exports = { generatePayroll, getPayrolls, updatePayroll };
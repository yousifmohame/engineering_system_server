// controllers/contractController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ===============================================
// 1. إنشاء عقد جديد (من شاشة 814)
// POST /api/contracts
// ===============================================
const createContract = async (req, res) => {
  try {
    // البيانات من الواجهة (شاشة 814)
    const { 
      contractCode, 
      title, 
      startDate, 
      endDate, 
      totalValue,
      status,
      clientId,     // (مطلوب)
      quotationId   // (اختياري، لربط العقد بعرض السعر)
    } = req.body;

    if (!contractCode || !title || !startDate || !endDate || !totalValue || !clientId) {
      return res.status(400).json({ message: 'البيانات الأساسية للعقد (الكود، العنوان، التواريخ، القيمة، العميل) مطلوبة' });
    }

    const newContract = await prisma.contract.create({
      data: {
        contractCode,
        title,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        totalValue: parseFloat(totalValue),
        status: status || 'Active',
        clientId,
        quotationId, // ربط عرض السعر (إن وجد)
      },
    });
    res.status(201).json(newContract);

  } catch (error) {
    if (error.code === 'P2002') { // خطأ بيانات مكررة
      return res.status(400).json({ message: `خطأ: كود العقد (contractCode) مستخدم بالفعل` });
    }
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 2. جلب جميع العقود (للقائمة في شاشة 814)
// GET /api/contracts
// ===============================================
const getAllContracts = async (req, res) => {
  try {
    const contracts = await prisma.contract.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      // جلب اسم العميل
      include: {
        client: {
          select: { name: true, clientCode: true }
        },
      },
    });
    res.status(200).json(contracts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 3. جلب بيانات عقد واحد (لعرض التابات 814)
// GET /api/contracts/:id
// ===============================================
const getContractById = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await prisma.contract.findUnique({
      where: { id: id },
      include: {
        client: true,       // تفاصيل العميل
        quotation: true,    // تفاصيل عرض السعر
        transactions: true, // المعاملات المرتبطة بهذا العقد
      },
    });

    if (!contract) {
      return res.status(404).json({ message: 'العقد غير موجود' });
    }
    res.status(200).json(contract);

  } catch (error){
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 4. تحديث بيانات عقد
// PUT /api/contracts/:id
// ===============================================
const updateContract = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body; // استلام البيانات المراد تحديثها

    // ضمان تحويل الأنواع بشكل صحيح إذا تم إرسالها
    if (data.startDate) data.startDate = new Date(data.startDate);
    if (data.endDate) data.endDate = new Date(data.endDate);
    if (data.totalValue) data.totalValue = parseFloat(data.totalValue);

    const updatedContract = await prisma.contract.update({
      where: { id: id },
      data: data,
    });
    res.status(200).json(updatedContract);

  } catch (error) {
    if (error.code === 'P2025') {
        return res.status(404).json({ message: 'العقد غير موجود' });
    }
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 5. حذف عقد
// DELETE /api/contracts/:id
// ===============================================
const deleteContract = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.contract.delete({
      where: { id: id },
    });
    res.status(200).json({ message: 'تم حذف العقد بنجاح' });

  } catch (error) {
    if (error.code === 'P2025') {
        return res.status(404).json({ message: 'العقد غير موجود' });
    }
    // خطأ عند محاولة حذف عقد مرتبط بـ "معاملات"
    if (error.code === 'P2003') {
        return res.status(400).json({ message: 'لا يمكن حذف العقد لأنه مرتبط بمعاملات' });
    }
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// تصدير جميع الوظائف
module.exports = {
  createContract,
  getAllContracts,
  getContractById,
  updateContract,
  deleteContract,
};
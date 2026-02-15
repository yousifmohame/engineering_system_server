// controllers/quotationController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ===============================================
// 1. إنشاء عرض سعر جديد (من شاشة 815)
// POST /api/quotations
// ===============================================
const createQuotation = async (req, res) => {
  try {
    // البيانات من الواجهة (شاشة 815)
    const { 
      quotationCode, 
      status, 
      totalValue,
      clientId,     // (مطلوب)
    } = req.body;

    if (!quotationCode || !totalValue || !clientId) {
      return res.status(400).json({ message: 'كود العرض، القيمة الإجمالية، ومعرّف العميل مطلوبة' });
    }

    const newQuotation = await prisma.quotation.create({
      data: {
        quotationCode,
        status: status || 'Pending',
        totalValue: parseFloat(totalValue),
        clientId,
      },
    });
    res.status(201).json(newQuotation);

  } catch (error) {
    if (error.code === 'P2002') { // خطأ بيانات مكررة
      return res.status(400).json({ message: `خطأ: كود عرض السعر (quotationCode) مستخدم بالفعل` });
    }
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 2. جلب جميع عروض الأسعار (للقائمة في شاشة 815)
// GET /api/quotations
// ===============================================
const getAllQuotations = async (req, res) => {
  try {
    const quotations = await prisma.quotation.findMany({
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
    res.status(200).json(quotations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 3. جلب بيانات عرض سعر واحد (لعرض التابات 815)
// GET /api/quotations/:id
// ===============================================
const getQuotationById = async (req, res) => {
  try {
    const { id } = req.params;
    const quotation = await prisma.quotation.findUnique({
      where: { id: id },
      include: {
        client: true,   // تفاصيل العميل
        contract: true, // العقد الذي تحول إليه (إن وجد)
      },
    });

    if (!quotation) {
      return res.status(404).json({ message: 'عرض السعر غير موجود' });
    }
    res.status(200).json(quotation);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 4. تحديث بيانات عرض سعر (مثل تغيير الحالة)
// PUT /api/quotations/:id
// ===============================================
const updateQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, totalValue } = req.body;

    const dataToUpdate = {};
    if (status) dataToUpdate.status = status;
    if (totalValue) dataToUpdate.totalValue = parseFloat(totalValue);

    const updatedQuotation = await prisma.quotation.update({
      where: { id: id },
      data: dataToUpdate,
    });
    res.status(200).json(updatedQuotation);

  } catch (error) {
    if (error.code === 'P2025') {
        return res.status(404).json({ message: 'عرض السعر غير موجود' });
    }
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 5. حذف عرض سعر
// DELETE /api/quotations/:id
// ===============================================
const deleteQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.quotation.delete({
      where: { id: id },
    });
    res.status(200).json({ message: 'تم حذف عرض السعر بنجاح' });

  } catch (error) {
    if (error.code === 'P2025') {
        return res.status(404).json({ message: 'عرض السعر غير موجود' });
    }
     // خطأ عند محاولة حذف عرض سعر مرتبط بـ "عقد"
    if (error.code === 'P2003') {
        return res.status(400).json({ message: 'لا يمكن حذف عرض السعر لأنه مرتبط بعقد' });
    }
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// تصدير جميع الوظائف
module.exports = {
  createQuotation,
  getAllQuotations,
  getQuotationById,
  updateQuotation,
  deleteQuotation,
};
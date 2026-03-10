const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 1. جلب جميع المكاتب المتعاونة
const getOffices = async (req, res) => {
  try {
    const offices = await prisma.coopOffice.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        // 💡 جلب اسم المسؤول من جدول الأشخاص
        responsible: { select: { name: true } },
      },
    });

    const formattedOffices = offices.map((office) => ({
      id: office.id,
      name: office.name,
      contactName: office.contactName || "غير محدد",
      phone: office.phone || "—",
      agreementType: office.agreementType,
      monthlyAmount:
        office.monthlyAmount > 0 ? `${office.monthlyAmount} ر.س` : "—",
      // 💡 قراءة الاسم من العلاقة، والاحتفاظ بالـ ID للتعديل
      responsible: office.responsible?.name || "—",
      responsibleId: office.responsibleId || "",
      isLinkedToSystem: office.isLinkedToSystem ? "مفعل" : "غير مفعل",
      notes: office.notes || "لا توجد ملاحظات",
      txCount: 0,
      pendingSettlement: "0",
      paidSettlement: "0",
    }));

    res.json({ success: true, data: formattedOffices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. إضافة مكتب جديد
const createOffice = async (req, res) => {
  try {
    const data = req.body;
    const newOffice = await prisma.coopOffice.create({
      data: {
        name: data.name,
        contactName: data.contactName,
        phone: data.phone,
        agreementType: data.agreementType,
        monthlyAmount: parseFloat(data.monthlyAmount) || 0,
        // 💡 حفظ הـ ID الخاص بالمسؤول
        responsibleId: data.responsibleId || null,
        isLinkedToSystem: data.isLinkedToSystem === "مفعل",
        notes: data.notes,
      },
    });
    res.status(201).json({ success: true, data: newOffice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. تعديل بيانات مكتب
const updateOffice = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const updatedOffice = await prisma.coopOffice.update({
      where: { id },
      data: {
        name: data.name,
        contactName: data.contactName,
        phone: data.phone,
        agreementType: data.agreementType,
        monthlyAmount: parseFloat(data.monthlyAmount) || 0,
        // 💡 حفظ הـ ID الخاص بالمسؤول
        responsibleId: data.responsibleId || null,
        isLinkedToSystem: data.isLinkedToSystem === "مفعل",
        notes: data.notes,
      },
    });
    res.json({ success: true, data: updatedOffice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. حذف مكتب (إضافة جديدة)
const deleteOffice = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.coopOffice.delete({ where: { id } });
    res.json({ success: true, message: "تم حذف المكتب بنجاح" });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "لا يمكن الحذف بسبب وجود ارتباطات مالية أو معاملات.",
      });
  }
};

module.exports = { getOffices, createOffice, updateOffice, deleteOffice };

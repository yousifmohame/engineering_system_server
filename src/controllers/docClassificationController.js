// controllers/docClassificationController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// جلب جميع التصنيفات
exports.getClassifications = async (req, res) => {
  try {
    const classifications = await prisma.documentClassification.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true } } }
    });
    res.status(200).json(classifications);
  } catch (error) {
    res.status(500).json({ message: "خطأ في جلب التصنيفات", error: error.message });
  }
};

// إنشاء تصنيف جديد
exports.createClassification = async (req, res) => {
  const { name, color, description } = req.body;
  const createdById = req.user.id;

  if (!name || !color) {
    return res.status(400).json({ message: "الاسم واللون مطلوبان" });
  }

  try {
    const newClassification = await prisma.documentClassification.create({
      data: {
        name,
        color,
        description,
        createdById,
      }
    });
    res.status(201).json(newClassification);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'تصنيف بهذا الاسم موجود بالفعل' });
    }
    res.status(500).json({ message: "خطأ في إنشاء التصنيف", error: error.message });
  }
};

// تحديث تصنيف
exports.updateClassification = async (req, res) => {
  const { id } = req.params;
  const { name, color, description } = req.body;

  try {
    const updatedClassification = await prisma.documentClassification.update({
      where: { id },
      data: { name, color, description }
    });
    res.status(200).json(updatedClassification);
  } catch (error) {
     if (error.code === 'P2002') {
      return res.status(400).json({ message: 'تصنيف بهذا الاسم موجود بالفعل' });
    }
    res.status(500).json({ message: "خطأ في تحديث التصنيف", error: error.message });
  }
};

// حذف تصنيف
exports.deleteClassification = async (req, res) => {
  const { id } = req.params;
  try {
    // (ملاحظة: Prisma سيمنع الحذف إذا كان التصنيف مستخدماً، وهذا جيد)
    await prisma.documentClassification.delete({
      where: { id }
    });
    res.status(200).json({ message: "تم حذف التصنيف بنجاح" });
  } catch (error) {
    if (error.code === 'P2003') {
      // خطأ في مفتاح الربط (Foreign key constraint failed)
      return res.status(400).json({ message: 'لا يمكن حذف التصنيف لأنه مستخدم حالياً في بعض الوثائق' });
    }
    res.status(500).json({ message: "خطأ في حذف التصنيف", error: error.message });
  }
};
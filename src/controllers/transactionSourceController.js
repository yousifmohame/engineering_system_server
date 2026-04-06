const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// جلب كل المصادر
exports.getSources = async (req, res) => {
  try {
    const sources = await prisma.transactionSource.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' }
    });
    res.json({ success: true, data: sources });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// إضافة مصدر جديد
exports.addSource = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "اسم المصدر مطلوب" });

    const source = await prisma.transactionSource.create({
      data: { name: name.trim() }
    });
    res.json({ success: true, data: source, message: "تم إضافة المصدر بنجاح" });
  } catch (error) {
    // معالجة خطأ تكرار الاسم
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: "هذا المصدر موجود مسبقاً" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// حذف مصدر
exports.deleteSource = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.transactionSource.delete({
      where: { id }
    });
    res.json({ success: true, message: "تم حذف المصدر بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: "لا يمكن حذف المصدر، قد يكون مرتبطاً ببيانات أخرى" });
  }
};
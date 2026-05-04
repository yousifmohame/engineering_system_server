const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 1. جلب إشعارات الموظف المسجل دخوله
exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    // 👈 التعديل هنا: systemNotification
    const notifications = await prisma.systemNotification.findMany({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50 
    });
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل جلب الإشعارات" });
  }
};

// 2. تعيين إشعار كمقروء
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    // 👈 التعديل هنا
    await prisma.systemNotification.update({
      where: { id },
      data: { isRead: true }
    });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "حدث خطأ" });
  }
};

// 3. تعيين كل الإشعارات كمقروءة
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    // 👈 التعديل هنا
    await prisma.systemNotification.updateMany({
      where: { userId: userId, isRead: false },
      data: { isRead: true }
    });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
};

// 4. دالة (تُستخدم داخلياً في الباك إند) لإنشاء إشعار جديد
exports.createSystemNotification = async (userId, title, message, type = 'info') => {
  try {
    // 👈 التعديل هنا
    await prisma.systemNotification.create({
      data: { userId, title, message, type }
    });
  } catch (error) {
    console.error("فشل إرسال الإشعار:", error);
  }
};
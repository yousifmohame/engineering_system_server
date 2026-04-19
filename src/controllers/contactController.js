const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ==========================================
// 1. جلب جميع جهات الاتصال
// ==========================================
exports.getContacts = async (req, res) => {
  try {
    const contacts = await prisma.contact.findMany({
      orderBy: [
        { isFavorite: 'desc' }, // المفضلون أولاً
        { createdAt: 'desc' }
      ]
    });
    
    res.json({ success: true, data: contacts });
  } catch (error) {
    console.error("Get Contacts Error:", error);
    res.status(500).json({ success: false, message: "فشل جلب جهات الاتصال" });
  }
};

// ==========================================
// 2. إضافة جهة اتصال جديدة
// ==========================================
exports.createContact = async (req, res) => {
  try {
    const data = req.body;
    
    if (!data.mobile1 || !data.displayName) {
      return res.status(400).json({ success: false, message: "الاسم ورقم الجوال مطلوبان" });
    }

    const newContact = await prisma.contact.create({
      data: {
        contactCode: `CNT-${Math.floor(1000 + Math.random() * 9000)}`, // توليد كود عشوائي
        displayName: data.displayName,
        nameAr: data.displayName,
        mobile1: data.mobile1,
        email1: data.email1 || null,
        capacity: data.capacity || null,
        isFavorite: data.isFavorite || false,
        status: data.status || 'active',
        
        // الافتراضيات
        detailedType: 'client',
        isActualClient: false,
        
        // تحديد تفضيلات التواصل بناءً على توفر البيانات
        acceptsEmail: !!data.email1,
        acceptsWhatsApp: true,
        acceptsSMS: true,
        acceptsTelegram: false,
      }
    });

    res.status(201).json({ success: true, data: newContact, message: "تم إضافة جهة الاتصال بنجاح" });
  } catch (error) {
    console.error("Create Contact Error:", error);
    res.status(500).json({ success: false, message: "خطأ في حفظ جهة الاتصال" });
  }
};

// ==========================================
// 3. تعديل جهة اتصال موجودة
// ==========================================
exports.updateContact = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updatedContact = await prisma.contact.update({
      where: { id },
      data: {
        displayName: data.displayName,
        nameAr: data.displayName,
        mobile1: data.mobile1,
        email1: data.email1 || null,
        capacity: data.capacity || null,
        isFavorite: data.isFavorite,
        status: data.status,
        acceptsEmail: !!data.email1, // تحديث القبول إذا تم إضافة/حذف الإيميل
      }
    });

    res.json({ success: true, data: updatedContact, message: "تم تعديل جهة الاتصال بنجاح" });
  } catch (error) {
    console.error("Update Contact Error:", error);
    res.status(500).json({ success: false, message: "خطأ في تعديل جهة الاتصال" });
  }
};

// ==========================================
// 4. حذف جهة اتصال
// ==========================================
exports.deleteContact = async (req, res) => {
  try {
    const { id } = req.params;
    
    await prisma.contact.delete({ 
      where: { id } 
    });

    res.json({ success: true, message: "تم حذف جهة الاتصال بنجاح" });
  } catch (error) {
    console.error("Delete Contact Error:", error);
    res.status(500).json({ success: false, message: "خطأ في حذف جهة الاتصال" });
  }
};
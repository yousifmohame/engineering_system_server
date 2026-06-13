const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");

// ===============================================
// 1. رفع مرفق جديد وحفظه في قاعدة البيانات
// ===============================================
const uploadAttachment = async (req, res) => {
  try {
    const uploader = req.user || req.employee;
    if (!uploader || !uploader.id) {
      // تنظيف: إذا فشل المستخدم، نحذف الملف الذي رفعه المولتر
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(401).json({ message: "غير مصرح" });
    }

    if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });

    // Multer قام بالحفظ بالفعل في المسار الصحيح
    // req.file.filename هو الاسم الذي اختاره Multer
    // req.file.path هو المسار الكامل على السيرفر
    
    const dbFilePath = `/uploads/attachments/${req.file.filename}`;

    const newAttachment = await prisma.attachment.create({
      data: {
        fileName: req.file.originalname,
        filePath: dbFilePath, // المسار الذي سيتم استخدامه في المتصفح
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        category: req.body.category || "OTHER",
        uploadedById: uploader.id,
        // الربط الديناميكي... (نفس الكود السابق)
      },
      include: { uploadedBy: { select: { name: true } } }
    });

    res.status(201).json({ message: "تم", attachment: newAttachment });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path); // تنظيف عند الخطأ
    res.status(500).json({ message: "خطأ" });
  }
};

// ===============================================
// 2. الرفع العام (خارج الجداول المنظمة)
// ===============================================
const uploadGeneralFile = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم رفع أي ملف" });
    }

    // بما أن multer رفعه في مجلد general
    const fileUrl = `/uploads/general/${req.file.filename}`;

    res.status(200).json({
      success: true,
      message: "تم رفع الملف العام بنجاح",
      url: fileUrl,
      name: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: "حدث خطأ داخلي" });
  }
};

// ===============================================
// 3. جلب مرفقات الموظف (تم إضافتها سابقاً)
// ===============================================
const getAttachmentsForEmployee = async (req, res) => {
  try {
    const attachments = await prisma.attachment.findMany({
      where: { employeeId: req.params.employeeId },
      include: { uploadedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json(attachments);
  } catch (error) {
    res.status(500).json({ message: "خطأ في جلب المرفقات" });
  }
};

// ===============================================
// 4. جلب مرفقات معاملة
// ===============================================
const getAttachmentsForTransaction = async (req, res) => {
  try {
    const attachments = await prisma.attachment.findMany({
      where: { transactionId: req.params.transactionId },
      include: { uploadedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json(attachments);
  } catch (error) {
    res.status(500).json({ message: "خطأ في جلب المرفقات" });
  }
};

// ===============================================
// 5. حذف مرفق
// ===============================================
const deleteAttachment = async (req, res) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.id },
    });
    if (!attachment)
      return res.status(404).json({ message: "المرفق غير موجود" });

    const absolutePath = path.join(__dirname, "../../", attachment.filePath);

    // محاولة حذف الملف الفعلي من الهارد ديسك
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    await prisma.attachment.delete({ where: { id: req.params.id } });
    res.status(200).json({ message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ message: "خطأ أثناء الحذف" });
  }
};

module.exports = {
  uploadAttachment,
  uploadGeneralFile,
  getAttachmentsForEmployee,
  getAttachmentsForTransaction,
  deleteAttachment,
};

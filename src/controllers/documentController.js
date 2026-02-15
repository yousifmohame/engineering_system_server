// controllers/documentController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');

// دالة مساعدة لإنشاء رقم ملف فريد
const generateFileNumber = async () => {
  const count = await prisma.document.count();
  const nextId = (count + 1).toString().padStart(3, '0');
  return `FILE-901-${nextId}`;
};

// 1. جلب الإحصائيات (لتاب 901-01)
exports.getDocumentStats = async (req, res) => {
  try {
    const totalFiles = await prisma.document.count({ where: { type: 'file' } });
    const totalFolders = await prisma.document.count({ where: { type: 'folder' } });
    
    const sizeResult = await prisma.document.aggregate({
      _sum: { size: true },
      where: { type: 'file' }
    });
    const totalSize = sizeResult._sum.size || 0;

    const confidentialFiles = await prisma.document.count({
    where: {
      classification: {         // ابحث في العلاقة "classification"
        name: {                 // حيث الحقل "name"
          in: [                 // هو واحد من هذه القيم
            "سري",
            "سري جداً",
            "سري للغاية"
          ]
        }
      }
    }
  });
    const sharedFiles = await prisma.document.count({ where: { isShared: true } });

    const downloadsResult = await prisma.document.aggregate({
      _sum: { downloads: true }
    });
    const totalDownloads = downloadsResult._sum.downloads || 0;

    res.status(200).json({
      totalFiles,
      totalFolders,
      totalSize,
      confidentialFiles,
      sharedFiles,
      totalDownloads
    });
  } catch (error) {
    res.status(500).json({ message: "خطأ في جلب الإحصائيات", error: error.message });
  }
};

// 2. جلب قائمة الملفات والمجلدات (لتاب 901-02)
exports.getDocuments = async (req, res) => {
  const { search, parentId } = req.query;
  let where = {};

  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  if (parentId === 'root' || !parentId) {
    where.parentId = null;
  } else {
    where.parentId = parentId;
  }

  try {
    const documents = await prisma.document.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        // --- ✅ هذا هو السطر الجديد ---
        _count: {
          select: { children: true } // سيجلب عدد العناصر (ملفات + مجلدات)
        }
        // -------------------------
      },
      orderBy: [
        { type: 'desc' }, 
        { name: 'asc' }
      ]
    });

    // تنسيق البيانات لتطابق الواجهة
    const formattedDocuments = documents.map(doc => ({
      ...doc,
      owner: doc.owner.name,
      modified: doc.modifiedAt.toISOString().split('T')[0],
      created: doc.createdAt.toISOString().split('T')[0],
      // (سيتم تمرير _count تلقائياً)
    }));

    res.status(200).json(formattedDocuments);
  } catch (error) {
    res.status(500).json({ message: "خطأ في جلب الوثائق", error: error.message });
  }
};

// 3. رفع ملف جديد
exports.uploadDocument = async (req, res) => {
  try {
    // req.file يأتي من "multer"
    // req.body يأتي من حقول FormData
    const { classificationId, parentId, path: virtualPath, tags } = req.body;
    const { file } = req;

    if (!file) {
      return res.status(400).json({ message: "الرجاء إرفاق ملف" });
    }

    const newDocument = await prisma.document.create({
      data: {
        fileNumber: await generateFileNumber(),
        name: file.originalname,
        type: 'file',
        extension: path.extname(file.originalname).substring(1),
        size: file.size,
        filePath: file.path, // المسار الفعلي من multer
        path: virtualPath || '/', // المسار الافتراضي
        classificationId: classificationId || null,
        tags: tags ? tags.split(',') : [],
        ownerId: req.user.id, // req.user يأتي من middleware "protect"
        parentId: parentId || null,
      }
    });

    // تسجيل النشاط
    await prisma.documentActivity.create({
      data: {
        documentId: newDocument.id,
        fileName: newDocument.name,
        action: 'upload',
        userId: req.user.id,
        details: `تم رفع الملف بحجم ${(file.size / 1000).toFixed(0)} KB`
      }
    });

    res.status(201).json(newDocument);
  } catch (error) {
    res.status(500).json({ message: "خطأ أثناء رفع الملف", error: error.message });
  }
};

// 4. جلب سجل الأنشطة (لتاب 901-11)
exports.getDocumentActivities = async (req, res) => {
  try {
    const activities = await prisma.documentActivity.findMany({
      take: 50,
      orderBy: { timestamp: 'desc' },
      include: {
        user: { select: { name: true } }
      }
    });
    
    // --- ✅ إصلاح التاريخ: أرسل التاريخ الخام كما هو ---
    // لا تقم بتنسيقه هنا، فقط قم بتبسيط اسم المستخدم
    const formattedActivities = activities.map(act => ({
      ...act, // هذا يتضمن 'timestamp' كـ ISO string
      user: act.user.name,
    }));
    // ---------------------------------------------

    res.status(200).json(formattedActivities);
  } catch (error) {
    res.status(500).json({ message: "خطأ في جلب الأنشطة", error: error.message });
  }
};

// 5. تنزيل ملف
exports.downloadDocument = async (req, res) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id }
    });

    if (!document || !document.filePath) {
      return res.status(404).json({ message: "الملف غير موجود" });
    }

    // زيادة عداد التنزيلات
    await prisma.document.update({
      where: { id: req.params.id },
      data: { downloads: { increment: 1 } }
    });

    // تسجيل النشاط
     await prisma.documentActivity.create({
      data: {
        documentId: document.id,
        fileName: document.name,
        action: 'download',
        userId: req.user.id,
      }
    });

    // إرسال الملف للتنزيل
    const absolutePath = path.resolve(document.filePath);
    res.download(absolutePath, document.name); // إرسال الملف مع اسمه الأصلي

  } catch (error) {
     res.status(500).json({ message: "خطأ أثناء تنزيل الملف", error: error.message });
  }
};

// 6. حذف ملف
exports.deleteDocument = async (req, res) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id }
    });

    if (!document) {
      return res.status(404).json({ message: "الملف غير موجود" });
    }
    
    // (اختياري: التحقق من الصلاحيات هنا، هل المستخدم هو المالك أو لديه صلاحية حذف؟)

    // 1. حذف الملف الفعلي من الخادم
    if (document.filePath && fs.existsSync(document.filePath)) {
      fs.unlinkSync(document.filePath);
    }

    // 2. حذف السجل من قاعدة البيانات
    // (سيتم حذف الأنشطة والصلاحيات المرتبطة به تلقائياً بسبب onDelete: Cascade)
    await prisma.document.delete({
      where: { id: req.params.id }
    });

    res.status(200).json({ message: "تم حذف الملف بنجاح" });
  } catch (error) {
     res.status(500).json({ message: "خطأ أثناء حذف الملف", error: error.message });
  }
};
// --- ✅ أضف هذه الدالة الجديدة بالكامل ---
// 7. إنشاء مجلد جديد
exports.createFolder = async (req, res) => {
  try {
    const { name, classificationId, parentId, path: virtualPath } = req.body;
    const ownerId = req.user.id;

    if (!name) {
      return res.status(400).json({ message: "اسم المجلد مطلوب" });
    }

    const newFolder = await prisma.document.create({
      data: {
        fileNumber: await generateFileNumber(), // (نستخدم نفس الدالة المساعدة)
        name: name,
        type: 'folder', // <-- أهم فرق
        extension: null,
        size: null,
        filePath: null, // <-- لا يوجد ملف فعلي
        path: virtualPath || '/',
        classificationId: classificationId || null,
        tags: [],
        ownerId: ownerId,
        parentId: parentId && parentId !== 'root' ? parentId : null,
      }
    });

    // تسجيل النشاط
    await prisma.documentActivity.create({
      data: {
        documentId: newFolder.id,
        fileName: newFolder.name,
        action: 'folder_create', // (يمكنك إضافة هذا النوع)
        userId: ownerId,
        details: `تم إنشاء مجلد جديد`
      }
    });

    res.status(201).json(newFolder);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'مجلد بهذا الاسم موجود بالفعل في نفس المسار' });
    }
    res.status(500).json({ message: "خطأ أثناء إنشاء المجلد", error: error.message });
  }
};
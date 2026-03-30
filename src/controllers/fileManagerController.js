const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 1. إعداد Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, "../../uploads/transactions");
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage }).array("files");

// 2. جلب محتويات المجلد
const getFolderContents = async (req, res) => {
  try {
    const { transactionId, folderId } = req.query;

    const validFolderId =
      !folderId ||
      folderId === "" ||
      folderId === "null" ||
      folderId === "undefined"
        ? null
        : folderId;

    const folders = await prisma.transactionFolder.findMany({
      where: { transactionId, parentId: validFolderId },
      orderBy: { createdAt: "asc" },
    });

    const files = await prisma.transactionFile.findMany({
      where: { transactionId, folderId: validFolderId },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, folders, files });
  } catch (error) {
    console.error("Error in getFolderContents:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. إنشاء مجلد (مع تسجيل من قام بالتعديل)
const createFolder = async (req, res) => {
  try {
    const { name, transactionId, parentId, createdBy } = req.body;

    const validParentId =
      !parentId ||
      parentId === "" ||
      parentId === "null" ||
      parentId === "undefined"
        ? null
        : parentId;

    // استخدام Transaction لضمان إنشاء المجلد وتحديث المعاملة معاً
    const [folder] = await prisma.$transaction([
      prisma.transactionFolder.create({
        data: { name, transactionId, parentId: validParentId },
      }),
      // 💡 تحديث بيانات المعاملة (آخر من عدل)
      prisma.privateTransaction.update({
        where: { id: transactionId },
        data: { modifiedBy: createdBy || "النظام" },
      }),
    ]);

    res.json({ success: true, folder });
  } catch (error) {
    console.error("Error in createFolder:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. رفع الملفات (مع تسجيل من قام بالرفع)
const uploadFiles = async (req, res) => {
  upload(req, res, async (err) => {
    if (err)
      return res.status(500).json({ success: false, message: "فشل الرفع" });

    try {
      const { transactionId, folderId, uploadedBy } = req.body;
      const validFolderId =
        !folderId ||
        folderId === "" ||
        folderId === "null" ||
        folderId === "undefined"
          ? null
          : folderId;

      const uploadedFiles = [];

      for (const file of req.files) {
        const newFile = await prisma.transactionFile.create({
          data: {
            name: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            extension: path
              .extname(file.originalname)
              .replace(".", "")
              .toLowerCase(),
            size: file.size,
            url: `/uploads/transactions/${file.filename}`,
            transactionId,
            folderId: validFolderId,
            uploadedBy: uploadedBy || "النظام",
          },
        });
        uploadedFiles.push(newFile);
      }

      // 💡 تحديث المعاملة بعد نجاح الرفع لتسجيل اسم الموظف
      await prisma.privateTransaction.update({
        where: { id: transactionId },
        data: { modifiedBy: uploadedBy || "النظام" },
      });

      res.json({ success: true, files: uploadedFiles });
    } catch (error) {
      console.error("Error in uploadFiles:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });
};

// 5. الحذف (مع تسجيل من قام بالحذف)
const deleteItems = async (req, res) => {
  try {
    const { fileIds, folderIds, transactionId, deletedBy } = req.body;

    if (fileIds && fileIds.length > 0) {
      await prisma.transactionFile.deleteMany({
        where: { id: { in: fileIds } },
      });
    }
    if (folderIds && folderIds.length > 0) {
      await prisma.transactionFolder.deleteMany({
        where: { id: { in: folderIds } },
      });
    }

    // 💡 تحديث المعاملة بتسجيل عملية الحذف
    if (transactionId) {
      await prisma.privateTransaction.update({
        where: { id: transactionId },
        data: { modifiedBy: deletedBy || "النظام" },
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error in deleteItems:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. جلب تصنيفات المجلدات
const getCategories = async (req, res) => {
  try {
    const categories = await prisma.folderCategory.findMany({
      orderBy: { order: "asc" },
    });
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 7. حفظ التصنيفات
const saveCategories = async (req, res) => {
  try {
    const { categories } = req.body;
    if (!categories || !Array.isArray(categories)) {
      return res
        .status(400)
        .json({ success: false, message: "بيانات غير صالحة" });
    }

    await prisma.$transaction([
      prisma.folderCategory.deleteMany({}),
      prisma.folderCategory.createMany({
        data: categories.map((cat, index) => ({
          id: cat.id,
          name: cat.name,
          code: cat.code || null,
          icon: cat.icon,
          color: cat.color,
          order: cat.order || index + 1,
          subFolders: cat.subFolders || [],
        })),
      }),
    ]);

    res.json({ success: true, message: "تم حفظ إعدادات المجلدات بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getFolderContents,
  createFolder,
  uploadFiles,
  deleteItems,
  getCategories,
  saveCategories,
};

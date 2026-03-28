const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 1. إعداد Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, "../uploads/transactions");
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage }).array("files");

// 2. جلب محتويات المجلد (محمي من القيم الفارغة)
const getFolderContents = async (req, res) => {
  try {
    const { transactionId, folderId } = req.query;

    // 💡 حماية: تحويل النص الفارغ أو كلمة null إلى القيمة البرمجية null
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

// 3. إنشاء مجلد (محمي من القيم الفارغة)
const createFolder = async (req, res) => {
  try {
    const { name, transactionId, parentId } = req.body;

    // 💡 حماية: نفس المعالجة للـ parentId
    const validParentId =
      !parentId ||
      parentId === "" ||
      parentId === "null" ||
      parentId === "undefined"
        ? null
        : parentId;

    const folder = await prisma.transactionFolder.create({
      data: { name, transactionId, parentId: validParentId },
    });
    res.json({ success: true, folder });
  } catch (error) {
    console.error("Error in createFolder:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. رفع الملفات
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
            folderId: validFolderId, // 💡 استخدام الـ ID المحمي
            uploadedBy: uploadedBy || "النظام",
          },
        });
        uploadedFiles.push(newFile);
      }

      res.json({ success: true, files: uploadedFiles });
    } catch (error) {
      console.error("Error in uploadFiles:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });
};

// 5. الحذف
const deleteItems = async (req, res) => {
  try {
    const { fileIds, folderIds } = req.body;
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
    res.json({ success: true });
  } catch (error) {
    console.error("Error in deleteItems:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getFolderContents, createFolder, uploadFiles, deleteItems };

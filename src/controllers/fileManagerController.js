const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto"); // 💡 لاستخراج بصمة الملفات

// ==================================================
// 💡 إعدادات الرفع (Multer)
// ==================================================
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

// ==================================================
// 💡 دالة التدقيق المركزي (Audit Logger)
// ==================================================
const logActivity = async (
  req,
  action,
  performedBy,
  fileId,
  folderId,
  details,
) => {
  try {
    await prisma.fileActivityLog.create({
      data: {
        fileId: fileId || null,
        folderId: folderId || null,
        action,
        performedBy: performedBy || "النظام",
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers["user-agent"],
        details: details || {},
      },
    });
  } catch (error) {
    console.error("Audit Log Error:", error.message);
  }
};

// ==================================================
// 1. جلب المحتويات (الملفات والمجلدات النشطة فقط)
// ==================================================
const getFolderContents = async (req, res) => {
  try {
    const { transactionId, folderId } = req.query;
    const validFolderId =
      !folderId || folderId === "" || folderId === "null" ? null : folderId;

    // جلب المجلدات غير المحذوفة
    const folders = await prisma.transactionFolder.findMany({
      where: { transactionId, parentId: validFolderId, isDeleted: false },
      orderBy: { createdAt: "asc" },
    });

    // جلب الملفات غير المحذوفة
    const files = await prisma.transactionFile.findMany({
      where: { transactionId, folderId: validFolderId, isDeleted: false },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, folders, files });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 2. إنشاء مجلد (مع سجل التدقيق)
// ==================================================
const createFolder = async (req, res) => {
  try {
    const { name, transactionId, parentId, createdBy } = req.body;
    const validParentId =
      !parentId || parentId === "" || parentId === "null" ? null : parentId;

    const [folder] = await prisma.$transaction([
      prisma.transactionFolder.create({
        data: {
          name,
          transactionId,
          parentId: validParentId,
          createdBy: createdBy || "النظام",
        },
      }),
      prisma.privateTransaction.update({
        where: { id: transactionId },
        data: { modifiedBy: createdBy || "النظام" },
      }),
    ]);

    await logActivity(req, "CREATE_FOLDER", createdBy, null, folder.id, {
      folderName: name,
    });

    res.json({ success: true, folder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 3. رفع الملفات (نظام الإصدارات والبصمة)
// ==================================================
const uploadFiles = async (req, res) => {
  upload(req, res, async (err) => {
    if (err)
      return res.status(500).json({ success: false, message: "فشل الرفع" });

    try {
      const { transactionId, folderId, uploadedBy } = req.body;
      const validFolderId =
        !folderId || folderId === "" || folderId === "null" ? null : folderId;
      const uploadedFiles = [];

      for (const file of req.files) {
        const filePath = path.join(
          __dirname,
          "../../uploads/transactions",
          file.filename,
        );
        const fileBuffer = fs.readFileSync(filePath);
        const fileHash = crypto
          .createHash("md5")
          .update(fileBuffer)
          .digest("hex");

        // 💡 البحث إذا كان هناك ملف بنفس الاسم الأصلي في نفس المجلد
        const existingFile = await prisma.transactionFile.findFirst({
          where: {
            originalName: file.originalname,
            folderId: validFolderId,
            transactionId,
            isDeleted: false,
          },
        });

        if (existingFile) {
          // 💡 نظام الإصدارات: نقل القديم إلى سجل الإصدارات
          await prisma.fileVersion.create({
            data: {
              fileId: existingFile.id,
              versionNumber: existingFile.version,
              url: existingFile.url,
              size: existingFile.size,
              uploadedBy: existingFile.uploadedBy,
              changeNotes: "تم رفع إصدار أحدث",
            },
          });

          // تحديث الملف الأساسي ليكون هو الإصدار الجديد
          const updatedFile = await prisma.transactionFile.update({
            where: { id: existingFile.id },
            data: {
              name: file.filename,
              url: `/uploads/transactions/${file.filename}`,
              size: file.size,
              fileHash: fileHash,
              version: existingFile.version + 1,
              uploadedBy: uploadedBy || "النظام",
              updatedBy: uploadedBy || "النظام",
            },
          });

          uploadedFiles.push(updatedFile);
          await logActivity(
            req,
            "UPLOAD_NEW_VERSION",
            uploadedBy,
            updatedFile.id,
            validFolderId,
            { version: updatedFile.version, fileName: file.originalname },
          );
        } else {
          // 💡 ملف جديد تماماً
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
              fileHash: fileHash,
              transactionId,
              folderId: validFolderId,
              uploadedBy: uploadedBy || "النظام",
            },
          });

          uploadedFiles.push(newFile);
          await logActivity(
            req,
            "UPLOAD_FILE",
            uploadedBy,
            newFile.id,
            validFolderId,
            { fileName: file.originalname },
          );
        }
      }

      await prisma.privateTransaction.update({
        where: { id: transactionId },
        data: { modifiedBy: uploadedBy || "النظام" },
      });

      res.json({ success: true, files: uploadedFiles });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
};

// ==================================================
// 4. إعادة التسمية (Rename)
// ==================================================
const renameItem = async (req, res) => {
  try {
    const { id, type, newName, modifiedBy } = req.body;
    if (!id || !type || !newName)
      return res
        .status(400)
        .json({ success: false, message: "بيانات غير مكتملة" });

    if (type === "folder") {
      const oldFolder = await prisma.transactionFolder.findUnique({
        where: { id },
      });
      await prisma.transactionFolder.update({
        where: { id },
        data: { name: newName, updatedBy: modifiedBy },
      });
      await logActivity(req, "RENAME_FOLDER", modifiedBy, null, id, {
        oldName: oldFolder.name,
        newName,
      });
    } else if (type === "file") {
      const oldFile = await prisma.transactionFile.findUnique({
        where: { id },
      });
      await prisma.transactionFile.update({
        where: { id },
        data: { originalName: newName, updatedBy: modifiedBy },
      });
      await logActivity(req, "RENAME_FILE", modifiedBy, id, null, {
        oldName: oldFile.originalName,
        newName,
      });
    }

    res.json({ success: true, message: "تم تغيير الاسم بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 5. الحذف الآمن (Soft Delete - نقل لسلة المحذوفات)
// ==================================================
const softDeleteItems = async (req, res) => {
  try {
    const { fileIds, folderIds, transactionId, deletedBy } = req.body;
    const now = new Date();

    if (fileIds && fileIds.length > 0) {
      await prisma.transactionFile.updateMany({
        where: { id: { in: fileIds } },
        data: {
          isDeleted: true,
          deletedBy: deletedBy || "النظام",
          deletedAt: now,
        },
      });
      for (const id of fileIds)
        await logActivity(req, "SOFT_DELETE_FILE", deletedBy, id, null, {});
    }

    if (folderIds && folderIds.length > 0) {
      await prisma.transactionFolder.updateMany({
        where: { id: { in: folderIds } },
        data: {
          isDeleted: true,
          deletedBy: deletedBy || "النظام",
          deletedAt: now,
        },
      });
      for (const id of folderIds)
        await logActivity(req, "SOFT_DELETE_FOLDER", deletedBy, null, id, {});
    }

    if (transactionId) {
      await prisma.privateTransaction.update({
        where: { id: transactionId },
        data: { modifiedBy: deletedBy || "النظام" },
      });
    }

    res.json({ success: true, message: "تم النقل لسلة المحذوفات" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 6. استعادة من سلة المحذوفات (Restore)
// ==================================================
const restoreItems = async (req, res) => {
  try {
    const { fileIds, folderIds, restoredBy } = req.body;

    if (fileIds && fileIds.length > 0) {
      await prisma.transactionFile.updateMany({
        where: { id: { in: fileIds } },
        data: { isDeleted: false, deletedBy: null, deletedAt: null },
      });
      for (const id of fileIds)
        await logActivity(req, "RESTORE_FILE", restoredBy, id, null, {});
    }

    if (folderIds && folderIds.length > 0) {
      await prisma.transactionFolder.updateMany({
        where: { id: { in: folderIds } },
        data: { isDeleted: false, deletedBy: null, deletedAt: null },
      });
      for (const id of folderIds)
        await logActivity(req, "RESTORE_FOLDER", restoredBy, null, id, {});
    }

    res.json({ success: true, message: "تمت الاستعادة بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 7. الحذف النهائي (Permanent Delete)
// ==================================================
const permanentDeleteItems = async (req, res) => {
  try {
    const { fileIds, folderIds, deletedBy } = req.body;

    // حذف الملفات من الهارد ديسك أولاً
    if (fileIds && fileIds.length > 0) {
      const filesToDelete = await prisma.transactionFile.findMany({
        where: { id: { in: fileIds } },
      });
      for (const file of filesToDelete) {
        const filePath = path.join(__dirname, "../../", file.url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        await logActivity(
          req,
          "PERMANENT_DELETE_FILE",
          deletedBy,
          file.id,
          null,
          { fileName: file.originalName },
        );
      }
      await prisma.transactionFile.deleteMany({
        where: { id: { in: fileIds } },
      });
    }

    if (folderIds && folderIds.length > 0) {
      for (const id of folderIds)
        await logActivity(
          req,
          "PERMANENT_DELETE_FOLDER",
          deletedBy,
          null,
          id,
          {},
        );
      await prisma.transactionFolder.deleteMany({
        where: { id: { in: folderIds } },
      });
    }

    res.json({ success: true, message: "تم الحذف النهائي بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 8. جلب وحفظ التصنيفات
// ==================================================
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

const saveCategories = async (req, res) => {
  try {
    const { categories } = req.body;
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
    res.json({ success: true, message: "تم حفظ الإعدادات" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 9. جلب سجل حركات الملف (Audit Logs)
// ==================================================
const getFileLogs = async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!fileId) {
      return res
        .status(400)
        .json({ success: false, message: "معرف الملف مطلوب" });
    }

    const logs = await prisma.fileActivityLog.findMany({
      where: { fileId },
      orderBy: { createdAt: "desc" }, // الأحدث أولاً
    });

    res.json({ success: true, logs });
  } catch (error) {
    console.error("Error in getFileLogs:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 10. جلب الإصدارات السابقة للملف (Versions)
// ==================================================
const getFileVersions = async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!fileId) {
      return res
        .status(400)
        .json({ success: false, message: "معرف الملف مطلوب" });
    }

    const versions = await prisma.fileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: "desc" }, // من الإصدار الأحدث للأقدم
    });

    res.json({ success: true, versions });
  } catch (error) {
    console.error("Error in getFileVersions:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 11. رفع إصدار جديد للملف (Update Version)
// ==================================================
const uploadNewVersion = async (req, res) => {
  // نستخدم نفس إعداد الـ upload المعرف سابقاً في الملف
  upload(req, res, async (err) => {
    if (err)
      return res.status(500).json({ success: false, message: "فشل الرفع" });

    try {
      const { transactionId, folderId, uploadedBy, replaceFileId } = req.body;

      if (!replaceFileId || !req.files || req.files.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "بيانات الملف مفقودة" });
      }

      const file = req.files[0]; // نأخذ الملف الأول فقط
      const filePath = path.join(
        __dirname,
        "../../uploads/transactions",
        file.filename,
      );
      const fileBuffer = fs.readFileSync(filePath);
      const fileHash = crypto
        .createHash("md5")
        .update(fileBuffer)
        .digest("hex");

      // 1. جلب الملف القديم
      const existingFile = await prisma.transactionFile.findUnique({
        where: { id: replaceFileId },
      });

      if (!existingFile) {
        return res
          .status(404)
          .json({ success: false, message: "الملف المراد تحديثه غير موجود" });
      }

      // 2. نقل البيانات القديمة إلى جدول الإصدارات (FileVersion)
      await prisma.fileVersion.create({
        data: {
          fileId: existingFile.id,
          versionNumber: existingFile.version,
          url: existingFile.url,
          size: existingFile.size,
          uploadedBy: existingFile.uploadedBy,
          changeNotes: "تم رفع إصدار أحدث يدوياً",
        },
      });

      // 3. تحديث سجل الملف الأساسي بالبيانات الجديدة
      const updatedFile = await prisma.transactionFile.update({
        where: { id: existingFile.id },
        data: {
          name: file.filename,
          originalName: file.originalname, // في حال تغير اسم الملف
          mimeType: file.mimetype,
          extension: path
            .extname(file.originalname)
            .replace(".", "")
            .toLowerCase(),
          url: `/uploads/transactions/${file.filename}`,
          size: file.size,
          fileHash: fileHash,
          version: existingFile.version + 1, // 💡 زيادة رقم الإصدار
          uploadedBy: uploadedBy || "النظام",
          updatedBy: uploadedBy || "النظام",
        },
      });

      // 4. تسجيل العملية في الـ Audit Log
      await logActivity(
        req,
        "UPDATE_VERSION",
        uploadedBy,
        updatedFile.id,
        folderId || null,
        {
          newVersion: updatedFile.version,
          fileName: file.originalname,
        },
      );

      // 5. تحديث المعاملة
      if (transactionId) {
        await prisma.privateTransaction.update({
          where: { id: transactionId },
          data: { modifiedBy: uploadedBy || "النظام" },
        });
      }

      res.json({
        success: true,
        file: updatedFile,
        message: "تم تحديث الإصدار بنجاح",
      });
    } catch (error) {
      console.error("Error in uploadNewVersion:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });
};

// ==================================================
// 12. جلب عناصر سلة المحذوفات
// ==================================================
const getTrashItems = async (req, res) => {
  try {
    // جلب المجلدات المحذوفة مع اسم المعاملة المرتبطة بها
    const folders = await prisma.transactionFolder.findMany({
      where: { isDeleted: true },
      include: { transaction: { select: { transactionCode: true } } },
      orderBy: { deletedAt: 'desc' }
    });

    // جلب الملفات المحذوفة مع اسم المعاملة المرتبطة بها
    const files = await prisma.transactionFile.findMany({
      where: { isDeleted: true },
      include: { transaction: { select: { transactionCode: true } } },
      orderBy: { deletedAt: 'desc' }
    });

    res.json({ success: true, folders, files });
  } catch (error) {
    console.error("Error in getTrashItems:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};


module.exports = {
  getFolderContents,
  createFolder,
  uploadFiles,
  renameItem,
  softDeleteItems,
  restoreItems,
  permanentDeleteItems,
  getCategories,
  saveCategories,
  getFileLogs,
  getFileVersions,
  uploadNewVersion,
  getTrashItems
};

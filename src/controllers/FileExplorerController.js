// controllers/FileExplorerController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// إعداد Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, "../../uploads/systemfiles");
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage }).array("files");

// ==========================================================
// 💡 1. دالة تسجيل آمنة تتفادى مشاكل العلاقات
// ==========================================================
const logActivity = async (
  action,
  performedBy,
  ipAddress,
  systemFileId = null,
  systemFolderId = null,
  details = null,
) => {
  try {
    await prisma.fileActivityLog.create({
      data: {
        action,
        performedBy: performedBy || "النظام",
        ipAddress,
        fileId: null, // نتجنب ربطه بـ TransactionFile
        folderId: null,
        details: {
          systemFileId,
          systemFolderId,
          ...(details || {}),
        },
      },
    });
  } catch (error) {
    console.error("⚠️ Error logging activity (Ignored):", error.message);
  }
};

// ==========================================================
// 💡 2. دالة لضمان وجود المجلدات الأساسية
// ==========================================================
const ensureRootFolderExists = async (folderId) => {
  if (!folderId || !folderId.startsWith("sys-")) return;

  const exists = await prisma.systemFolder.findUnique({
    where: { id: folderId },
  });
  if (!exists) {
    const rootNames = {
      "sys-transactions": "ملفات المعاملات",
      "sys-forms": "مخرجات النماذج الداخلية",
      "sys-hr": "شؤون الموظفين (HR)",
      "sys-finance": "الإدارة المالية",
      "sys-legal": "الشؤون القانونية",
      "sys-archive": "الأرشيف العام",
    };
    await prisma.systemFolder.create({
      data: {
        id: folderId,
        name: rootNames[folderId] || folderId,
        isDeleted: false,
      },
    });
  }
};

// ==========================================================
// 3. جلب المحتويات
// ==========================================================
exports.getContents = async (req, res) => {
  try {
    const { folderId } = req.query;
    const validFolderId =
      !folderId || folderId === "" || folderId === "root" || folderId === "null"
        ? null
        : folderId;

    const folders = await prisma.systemFolder.findMany({
      where: { parentId: validFolderId, isDeleted: false },
      orderBy: { createdAt: "desc" },
    });

    const files = await prisma.systemFile.findMany({
      where: { folderId: validFolderId, isDeleted: false },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ success: true, data: { folders, files } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "فشل في جلب المحتويات",
      error: error.message,
    });
  }
};

// ==========================================================
// 4. إنشاء مجلد جديد
// ==========================================================
exports.createFolder = async (req, res) => {
  try {
    const { name, parentId, createdBy } = req.body;
    const validFolderId =
      !parentId || parentId === "" || parentId === "root" || parentId === "null"
        ? null
        : parentId;

    if (validFolderId) await ensureRootFolderExists(validFolderId);

    const newFolder = await prisma.systemFolder.create({
      data: { name, parentId: validFolderId, createdBy },
    });

    await logActivity("CREATE_FOLDER", createdBy, req.ip, null, newFolder.id, {
      name,
    });

    res.status(201).json({ success: true, folder: newFolder });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "فشل في إنشاء المجلد",
      error: error.message,
    });
  }
};

// ==========================================================
// 💡 5. رفع الملفات (بنية احترافية تفحص المحذوفات والإصدارات)
// ==========================================================
exports.uploadFiles = async (req, res) => {
  upload(req, res, async (err) => {
    if (err)
      return res
        .status(500)
        .json({ success: false, message: "فشل في معالجة الملف المرفوع" });

    try {
      const { folderId, uploadedBy } = req.body;
      const validFolderId =
        !folderId ||
        folderId === "" ||
        folderId === "root" ||
        folderId === "null"
          ? null
          : folderId;
      const files = req.files;

      if (!files || files.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "لم يتم رفع أي ملف" });
      }

      if (validFolderId) await ensureRootFolderExists(validFolderId);

      const uploadedRecords = [];
      const warnings = []; // 💡 مصفوفة ذكية لجمع رسائل التنبيهات للواجهة الأمامية

      for (const file of files) {
        // 1. فك التشفير الآمن للغة العربية
        let originalName = file.originalname;
        try {
          originalName = decodeURIComponent(file.originalname);
        } catch (e) {
          originalName = Buffer.from(file.originalname, "latin1").toString(
            "utf8",
          );
        }

        const fileBuffer = fs.readFileSync(file.path);
        const fileHash = crypto
          .createHash("md5")
          .update(fileBuffer)
          .digest("hex");

        // 2. الفحص الذكي: هل الملف موجود في سلة المحذوفات؟
        const trashedFile = await prisma.systemFile.findFirst({
          where: {
            originalName: originalName,
            folderId: validFolderId,
            isDeleted: true,
          },
        });

        if (trashedFile) {
          warnings.push(
            `الملف "${originalName}" موجود مسبقاً في سلة المحذوفات. تم رفعه كملف نشط جديد مع بقاء القديم في السلة.`,
          );
        }

        // 3. الفحص الذكي: هل الملف موجود ونشط؟ (نظام الإصدارات)
        const existingFile = await prisma.systemFile.findFirst({
          where: {
            originalName: originalName,
            folderId: validFolderId,
            isDeleted: false,
          },
        });

        if (existingFile) {
          // أرشفة الإصدار القديم
          await logActivity(
            "VERSION_ARCHIVED",
            uploadedBy,
            req.ip,
            existingFile.id,
            null,
            {
              oldUrl: existingFile.url,
              oldSize: existingFile.size,
              oldVersion: existingFile.version,
              changeNotes: "تم رفع إصدار أحدث تلقائياً",
            },
          );

          const updatedFile = await prisma.systemFile.update({
            where: { id: existingFile.id },
            data: {
              name: file.filename,
              url: `/uploads/systemfiles/${file.filename}`,
              size: file.size,
              fileHash: fileHash,
              version: (existingFile.version || 1) + 1,
              uploadedBy: uploadedBy || "النظام",
            },
          });

          uploadedRecords.push(updatedFile);
          await logActivity(
            "UPLOAD_NEW_VERSION",
            uploadedBy,
            req.ip,
            updatedFile.id,
            validFolderId,
            { version: updatedFile.version, fileName: originalName },
          );
        } else {
          // ملف جديد تماماً
          const newFile = await prisma.systemFile.create({
            data: {
              name: file.filename,
              originalName: originalName,
              extension: path
                .extname(originalName)
                .replace(".", "")
                .toLowerCase(),
              size: file.size,
              url: `/uploads/systemfiles/${file.filename}`,
              folderId: validFolderId,
              uploadedBy: uploadedBy || "النظام",
              fileHash: fileHash,
              version: 1,
            },
          });

          uploadedRecords.push(newFile);
          await logActivity(
            "UPLOAD_FILE",
            uploadedBy,
            req.ip,
            newFile.id,
            validFolderId,
            { fileName: originalName },
          );
        }
      }

      // 💡 إرسال الملفات المرفوعة + التنبيهات (إن وجدت)
      res.status(200).json({ success: true, files: uploadedRecords, warnings });
    } catch (error) {
      console.error("🔥 Upload Files Error:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "فشل في رفع الملفات",
          error: error.message,
        });
    }
  });
};

// ==========================================================
// 💡 6. التحديث اليدوي للإصدار (المصححة للعمل مع Multer)
// ==========================================================
exports.uploadVersion = async (req, res) => {
  upload(req, res, async (err) => {
    if (err)
      return res
        .status(500)
        .json({ success: false, message: "فشل في معالجة الملف المرفوع" });

    try {
      const { replaceFileId, uploadedBy } = req.body;
      const file = req.files ? req.files[0] : null;

      if (!file || !replaceFileId) {
        return res
          .status(400)
          .json({ success: false, message: "بيانات التحديث غير مكتملة" });
      }

      const existingFile = await prisma.systemFile.findUnique({
        where: { id: replaceFileId },
      });
      if (!existingFile)
        return res
          .status(404)
          .json({ success: false, message: "الملف القديم غير موجود" });

      await logActivity(
        "VERSION_ARCHIVED",
        uploadedBy,
        req.ip,
        existingFile.id,
        null,
        {
          oldUrl: existingFile.url,
          oldSize: existingFile.size,
          oldVersion: existingFile.version,
        },
      );

      const originalName = decodeURIComponent(file.originalname);
      const fileBuffer = fs.readFileSync(file.path);
      const fileHash = crypto
        .createHash("md5")
        .update(fileBuffer)
        .digest("hex");

      const updatedFile = await prisma.systemFile.update({
        where: { id: replaceFileId },
        data: {
          name: file.filename,
          originalName: originalName,
          extension: path.extname(originalName).replace(".", "").toLowerCase(),
          size: file.size,
          url: `/uploads/systemfiles/${file.filename}`,
          fileHash: fileHash,
          version: (existingFile.version || 1) + 1,
          uploadedBy: uploadedBy || "النظام",
        },
      });

      await logActivity(
        "UPDATE_VERSION",
        uploadedBy,
        req.ip,
        updatedFile.id,
        null,
        { newVersion: updatedFile.version },
      );

      res.status(200).json({ success: true, file: updatedFile });
    } catch (error) {
      console.error("🔥 Upload Version Error:", error);
      res.status(500).json({
        success: false,
        message: "فشل في تحديث الإصدار",
        error: error.message,
      });
    }
  });
};

// ==========================================================
// 7. تغيير الاسم
// ==========================================================
exports.renameItem = async (req, res) => {
  try {
    const { id, type, newName, modifiedBy } = req.body;

    if (type === "folder") {
      const folder = await prisma.systemFolder.update({
        where: { id },
        data: { name: newName },
      });
      await logActivity("RENAME_FOLDER", modifiedBy, req.ip, null, id, {
        newName,
      });
      return res.status(200).json({ success: true, folder });
    } else {
      const file = await prisma.systemFile.update({
        where: { id },
        data: { originalName: newName }, // 💡 تحديث originalName فقط للمحافظة على الرابط واسم الملف الحقيقي سليمين
      });
      await logActivity("RENAME_FILE", modifiedBy, req.ip, id, null, {
        newName,
      });
      return res.status(200).json({ success: true, file });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "فشل في تغيير الاسم",
      error: error.message,
    });
  }
};

// ==========================================================
// 8. الحذف المنطقي (سلة المحذوفات)
// ==========================================================
exports.softDeleteItems = async (req, res) => {
  try {
    const { folderIds = [], fileIds = [], deletedBy } = req.body;

    if (folderIds.length > 0) {
      await prisma.systemFolder.updateMany({
        where: { id: { in: folderIds } },
        data: { isDeleted: true },
      });
      folderIds.forEach((id) =>
        logActivity("SOFT_DELETE_FOLDER", deletedBy, req.ip, null, id),
      );
    }

    if (fileIds.length > 0) {
      await prisma.systemFile.updateMany({
        where: { id: { in: fileIds } },
        data: { isDeleted: true, deletedBy: deletedBy, deletedAt: new Date() },
      });
      fileIds.forEach((id) =>
        logActivity("SOFT_DELETE_FILE", deletedBy, req.ip, id, null),
      );
    }

    res.status(200).json({ success: true, message: "تم النقل لسلة المحذوفات" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "فشل في الحذف", error: error.message });
  }
};

// ==========================================================
// 9. جلب سلة المحذوفات
// ==========================================================
exports.getTrash = async (req, res) => {
  try {
    const folders = await prisma.systemFolder.findMany({
      where: { isDeleted: true },
    });
    const files = await prisma.systemFile.findMany({
      where: { isDeleted: true },
    });
    res.status(200).json({ success: true, data: { folders, files } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "فشل في جلب المحذوفات",
      error: error.message,
    });
  }
};

// ==========================================================
// 10. الاستعادة من المحذوفات
// ==========================================================
exports.restoreItems = async (req, res) => {
  try {
    const { folderIds = [], fileIds = [], restoredBy } = req.body;

    if (folderIds.length > 0) {
      await prisma.systemFolder.updateMany({
        where: { id: { in: folderIds } },
        data: { isDeleted: false },
      });
      folderIds.forEach((id) =>
        logActivity("RESTORE_FOLDER", restoredBy, req.ip, null, id),
      );
    }

    if (fileIds.length > 0) {
      await prisma.systemFile.updateMany({
        where: { id: { in: fileIds } },
        data: { isDeleted: false, deletedBy: null, deletedAt: null },
      });
      fileIds.forEach((id) =>
        logActivity("RESTORE_FILE", restoredBy, req.ip, id, null),
      );
    }

    res.status(200).json({ success: true, message: "تم الاستعادة بنجاح" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "فشل في الاستعادة",
      error: error.message,
    });
  }
};

// ==========================================================
// 11. الحذف النهائي
// ==========================================================
exports.permanentDeleteItems = async (req, res) => {
  try {
    const { folderIds = [], fileIds = [], deletedBy } = req.body;

    if (folderIds.length > 0) {
      await prisma.systemFolder.deleteMany({
        where: { id: { in: folderIds } },
      });
      folderIds.forEach((id) =>
        logActivity("PERMANENT_DELETE", deletedBy, req.ip, null, id),
      );
    }

    if (fileIds.length > 0) {
      await prisma.systemFile.deleteMany({ where: { id: { in: fileIds } } });
      fileIds.forEach((id) =>
        logActivity("PERMANENT_DELETE", deletedBy, req.ip, id, null),
      );
    }

    res.status(200).json({ success: true, message: "تم الحذف النهائي" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "فشل في الحذف النهائي",
      error: error.message,
    });
  }
};

// ==========================================================
// 12. جلب سجل الحركات لملف
// ==========================================================
exports.getFileLogs = async (req, res) => {
  try {
    const { fileId } = req.params;
    const logs = await prisma.fileActivityLog.findMany({
      where: { details: { path: ["systemFileId"], equals: fileId } },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ success: true, logs });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "فشل في جلب السجل",
      error: error.message,
    });
  }
};

// ==========================================================
// 13. جلب الإصدارات (Versions) لملف
// ==========================================================
exports.getFileVersions = async (req, res) => {
  try {
    const { fileId } = req.params;
    const logs = await prisma.fileActivityLog.findMany({
      where: {
        action: "VERSION_ARCHIVED",
        details: { path: ["systemFileId"], equals: fileId },
      },
      orderBy: { createdAt: "desc" },
    });

    const versions = logs.map((log) => ({
      id: log.id,
      versionNumber: log.details.oldVersion || 1,
      url: log.details.oldUrl,
      size: log.details.oldSize,
      uploadedBy: log.performedBy,
      createdAt: log.createdAt,
    }));

    res.status(200).json({ success: true, versions });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "فشل في جلب الإصدارات",
      error: error.message,
    });
  }
};

// [NEW FILE: controllers/permissionGroupController.js]

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ===============================================
// 1. إنشاء مجموعة صلاحيات جديدة
// POST /api/permission-groups
// ===============================================
const createPermissionGroup = async (req, res) => {
  try {
    const { code, name, description, permissionIds } = req.body;

    if (!code || !name) {
      return res.status(400).json({ message: 'الكود والاسم مطلوبان' });
    }

    const newGroup = await prisma.permissionGroup.create({
      data: {
        code,
        name,
        description,
        // ربط الصلاحيات المحددة مباشرة عند الإنشاء
        permissions: {
          connect: permissionIds ? permissionIds.map(id => ({ id })) : []
        }
      },
      include: { permissions: true }
    });
    res.status(201).json(newGroup);

  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'رمز (Code) المجموعة مستخدم بالفعل' });
    }
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 2. جلب جميع مجموعات الصلاحيات (لشاشة 903)
// GET /api/permission-groups
// ===============================================
const getAllPermissionGroups = async (req, res) => {
  try {
    const groups = await prisma.permissionGroup.findMany({
      include: {
        // لجلب عدد الصلاحيات في كل مجموعة
        _count: {
          select: { permissions: true },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    // تنسيق البيانات لتطابق الواجهة الأمامية (التي تتوقع permissionsCount)
    const formattedGroups = groups.map(group => ({
      ...group,
      permissionsCount: group._count.permissions
    }));
    
    res.status(200).json(formattedGroups);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// (يمكنك إضافة دوال GetById, Update, Delete لاحقاً)

module.exports = {
  createPermissionGroup,
  getAllPermissionGroups
};
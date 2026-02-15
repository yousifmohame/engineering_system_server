// [File: controllers/permissionController.js]
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ===============================================
// 1. إنشاء صلاحية جديدة (لشاشة 902)
// POST /api/permissions
// ===============================================
const createPermission = async (req, res) => {
  try {
    // البيانات من واجهة 902
    const { code, name, description, level, screenId, screenName, actionType } = req.body;
    
    if (!code || !name || !level) {
        return res.status(400).json({ message: 'Code, Name, Level مطلوب' });
    }

    const newPermission = await prisma.permission.create({
        data: {
            code,
            name,
            description,
            level,
            screenId,
            screenName,
            actionType,
            modifiedBy: req.user.name,
        }
    });
    res.status(201).json(newPermission);

  } catch (error) {
    if (error.code === 'P2002') {
        return res.status(400).json({ message: 'رمز (Code) الصلاحية مستخدم بالفعل' });
      }
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 2. ✅ جلب جميع الصلاحيات الفردية (لشاشة 903)
// GET /api/permissions/individual  (وأيضاً GET /)
// ===============================================
const getIndividualPermissions = async (req, res) => {
    try {
        const permissions = await prisma.permission.findMany({
            include: {
                _count: {
                    select: { roles: true, employees: true }
                }
            },
            orderBy: {
                code: 'asc'
            }
        });
        res.status(200).json(permissions);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
};

// ===============================================
// 3. ✅ جلب مجموعات الصلاحيات (مؤقت)
// GET /api/permissions/groups
// ===============================================
const getPermissionGroups = async (req, res) => {
    try {
        // ملاحظة: لا يوجد نموذج "PermissionGroup" في الـ schema.prisma
        // سنرجع مصفوفة فارغة لإيقاف الخطأ 404 في الواجهة الأمامية
        res.status(200).json([]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
};


// ===============================================
// 4. إسناد صلاحية إلى دور (شاشة 902 - تاب 08)
// POST /api/permissions/assign-to-role
// ===============================================
const assignPermissionToRole = async (req, res) => {
  try {
    const { permissionId, roleId } = req.body;

    if (!permissionId || !roleId) {
      return res.status(400).json({ message: 'permissionId و roleId مطلوبان' });
    }

    // ربط الصلاحية بالدور
    await prisma.permission.update({
      where: { id: permissionId },
      data: {
        roles: {
          connect: { id: roleId },
        },
      },
    });
    res.status(200).json({ message: 'تم إسناد الصلاحية للدور بنجاح' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 5. إسناد صلاحية خاصة لموظف (شاشة 902 - تاب 09)
// POST /api/permissions/assign-to-employee
// ===============================================
const assignPermissionToEmployee = async (req, res) => {
    try {
      const { permissionId, employeeId } = req.body;
  
      if (!permissionId || !employeeId) {
        return res.status(400).json({ message: 'permissionId و employeeId مطلوبان' });
      }
  
      // ربط الصلاحية بالموظف مباشرة
      await prisma.permission.update({
        where: { id: permissionId },
        data: {
          employees: {
            connect: { id: employeeId },
          },
        },
      });
      res.status(200).json({ message: 'تم إسناد الصلاحية الخاصة للموظف بنجاح' });
  
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'خطأ في الخادم' });
    }
  };
  

module.exports = {
  createPermission,
  getIndividualPermissions, // ✅ تم تغيير الاسم
  getPermissionGroups,      // ✅ إضافة جديدة
  assignPermissionToRole,
  assignPermissionToEmployee
};
// [File: controllers/roleController.js]
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { sendEmail } = require("../services/emailService");

// ===============================================
// 1. إنشاء دور جديد (لشاشة 903)
// POST /api/roles
// ===============================================
const createRole = async (req, res) => {
  try {
    const {
      nameAr,
      nameEn,
      description,
      level,
      department,
      responsibilities,
      permissionsData,
    } = req.body;

    const code = req.body.code || `ROLE_${Date.now()}`;

    if (!nameAr) {
      return res.status(400).json({ message: "اسم الدور (عربي) مطلوب" });
    }

    let permissionOps = [];
    if (permissionsData && Array.isArray(permissionsData)) {
      permissionOps = permissionsData.map((p) => ({
        where: { code: p.code },
        create: {
          code: p.code,
          name: p.name,
          screenName: p.screenName,
          tabName: p.tabName,
          level: p.level || "action",
          status: "active",
        },
      }));
    }

    const newRole = await prisma.jobRole.create({
      data: {
        code,
        nameAr,
        nameEn,
        description,
        level: level ? level.toString() : "1",
        department,
        responsibilities: responsibilities || [],
        canAssignTasks: true,
        allowMultiple: true,
        allowMultiRole: true,
        modifiedBy: req.user ? req.user.name : "System",
        ...(permissionOps.length > 0 && {
          permissions: {
            connectOrCreate: permissionOps,
          },
        }),
      },
      include: { permissions: true },
    });

    res.status(201).json({ success: true, data: newRole });
  } catch (error) {
    if (error.code === "P2002") {
      return res
        .status(400)
        .json({ message: "رمز (Code) الدور مستخدم بالفعل" });
    }
    console.error("Create Role Error:", error);
    res.status(500).json({ message: "خطأ في الخادم أثناء إنشاء الدور" });
  }
};

// ===============================================
// 2. جلب جميع الأدوار
// GET /api/roles
// ===============================================
const getAllRoles = async (req, res) => {
  try {
    const roles = await prisma.jobRole.findMany({
      include: {
        permissions: true,
        _count: {
          select: { employees: true },
        },
      },
      orderBy: {
        createdDate: "asc",
      },
    });
    res.status(200).json(roles);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// ===============================================
// 3. إسناد موظف إلى دور
// POST /api/roles/assign-employee
// ===============================================
const assignEmployeeToRole = async (req, res) => {
  try {
    const { employeeId, roleId } = req.body;

    if (!employeeId || !roleId) {
      return res.status(400).json({ message: "employeeId و roleId مطلوبان" });
    }

    await prisma.jobRole.update({
      where: { id: roleId },
      data: {
        employees: {
          connect: { id: employeeId },
        },
      },
    });

    try {
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { email: true, name: true },
      });

      const role = await prisma.jobRole.findUnique({
        where: { id: roleId },
        select: { nameAr: true },
      });

      if (employee && role && employee.email) {
        const subject = `تهانينا! تم إسناد دور جديد لك`;
        const htmlBody = `
          <div>
            <h1>مرحباً ${employee.name},</h1>
            <p>لقد تم إسناد دور وظيفي جديد لك في النظام:</p>
            <h2 style="color: #007bff;">${role.nameAr}</h2>
            <p>يمكنك الآن تسجيل الدخول للاطلاع على صلاحياتك الجديدة.</p>
            <p>مع تحيات،<br>إدارة النظام</p>
          </div>
        `;
        sendEmail(employee.email, subject, htmlBody);
      }
    } catch (emailError) {
      console.error("Failed to send assignment email:", emailError);
    }

    res.status(200).json({ message: "تم إسناد الموظف للدور بنجاح" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// ===============================================
// 4. إزالة موظف من دور
// POST /api/roles/remove-employee
// ===============================================
const removeEmployeeFromRole = async (req, res) => {
  try {
    const { employeeId, roleId } = req.body;

    if (!employeeId || !roleId) {
      return res.status(400).json({ message: "employeeId و roleId مطلوبان" });
    }

    const updatedRole = await prisma.jobRole.update({
      where: { id: roleId },
      data: {
        employees: {
          disconnect: { id: employeeId },
        },
      },
    });
    res.status(200).json(updatedRole);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// ===============================================
// الدوال الإضافية (Placeholder)
// ===============================================
const getRoleChanges = async (req, res) => {
  try {
    res.status(200).json([]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

const getAssignmentLists = async (req, res) => {
  try {
    res.status(200).json([]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

const getRoleNotifications = async (req, res) => {
  try {
    res.status(200).json([]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// ===============================================
// 5. جلب دور واحد مع تفاصيله
// GET /api/roles/:id
// ===============================================
const getRoleById = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await prisma.jobRole.findUnique({
      where: { id: id },
      include: {
        permissions: true,
        employees: true,
        parentRole: true,
        childRoles: true,
      },
    });

    if (!role) {
      return res.status(404).json({ message: "لم يتم العثور على الدور" });
    }
    res.status(200).json(role);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// PUT /api/roles/:id/permissions
const updateRolePermissions = async (req, res) => {
  try {
    const roleId = req.params.id;
    const { permissionIds } = req.body; // مصفوفة الـ IDs القادمة من الواجهة

    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({ message: "يجب إرسال مصفوفة بصيغة permissionIds" });
    }

    // تحديث الدور: نقوم بمسح الصلاحيات القديمة (set) وربط الجديدة في عملية واحدة
    const updatedRole = await prisma.jobRole.update({
      where: { id: roleId },
      data: {
        permissions: {
          set: permissionIds.map(id => ({ id }))
        }
      },
      include: { permissions: true } // إرجاع الدور مع صلاحياته الجديدة
    });

    res.status(200).json({ message: "تم تحديث مصفوفة الصلاحيات بنجاح", role: updatedRole });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في خادم قاعدة البيانات" });
  }
};

// ===============================================
// 7. إضافة/إزالة صلاحية ديناميكية لدور وظيفي
// POST /api/roles/:id/assign-permission
// ===============================================
const assignPermissionToRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { permission } = req.body;

    if (!permission || !permission.code) {
      return res.status(400).json({ message: "بيانات الصلاحية غير مكتملة" });
    }

    const role = await prisma.jobRole.findUnique({
      where: { id },
      include: { permissions: true },
    });

    if (!role) return res.status(404).json({ message: "الدور غير موجود" });

    const hasPermission = role.permissions.some(
      (p) => p.code === permission.code,
    );
    let updatedRole;

    if (hasPermission) {
      updatedRole = await prisma.jobRole.update({
        where: { id },
        data: {
          permissions: { disconnect: { code: permission.code } },
        },
        include: { permissions: true },
      });
      res
        .status(200)
        .json({
          success: true,
          action: "removed",
          message: "تم سحب الصلاحية بنجاح",
          role: updatedRole,
        });
    } else {
      updatedRole = await prisma.jobRole.update({
        where: { id },
        data: {
          permissions: {
            connectOrCreate: {
              where: { code: permission.code },
              create: {
                code: permission.code,
                name: permission.name || permission.code,
                screenName: permission.screenName || "عام",
                tabName: permission.tabName || "عام",
                level: permission.level || "action",
                status: "active",
              },
            },
          },
        },
        include: { permissions: true },
      });
      res
        .status(200)
        .json({
          success: true,
          action: "added",
          message: "تم منح الصلاحية بنجاح",
          role: updatedRole,
        });
    }
  } catch (error) {
    console.error("Assign Permission Error:", error);
    res.status(500).json({ message: "خطأ في الخادم أثناء التعديل" });
  }
};

// ===============================================
// 8. ✅ [جديد] تحديث البيانات الأساسية للدور
// PUT /api/roles/:id
// ===============================================
const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existingRole = await prisma.jobRole.findUnique({ where: { id } });
    if (!existingRole) {
      return res
        .status(404)
        .json({ success: false, message: "الدور الوظيفي غير موجود" });
    }

    const updatedRole = await prisma.jobRole.update({
      where: { id },
      data: {
        nameAr: data.nameAr || existingRole.nameAr,
        nameEn: data.nameEn || existingRole.nameEn,
        description:
          data.description !== undefined
            ? data.description
            : existingRole.description,
        level: data.level ? data.level.toString() : existingRole.level,
        department:
          data.department !== undefined
            ? data.department
            : existingRole.department,
        responsibilities:
          data.responsibilities || existingRole.responsibilities,
        modifiedBy: req.user ? req.user.name : "System",
      },
    });

    res.status(200).json({ success: true, data: updatedRole });
  } catch (error) {
    console.error("Update Role Error:", error);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء التحديث" });
  }
};

// ===============================================
// 9. ✅ [جديد] حذف الدور الوظيفي
// DELETE /api/roles/:id
// ===============================================
const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    const existingRole = await prisma.jobRole.findUnique({ where: { id } });
    if (!existingRole) {
      return res
        .status(404)
        .json({ success: false, message: "الدور الوظيفي غير موجود" });
    }

    await prisma.jobRole.delete({
      where: { id },
    });

    res
      .status(200)
      .json({ success: true, message: "تم حذف الدور الوظيفي بنجاح" });
  } catch (error) {
    console.error("Delete Role Error:", error);

    // الحل السحري لمشكلة "مرتبط بموظفين محذوفين مؤقتاً"
    // P2003 هو كود الخطأ في بريسما عند محاولة حذف شيء له ارتباطات (Foreign Key Constraint)
    if (error.code === "P2003") {
      return res.status(400).json({
        success: false,
        message:
          "لا يمكن الحذف. هذا الدور مرتبط بموظفين (حتى وإن كانوا محذوفين أو موقوفين). يرجى إزالة الدور منهم أولاً.",
      });
    }

    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء محاولة الحذف" });
  }
};

module.exports = {
  createRole,
  getAllRoles,
  assignEmployeeToRole,
  removeEmployeeFromRole,
  getRoleChanges,
  getAssignmentLists,
  getRoleNotifications,
  getRoleById,
  updateRolePermissions,
  assignPermissionToRole,
  updateRole, // ✅ تم التصدير
  deleteRole, // ✅ تم التصدير
};

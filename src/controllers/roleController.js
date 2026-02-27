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

    // نستلم الـ code من الفرونت إند، وإذا لم يوجد، نقوم بتوليده تلقائياً (مثال: ROLE_1709845321654)
    const code = req.body.code || `ROLE_${Date.now()}`;

    if (!nameAr) {
      return res.status(400).json({ message: "اسم الدور (عربي) مطلوب" });
    }

    // تجهيز الصلاحيات الديناميكية (من الفرونت إند الجديد)
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
        code, // سيتم إدخال الكود سواء تم إرساله أو توليده
        nameAr,
        nameEn,
        description,
        // معالجة الـ level لأنه قد يكون undefined
        level: level ? level.toString() : "1",
        department,
        responsibilities: responsibilities || [],
        canAssignTasks: true, // افتراضي
        allowMultiple: true, // افتراضي
        allowMultiRole: true, // افتراضي
        modifiedBy: req.user ? req.user.name : "System", // حماية في حال عدم وجود user
        // 👈 ربط الصلاحيات الديناميكية
        ...(permissionOps.length > 0 && {
          permissions: {
            connectOrCreate: permissionOps,
          },
        }),
      },
      include: { permissions: true }, // نرجع الصلاحيات ليتعرف عليها الفرونت إند
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
        permissions: true, // 👈 هذا هو السطر السحري المفقود! يجلب تفاصيل الصلاحيات
        _count: {
          select: { employees: true }, // جلب عدد الموظفين فقط
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
// 3. إسناد موظف إلى دور (شاشة 903 - تاب 04)
// POST /api/roles/assign-employee
// ===============================================
const assignEmployeeToRole = async (req, res) => {
  try {
    const { employeeId, roleId } = req.body;

    if (!employeeId || !roleId) {
      return res.status(400).json({ message: "employeeId و roleId مطلوبان" });
    }

    // 1. ربط الموظف بالدور
    await prisma.jobRole.update({
      where: { id: roleId },
      data: {
        employees: {
          connect: { id: employeeId }, // "connect" تضيف الربط
        },
      },
    });

    // --- 2. إرسال إيميل إشعار (الخطوة الجديدة) ---
    try {
      // جلب بيانات الموظف والدور
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

        // إرسال الإيميل في الخلفية (لا ننتظر الرد)
        sendEmail(employee.email, subject, htmlBody);
      }
    } catch (emailError) {
      // نسجل الخطأ فقط ولا نوقف العملية الأساسية
      console.error("Failed to send assignment email:", emailError);
    }
    // ----------------------------------------

    res.status(200).json({ message: "تم إسناد الموظف للدور بنجاح" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// ===============================================
// 4. إزالة موظف من دور (شاشة 903)
// POST /api/roles/remove-employee
// ===============================================
const removeEmployeeFromRole = async (req, res) => {
  try {
    const { employeeId, roleId } = req.body;

    if (!employeeId || !roleId) {
      return res.status(400).json({ message: "employeeId و roleId مطلوبان" });
    }

    // هذه هي طريقة Prisma لفك ربط علاقة Many-to-Many
    const updatedRole = await prisma.jobRole.update({
      where: { id: roleId },
      data: {
        employees: {
          disconnect: { id: employeeId }, // "disconnect" تزيل الربط
        },
      },
    });
    res.status(200).json(updatedRole);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// --- ✅ 5. إضافة الدوال الجديدة (مؤقتاً) ---

// GET /api/roles/changes
const getRoleChanges = async (req, res) => {
  try {
    // (منطق جلب البيانات الحقيقي يوضع هنا لاحقاً)
    res.status(200).json([]); // إرجاع مصفوفة فارغة حالياً
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// GET /api/roles/assignment-lists
const getAssignmentLists = async (req, res) => {
  try {
    res.status(200).json([]); // إرجاع مصفوفة فارغة حالياً
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// GET /api/roles/notifications
const getRoleNotifications = async (req, res) => {
  try {
    res.status(200).json([]); // إرجاع مصفوفة فارغة حالياً
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};

// ===============================================
// 5. ✅ جلب دور واحد مع تفاصيله (للتبويبات 6-14)
// GET /api/roles/:id
// ===============================================
const getRoleById = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await prisma.jobRole.findUnique({
      where: { id: id },
      include: {
        permissions: true, // لجلب الصلاحيات المرتبطة (لتاب 903-06)
        employees: true, // لجلب الموظفين المرتبطين (لتاب 903-09)
        parentRole: true, // لتاب التسلسل الهرمي (903-08)
        childRoles: true, // لتاب التسلسل الهرمي (903-08)
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

// ===============================================
// 6. ✅ تحديث صلاحيات دور معين
// PUT /api/roles/:id/permissions
// ===============================================
const updateRolePermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const { permissionsData } = req.body;

    // إذا لم تكن المصفوفة موجودة، نفرغ الصلاحيات
    if (!permissionsData || !Array.isArray(permissionsData)) {
      await prisma.jobRole.update({
        where: { id },
        data: { permissions: { set: [] } },
      });
      return res
        .status(200)
        .json({ success: true, message: "تم تفريغ الصلاحيات" });
    }

    // 1. ضمان وجود كل الصلاحيات في قاعدة البيانات أولاً
    for (const p of permissionsData) {
      await prisma.permission.upsert({
        where: { code: p.code },
        update: {},
        create: {
          code: p.code,
          name: p.name,
          screenName: p.screenName,
          tabName: p.tabName,
          level: p.level || "action",
          status: "active",
        },
      });
    }

    // 2. تحديث الدور وربطه بالأكواد المحددة فقط وحذف القديم
    const updatedRole = await prisma.jobRole.update({
      where: { id: id },
      data: {
        permissions: {
          set: permissionsData.map((p) => ({ code: p.code })),
        },
      },
      include: { permissions: true },
    });

    res.status(200).json({ success: true, data: updatedRole.permissions });
  } catch (error) {
    console.error("Update Role Error:", error);
    res.status(500).json({ message: "خطأ في تحديث الصلاحيات" });
  }
};

// ===============================================
// إضافة/إزالة صلاحية ديناميكية لدور وظيفي (Visual Builder Toggle)
// POST /api/roles/:id/assign-permission
// ===============================================
const assignPermissionToRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { permission } = req.body;

    if (!permission || !permission.code) {
      return res.status(400).json({ message: "بيانات الصلاحية غير مكتملة" });
    }

    // جلب الدور مع صلاحياته الحالية
    const role = await prisma.jobRole.findUnique({
      where: { id },
      include: { permissions: true },
    });

    if (!role) return res.status(404).json({ message: "الدور غير موجود" });

    // التحقق هل الصلاحية موجودة بالفعل لدى هذا الدور؟
    const hasPermission = role.permissions.some(
      (p) => p.code === permission.code,
    );

    let updatedRole;

    if (hasPermission) {
      // 🔴 الصلاحية موجودة -> إذن نقوم بحذفها (Disconnect)
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
      // 🟢 الصلاحية غير موجودة -> نقوم بإنشائها وربطها (ConnectOrCreate)
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

module.exports = {
  createRole,
  getAllRoles,
  assignEmployeeToRole,
  removeEmployeeFromRole,
  getRoleChanges, // ✅ إضافة
  getAssignmentLists, // ✅ إضافة
  getRoleNotifications, // ✅ إضافة
  getRoleById, // ✅ إضافة
  updateRolePermissions,
  assignPermissionToRole,
};

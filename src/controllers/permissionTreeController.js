const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// =================================================================
// 1. جلب الهيكل الشجري بالكامل (Modules -> Sub-Modules -> Permissions)
// GET /api/permissions-tree
// =================================================================
const getPermissionTree = async (req, res) => {
  try {
    // 1. جلب جميع الجروبات والصلاحيات المرتبطة بها
    const allGroups = await prisma.permissionGroup.findMany({
      include: {
        permissions: {
          select: { id: true, name: true, code: true, type: true }
        }
      }
    });

    // 2. دالة برمجية لبناء الشجرة تراجعياً (Recursive)
    const buildTree = (parentId = null) => {
      return allGroups
        .filter(group => group.parentId === parentId)
        .map(group => {
          // جلب الأبناء (جروبات فرعية)
          const childrenGroups = buildTree(group.id);
          
          // تحويل الصلاحيات لتطابق شكل الـ Node في الـ Frontend
          const permissionsNodes = group.permissions.map(perm => ({
            id: perm.id,
            name: perm.name,
            code: perm.code,
            type: 'permission'
          }));

          return {
            id: group.id,
            name: group.name,
            type: group.type,
            // ندمج الجروبات الفرعية مع الصلاحيات الفردية بداخل هذا الجروب
            children: [...childrenGroups, ...permissionsNodes]
          };
        });
    };

    const tree = buildTree(null);
    res.status(200).json(tree);

  } catch (error) {
    console.error("خطأ في جلب شجرة الصلاحيات:", error);
    res.status(500).json({ message: 'خطأ في خادم قاعدة البيانات' });
  }
};

// =================================================================
// 2. حفظ ومزامنة الهيكل الشجري (حفظ التعديلات والجروبات الجديدة)
// POST /api/permissions-tree/sync
// =================================================================
const syncPermissionTree = async (req, res) => {
  const { tree } = req.body; // مصفوفة الشجرة القادمة من الـ Frontend

  if (!tree || !Array.isArray(tree)) {
    return res.status(400).json({ message: 'البيانات المرسلة غير صالحة' });
  }

  try {
    // نستخدم Transaction لضمان أنه إذا فشل جزء، يتراجع عن كل شيء
    await prisma.$transaction(async (tx) => {
      
      // مصفوفة لتتبع الـ IDs الصالحة التي تم إرسالها لتجنب حذفها
      const activeGroupIds = [];

      // دالة تراجعية لمعالجة وحفظ كل عقدة (Node)
      const processNode = async (node, parentId = null) => {
        // إذا كانت العقدة عبارة عن صلاحية (لا نحتاج لإنشائها هنا، بل نربطها فقط)
        if (node.type === 'permission') return;

        // إذا كانت العقدة جروب (Module أو Sub-Module)
        let groupId = node.id;
        
        // التحقق مما إذا كان الجروب جديداً (تم إنشاؤه في الـ Frontend بـ ID مؤقت مثل sub-123)
        const isNewGroup = groupId.startsWith('sub-') || groupId.startsWith('mod-');

        let savedGroup;
        if (isNewGroup) {
          // إنشاء جروب جديد
          savedGroup = await tx.permissionGroup.create({
            data: {
              name: node.name,
              type: node.type || 'sub_module',
              parentId: parentId
            }
          });
          groupId = savedGroup.id; // استبدال الـ ID المؤقت بالـ ID الحقيقي من قاعدة البيانات
        } else {
          // تحديث جروب موجود (تغيير اسمه أو تغيير الأب الخاص به - النقل)
          savedGroup = await tx.permissionGroup.update({
            where: { id: groupId },
            data: {
              name: node.name,
              parentId: parentId,
              // تصفير الصلاحيات المرتبطة به تمهيداً لربطها من جديد بناءً على الشجرة
              permissions: { set: [] } 
            }
          });
        }

        activeGroupIds.push(groupId);

        // فرز الأبناء لمعرفة الصلاحيات المباشرة داخل هذا الجروب
        const childPermissions = (node.children || []).filter(c => c.type === 'permission');
        const childGroups = (node.children || []).filter(c => c.type !== 'permission');

        // ربط الصلاحيات بهذا الجروب
        if (childPermissions.length > 0) {
          await tx.permissionGroup.update({
            where: { id: groupId },
            data: {
              permissions: {
                connect: childPermissions.map(p => ({ id: p.id }))
              }
            }
          });
        }

        // معالجة الجروبات الفرعية بشكل تراجعي (Recursion)
        for (const childGroup of childGroups) {
          await processNode(childGroup, groupId);
        }
      };

      // 1. بدء المعالجة من الجذور (Root Nodes)
      for (const rootNode of tree) {
        await processNode(rootNode, null);
      }

      // 2. تنظيف البيانات: حذف الجروبات التي تم مسحها من الواجهة ولم تعد موجودة في الشجرة
      await tx.permissionGroup.deleteMany({
        where: {
          id: { notIn: activeGroupIds }
        }
      });

    });

    res.status(200).json({ message: 'تم بناء وحفظ الهيكل الشجري بنجاح' });

  } catch (error) {
    console.error("خطأ في حفظ الشجرة:", error);
    res.status(500).json({ message: 'خطأ أثناء مزامنة الهيكل الشجري' });
  }
};

module.exports = {
  getPermissionTree,
  syncPermissionTree
};
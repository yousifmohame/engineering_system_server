const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// =================================================================
// 1. جلب الهيكل الهرمي للصلاحيات (شجرة الشاشات والعمليات)
// GET /api/permissions/tree
// =================================================================
const getPermissionTree = async (req, res) => {
  try {
    // 1. جلب كل الصلاحيات من جدول Permission فقط
    const allPermissions = await prisma.permission.findMany({
      orderBy: { name: 'asc' } // ترتيب أبجدي لتسهيل القراءة
    });

    // 2. دالة البناء التراجعي (لربط الأبناء بالآباء)
    const buildTree = (parentId = null) => {
      return allPermissions
        // إذا كان parentId الخاص بالصلاحية يطابق الـ parentId المطلوب
        .filter(p => p.parentId === parentId) 
        .map(p => ({
          id: p.id,
          name: p.name,
          code: p.code,
          parentId: p.parentId,
          type: 'permission', // لتتوافق مع الواجهة الأمامية
          children: buildTree(p.id) // استدعاء ذاتي لجلب أبناء هذه الصلاحية
        }));
    };

    // 3. بناء الشجرة ابتداءً من العناصر الجذرية (التي parentId لها = null)
    const tree = buildTree(null);

    res.status(200).json(tree);
  } catch (error) {
    console.error("Tree Fetch Error:", error);
    res.status(500).json({ message: 'خطأ في جلب الهيكل الهرمي للصلاحيات' });
  }
};

// =================================================================
// 2. حفظ الهيكل ومزامنة السحب والإفلات (إضافة، تعديل، ونقل)
// POST /api/permissions/tree/sync
// =================================================================
const syncPermissionTree = async (req, res) => {
  const { tree } = req.body;

  if (!tree || !Array.isArray(tree)) {
    return res.status(400).json({ message: 'البيانات المرسلة غير صالحة' });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const activePermissionIds = [];

      // دالة لمعالجة وحفظ كل عقدة (صلاحية/شاشة)
      const processNode = async (node, parentId = null) => {
        let permId = node.id;
        
        // التحقق هل هذا العنصر تم إنشاؤه للتو من الواجهة الأمامية؟
        const isNewNode = String(permId).startsWith('sub-') || String(permId).startsWith('mod-');

        if (isNewNode) {
          // إذا كانت شاشة/صلاحية جديدة، نولد لها كود فريد ونحفظها في جدول Permission
          const uniqueCode = `PERM_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          
          const newPerm = await tx.permission.create({
            data: {
              name: node.name,
              code: uniqueCode,
              level: 'screen', // مستوى افتراضي
              parentId: parentId, 
              status: 'active'
            }
          });
          permId = newPerm.id;
        } else {
          // إذا كانت موجودة، نقوم بتحديث اسمها ونقلها (تغيير الـ parentId الخاص بها)
          await tx.permission.update({
            where: { id: permId },
            data: {
              name: node.name,
              parentId: parentId
            }
          });
        }

        activePermissionIds.push(permId);

        // معالجة الأبناء بداخل هذه الصلاحية
        const children = node.children || [];
        for (const child of children) {
          await processNode(child, permId);
        }
      };

      // بدء المعالجة من الجذور
      for (const rootNode of tree) {
        await processNode(rootNode, null);
      }

      // مسح الصلاحيات التي تم حذفها من الشجرة نهائياً
      await tx.permission.deleteMany({
        where: {
          id: { notIn: activePermissionIds }
        }
      });

    });

    res.status(200).json({ message: 'تم حفظ الهيكل الهرمي للصلاحيات بنجاح' });

  } catch (error) {
    console.error("Tree Sync Error:", error);
    res.status(500).json({ message: 'خطأ أثناء مزامنة الهيكل الهرمي' });
  }
};

module.exports = {
  getPermissionTree,
  syncPermissionTree
};
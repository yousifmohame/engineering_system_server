const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function makeAdmin() {
  // ⚠️ ضع الإيميل الفعلي الخاص بك الذي سجلت به الدخول للنظام هنا
  const adminEmail = "admin@wms.com"; // <--- غير هذا الإيميل!!

  try {
    // 1. التحقق من وجود الموظف أولاً
    const existingEmployee = await prisma.employee.findUnique({
      where: { email: adminEmail }
    });

    if (!existingEmployee) {
      console.log("========================================");
      console.error(`❌ خطأ: لم يتم العثور على موظف يحمل الإيميل: ${adminEmail}`);
      console.log(`💡 الحل: يرجى تغيير قيمة adminEmail في السطر 5 من السكربت إلى الإيميل الذي قمت بتسجيله فعلياً في النظام.`);
      console.log("========================================");
      return;
    }

    // 2. إنشاء صلاحية المدير المطلق (إذا لم تكن موجودة)
    const superAdminPerm = await prisma.permission.upsert({
      where: { code: "SUPER_ADMIN" },
      update: {},
      create: {
        code: "SUPER_ADMIN",
        name: "صلاحيات المدير المطلق",
        screenName: "النظام كامل",
        tabName: "كل شيء",
        level: "action",
        status: "active"
      }
    });

    // 3. التحقق من وجود دور المدير المطلق أو إنشاؤه
    let adminRole = await prisma.jobRole.findFirst({
      where: { code: "ROLE_ADMIN" }
    });

    if (!adminRole) {
      adminRole = await prisma.jobRole.create({
        data: {
          code: "ROLE_ADMIN",
          nameAr: "مدير نظام عام",
          description: "تحكم كامل بجميع خصائص النظام",
          canAssignTasks: true, // افتراضي
          permissions: {
            connect: { id: superAdminPerm.id }
          }
        }
      });
    } else {
      // ربط الصلاحية بالدور في حال كان الدور موجود مسبقاً
      await prisma.jobRole.update({
        where: { id: adminRole.id },
        data: { permissions: { connect: { id: superAdminPerm.id } } }
      });
    }

    // 4. ربط الدور بالموظف بأمان
    const employee = await prisma.employee.update({
      where: { email: adminEmail },
      data: {
        roles: {
          connect: { id: adminRole.id }
        }
      }
    });

    console.log("========================================");
    console.log(`✅ تم تعيين الموظف [ ${employee.name} ] كمدير نظام مطلق بنجاح! 👑`);
    console.log("يمكنك الآن تسجيل الدخول للنظام ورؤية كل الصلاحيات.");
    console.log("========================================");

  } catch (error) {
    console.error("❌ حدث خطأ غير متوقع:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

makeAdmin();
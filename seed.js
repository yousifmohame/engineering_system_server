// server/seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs'); // تأكد أن هذه المكتبة مثبتة

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Start seeding...');

  // 1. تشفير كلمة المرور (نفس طريقة authController.js)
  const hashedPassword = await bcrypt.hash('123456', 10);

  // 2. إنشاء الموظف
  const admin = await prisma.employee.upsert({
    where: { email: 'admin@wms.com' },
    update: {}, // إذا كان موجوداً لا تفعل شيئاً
    create: {
      name: 'المدير العام',
      email: 'admin@wms.com',
      password: hashedPassword,
      nationalId: '1000000001', // حقل إجباري وفريد
      phone: '0500000000',      // حقل إجباري وفريد
      position: 'General Manager',
      department: 'Management',
      hireDate: new Date(),
      employeeCode: 'EMP-ADMIN-01',
      status: 'active',
      type: 'full-time'
    },
  });

  console.log(`✅ Created user: ${admin.email} / Password: 123456`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
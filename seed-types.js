// server/seed-types.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const types = [
    { code: "560-01", name: "رخص البناء", category: "هندسي" },
    { code: "560-02", name: "رخص الهدم", category: "هندسي" },
    { code: "560-03", name: "شهادات الإتمام", category: "هندسي" },
    { code: "560-04", name: "تجزئة الأراضي", category: "تخطيطي" },
  ];

  console.log("Start seeding types...");

  for (const type of types) {
    const exists = await prisma.transactionType.findUnique({
        where: { code: type.code }
    });

    if (!exists) {
        await prisma.transactionType.create({
            data: {
                code: type.code,
                name: type.name,
                category: type.category,
                isActive: true
            }
        });
        console.log(`Created: ${type.name}`);
    } else {
        console.log(`Skipped (Exists): ${type.name}`);
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
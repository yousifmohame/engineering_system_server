const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("🌱 بدء عملية حقن البيانات (Seeding)...");

  // ===================================================
  // 1. إضافة القطاع (Sector)
  // ===================================================
  const sector = await prisma.riyadhSector.upsert({
    where: { name: "قطاع شمال الرياض" }, // التحقق بالاسم لأنه فريد
    update: {}, // إذا كان موجوداً لا تفعل شيئاً
    create: {
      name: "قطاع شمال الرياض",
      code: "SEC-N-001",
      officialLink: "https://maps.google.com/?q=24.8105,46.5982",
      // إضافة ملاحظة افتراضية لتجربة التابات
      notes: [
        {
          id: "1",
          title: "ملاحظة النظام",
          content: "تم إنشاء القطاع عبر ملف Seeding",
          status: "نشطة",
          author: "مدير النظام",
          date: new Date().toLocaleDateString("ar-SA"),
        },
      ],
      // إضافة اشتراط افتراضي
      regulations: [
        {
          id: "1",
          type: "ارتفاعات",
          text: "الحد الأقصى للارتفاع 12م",
          appliesTo: "قطاع",
          status: "فعال",
          source: "تلقائي",
          reference: "N/A",
        },
      ],
    },
  });
  console.log(`✅ تم إنشاء/جلب القطاع: ${sector.name}`);

  // ===================================================
  // 2. إضافة الحي (District)
  // ===================================================
  const district = await prisma.riyadhDistrict.upsert({
    where: { name: "حي الملقا" },
    update: {},
    create: {
      name: "حي الملقا",
      code: "NBH-N-015",
      sectorId: sector.id, // ربطه بالقطاع الذي أنشأناه للتو
      officialLink: "https://maps.google.com/?q=24.8105,46.5982",
    },
  });
  console.log(`✅ تم إنشاء/جلب الحي: ${district.name}`);

  // ===================================================
  // 3. إضافة الشارع (Street)
  // ===================================================
  const streetCode = "STR-2026-0001";
  const street = await prisma.riyadhStreet.upsert({
    where: { streetCode: streetCode },
    update: {},
    create: {
      streetCode: streetCode,
      name: "طريق أنس بن مالك",
      sectorId: sector.id,     // ربطه بالقطاع
      districtId: district.id, // ربطه بالحي
      type: "main",            // طريق محوري
      width: 60.0,
      length: 5000.0,
      lanes: 4,
      status: "active",
      centerLat: 24.8105,
      centerLng: 46.5982,
      lighting: true,
      sidewalks: true,
      hasSpecialRegulation: true,
      regulationDetails: { max_height: "12m", zoning: "تجاري" },
    },
  });
  console.log(`✅ تم إنشاء/جلب الشارع: ${street.name}`);


  console.log("🎉 تم الانتهاء من حقن البيانات بنجاح!");
}

main()
  .catch((e) => {
    console.error("❌ حدث خطأ أثناء الحقن:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
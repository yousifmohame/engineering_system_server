const prisma = require("../utils/prisma");

// 🚀 توليد كود الطلب (مثال: 2607-0041)
exports.generateRequestCode = async () => {
  const date = new Date();
  const year = String(date.getFullYear()).slice(-2); // 26
  const month = String(date.getMonth() + 1).padStart(2, '0'); // 07
  const prefix = `${year}${month}-`;

  const lastRequest = await prisma.studyRequest.findFirst({
    where: { requestCode: { startsWith: prefix } },
    orderBy: { requestCode: "desc" },
  });

  let nextSequence = 1;
  if (lastRequest) {
    const lastNum = parseInt(lastRequest.requestCode.split("-")[1], 10);
    nextSequence = lastNum + 1;
  }

  return `${prefix}${String(nextSequence).padStart(4, "0")}`;
};

// 🚦 محرك فحص الجاهزية (حسب الملف 10)
exports.evaluateReadiness = (studyData) => {
  let readiness = "جاهزة للتحويل";
  let completeness = "مكتملة للدراسة";
  const missing = [];

  if (!studyData.title && !studyData.originalRequestText && !studyData.clientId) {
    readiness = "غير قابلة للتحويل";
    completeness = "أولية جداً";
    missing.push("يجب تحديد اسم متداول أو وصف للطلب أو ربط عميل.");
  }

  if (!studyData.suggestedMainCategory || !studyData.suggestedService) {
    if (readiness !== "غير قابلة للتحويل") readiness = "تحتاج مراجعة";
    missing.push("يجب أن يحدد المكتب التصنيف المقترح والخدمة الدقيقة.");
  }

  // يمكن إضافة المزيد من قواعد الفحص هنا...

  return { readiness, completeness, missing };
};

// 📝 مسجل الأحداث (Timeline Logger)
exports.logTimelineEvent = async (studyRequestId, userId, eventType, title, description = null, iconColor = "blue") => {
  await prisma.studyTimelineEvent.create({
    data: { studyRequestId, userId, eventType, title, description, iconColor }
  });
};

// 🕵️ سجل التدقيق (Audit Logger)
exports.logAudit = async (studyRequestId, userId, action, field, oldValue, newValue, reason = null) => {
  await prisma.studyAuditLog.create({
    data: { studyRequestId, userId, action, field, oldValue, newValue, reason }
  });
};
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// مصفوفة بأسماء الأشهر باللغة العربية
const arabicMonths = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

exports.getDashboardStats = async (req, res) => {
  try {
    // 1. حساب الـ KPIs
    const totalClients = await prisma.client.count();

    // افتراض أن جدول المعاملات اسمه PrivateTransaction أو Transaction
    const activeTransactions = await prisma.transaction.count({
      where: {
        status: { in: ["in-progress", "pending", "قيد التنفيذ", "مفتوحة"] },
      },
    });

    const totalProperties = await prisma.ownershipFile.count();

    // 💡 جلب المهام الحقيقية فقط بدون Fallback وهمي
    // (إذا لم يكن لديك جدول Task، يمكنك تخطي هذا أو تركه ليرجع 0)
    let pendingTasksCount = 0;
    let upcomingTasks = [];
    if (prisma.task) {
      pendingTasksCount = await prisma.task.count({
        where: { status: "pending" },
      });

      const rawTasks = await prisma.task.findMany({
        where: {
          status: "pending",
          dueDate: { gte: new Date() }, // المهام القادمة من اليوم فصاعداً
        },
        take: 4,
        orderBy: { dueDate: "asc" },
      });

      upcomingTasks = rawTasks.map((task) => ({
        id: task.id,
        title: task.title,
        type: task.type || "meeting", // visit, meeting, delivery
        date: task.dueDate
          ? task.dueDate.toISOString().split("T")[0]
          : "غير محدد",
        time: task.dueDate
          ? task.dueDate.toISOString().split("T")[1].substring(0, 5)
          : "",
      }));
    }

    // 2. إحصائيات حالات المعاملات (للـ Pie Chart)
    const transactionStatuses = await prisma.transaction.groupBy({
      by: ["status"],
      _count: { id: true },
    });

    const statusColorMap = {
      مكتملة: "#10b981", // أخضر
      "قيد التنفيذ": "#3b82f6", // أزرق
      معلقة: "#f59e0b", // برتقالي
      ملغاة: "#ef4444", // أحمر
      مفتوحة: "#3b82f6",
      مغلقة: "#10b981",
    };

    const statusData = transactionStatuses.map((item) => ({
      name: item.status || "أخرى",
      value: item._count.id,
      color: statusColorMap[item.status] || "#94a3b8", // لون رمادي كافتراضي
    }));

    // 3. أحدث المعاملات (آخر 5)
    const rawRecentTransactions = await prisma.transaction.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true } } },
    });

    const recentTransactions = rawRecentTransactions.map((tx) => {
      // معالجة اسم العميل بافتراض أنه قد يكون كائن JSON أو نص
      let cName = "غير محدد";
      if (tx.client?.name) {
        cName =
          typeof tx.client.name === "object"
            ? tx.client.name.ar || tx.client.name.en
            : tx.client.name;
      }

      return {
        id: tx.transactionCode || tx.id,
        clientName: cName,
        type: tx.transactionType || tx.type || "معاملة عامة",
        status: tx.status || "مفتوحة",
        date: tx.createdAt.toISOString().split("T")[0],
      };
    });

    // 4. 🚀 إنشاء المخطط البياني (Chart Data) لآخر 6 أشهر ببيانات حقيقية 100%
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1); // بداية الشهر من 6 أشهر
    sixMonthsAgo.setHours(0, 0, 0, 0);

    // أ. جلب العملاء المضافين آخر 6 أشهر
    const recentClients = await prisma.client.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true },
    });

    // ب. جلب المعاملات المضافة آخر 6 أشهر
    const recentTrans = await prisma.transaction.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true },
    });

    // ج. تهيئة كائن لترتيب الأشهر (من الأقدم للأحدث خلال الستة أشهر)
    const chartDataMap = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`; // مفتاح فريد للشهر والسنة

      chartDataMap[monthKey] = {
        name: arabicMonths[d.getMonth()], // اسم الشهر بالعربي
        clients: 0,
        transactions: 0,
        sortOrder: d.getTime(), // لضمان الترتيب الزمني لاحقاً
      };
    }

    // د. تجميع بيانات العملاء حسب الشهر
    recentClients.forEach((c) => {
      const d = new Date(c.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (chartDataMap[key]) {
        chartDataMap[key].clients += 1;
      }
    });

    // هـ. تجميع بيانات المعاملات حسب الشهر
    recentTrans.forEach((t) => {
      const d = new Date(t.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (chartDataMap[key]) {
        chartDataMap[key].transactions += 1;
      }
    });

    // تحويل الكائن إلى مصفوفة مرتبة زمنياً
    const chartData = Object.values(chartDataMap)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        name: item.name,
        clients: item.clients,
        transactions: item.transactions,
      }));

    // ==========================================
    // 5. إرسال البيانات مجمعة إلى الفرونت إند
    // ==========================================
    res.json({
      success: true,
      data: {
        kpis: {
          totalClients,
          activeTransactions,
          totalProperties,
          pendingTasks: pendingTasksCount,
        },
        statusData,
        recentTransactions,
        upcomingTasks, // الآن تعيد مصفوفة فارغة [] إذا لم تكن هناك مهام، بدلاً من بيانات وهمية
        chartData,
      },
    });
  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل جلب إحصائيات لوحة القيادة" });
  }
};

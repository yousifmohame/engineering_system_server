const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const getDashboardData = async (req, res) => {
  try {
    // 1. تنفيذ جميع الاستعلامات بشكل متوازي لضمان السرعة
    const [
      transactions,
      payments,
      settlements,
      disbursements,
      treasury,
      bankAccounts,
      reserveSettings
    ] = await Promise.all([
      prisma.privateTransaction.findMany({ include: { client: true, broker: true, agent: true } }),
      prisma.privatePayment.findMany(),
      prisma.privateSettlement.findMany({ include: { target: true, transaction: true } }),
      prisma.disbursement.findMany({ include: { beneficiary: true } }),
      prisma.treasuryTransaction.findMany({ where: { isActive: true } }),
      prisma.bankAccount.findMany(),
      prisma.treasurySettings.findUnique({ where: { id: 1 } })
    ]);

    // ==========================================
    // 1. حساب المؤشرات الرئيسية (KPIs)
    // ==========================================
    const activeTxs = transactions.filter(t => t.status !== "مغلقة" && t.status !== "ملغاة");
    const expectedRevenue = transactions.reduce((sum, t) => sum + (t.totalFees || 0), 0);
    const collectedRevenue = transactions.reduce((sum, t) => sum + (t.paidAmount || 0), 0);
    const pendingRevenue = transactions.reduce((sum, t) => sum + (t.remainingAmount || 0), 0);
    
    // التكاليف = التسويات المدفوعة + أوامر الصرف المكتملة
    const totalSettlementsPaid = settlements.filter(s => s.status === "DELIVERED").reduce((sum, s) => sum + s.amount, 0);
    const totalDisbursementsPaid = disbursements.filter(d => d.status === "تم الدفع").reduce((sum, d) => sum + d.amount, 0);
    const totalCosts = totalSettlementsPaid + totalDisbursementsPaid;

    const estimatedProfit = collectedRevenue - totalCosts;

    // الخزنة والبنوك
    const treasuryBalance = treasury.reduce((sum, t) => ["إيداع", "تحصيل"].includes(t.type) ? sum + t.amount : sum - t.amount, 0);
    const bankBalance = bankAccounts.reduce((sum, b) => sum + b.systemBalance, 0);
    
    // الاحتياطي
    const reserveValue = reserveSettings?.value || 27.3;
    const reserveBalance = reserveSettings?.enabled ? (treasuryBalance * (reserveValue / 100)) : 0;

    // ==========================================
    // 2. الالتزامات القادمة (سلف غير مسددة + تسويات معلقة للوسطاء/المعقبين)
    // ==========================================
    const upcomingObligations = [
      ...disbursements.filter(d => d.status === "معلق").map(d => ({
        date: d.date.toISOString().split("T")[0],
        ref: d.requestNumber,
        owner: d.beneficiary?.name || d.beneficiaryName || "—",
        broker: "—", agent: "—", remote: "—",
        total: d.amount,
        status: "قريب",
        type: "disbursement"
      })),
      ...settlements.filter(s => s.status === "PENDING" && s.targetType !== "شريك").map(s => ({
        date: s.createdAt.toISOString().split("T")[0],
        ref: s.transaction?.transactionCode || "—",
        owner: s.target?.name || s.targetName || "—",
        broker: s.targetType === "وسيط" ? s.amount : "—",
        agent: s.targetType === "معقب" ? s.amount : "—",
        remote: "—",
        total: s.amount,
        status: "متأخر",
        type: "settlement"
      }))
    ].slice(0, 6); // نأخذ أحدث 6 فقط

    // ==========================================
    // 3. التحصيلات المتوقعة (معاملات بها متبقي)
    // ==========================================
    const expectedCollections = transactions
      .filter(t => (t.remainingAmount || 0) > 0)
      .map(t => ({
        date: t.createdAt.toISOString().split("T")[0],
        ref: t.transactionCode,
        owner: t.client?.name || "—",
        expected: t.totalFees || 0,
        collected: t.paidAmount || 0,
        remaining: t.remainingAmount || 0,
        broker: t.broker?.name || "—",
        status: (t.remainingAmount || 0) === (t.totalFees || 0) ? "معلّق" : "جزئي"
      })).slice(0, 5);

    // ==========================================
    // 4. تحليل الربحية (تكاليف وإيرادات كل معاملة)
    // ==========================================
    const profitabilityAnalysis = transactions.slice(0, 6).map(t => {
      // حساب تكاليف المعاملة (تسويات مرتبطة بها)
      const txCosts = settlements.filter(s => s.transactionId === t.id).reduce((sum, s) => sum + s.amount, 0);
      const profit = (t.paidAmount || 0) - txCosts;
      const margin = t.paidAmount ? ((profit / t.paidAmount) * 100).toFixed(1) : 0;
      return {
        ref: t.transactionCode,
        owner: t.client?.name || "—",
        revenue: t.paidAmount || 0,
        costs: txCosts,
        profit: profit,
        margin: `${margin}%`
      };
    });

    // ==========================================
    // 5. الأرباح غير الموزعة (للشركاء)
    // ==========================================
    const undistributedProfits = settlements
      .filter(s => s.targetType === "شريك" && s.status === "PENDING")
      .map(s => ({
        ref: s.transaction?.transactionCode || "تسوية عامة",
        owner: s.target?.name || "شريك",
        profit: s.amount,
        reserve: s.amount * (reserveValue / 100),
        remaining: s.amount - (s.amount * (reserveValue / 100)),
        ratio: "حسب الاتفاق",
        status: "غير موزّع"
      })).slice(0, 5);

    // ==========================================
    // 6. بيانات الرسم البياني (آخر 6 أشهر)
    // ==========================================
    // (تبسيط: تجميع الإيرادات والتكاليف حسب الشهر)
    const chartData = [];
    const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mLabel = monthNames[d.getMonth()];
      
      const mRevenue = payments.filter(p => new Date(p.date).getMonth() === d.getMonth()).reduce((s, p) => s + p.amount, 0);
      const mCosts = settlements.filter(s => s.status === "DELIVERED" && new Date(s.deliveryDate).getMonth() === d.getMonth()).reduce((s, p) => s + p.amount, 0) 
                   + disbursements.filter(db => db.status === "تم الدفع" && new Date(db.executedAt).getMonth() === d.getMonth()).reduce((s, p) => s + p.amount, 0);
      
      chartData.push({ name: mLabel, الإيرادات: mRevenue, التكاليف: mCosts });
    }

    // إرسال البيانات للفرونت إند
    res.json({
      success: true,
      data: {
        kpis: {
          activeTxs: activeTxs.length,
          expectedRevenue,
          collectedRevenue,
          pendingRevenue,
          totalCosts,
          estimatedProfit,
          reserveBalance,
          treasuryBalance,
          bankBalance
        },
        upcomingObligations,
        expectedCollections,
        profitabilityAnalysis,
        undistributedProfits,
        chartData,
        // المخاطر (مولدة ديناميكياً)
        riskAlerts: [
          expectedCollections.length > 0 ? `يوجد ${expectedCollections.length} معاملات بها تحصيل معلق` : null,
          upcomingObligations.length > 0 ? `يوجد ${upcomingObligations.length} التزامات مالية متأخرة` : null,
        ].filter(Boolean)
      }
    });

  } catch (error) {
    console.error("Dashboard Aggregation Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getDashboardData };
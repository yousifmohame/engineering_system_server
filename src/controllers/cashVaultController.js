const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();

// ==========================================
// 1. الخزن والأرصدة
// ==========================================
const getAllVaults = async (req, res) => {
  try {
    const vaults = await prisma.cashVault.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: vaults });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createVault = async (req, res) => {
  try {
    const { vaultCode, vaultName, responsibleEmployeeId, openingBalance, notes } = req.body;
    
    const newVault = await prisma.$transaction(async (tx) => {
      const vault = await tx.cashVault.create({
        data: {
          vaultCode,
          vaultName,
          responsibleEmployeeId,
          openingBalance: new Prisma.Decimal(openingBalance),
          currentBalance: new Prisma.Decimal(openingBalance),
          pendingBalance: new Prisma.Decimal(openingBalance), // يوضع الرصيد الافتتاحي كمعلق حتى يتم تصنيفه
          openingBalanceDate: new Date(),
          notes,
          createdBy: req.user.id, // بافتراض وجود middleware للمصادقة
        }
      });

      await tx.cashVaultAuditLog.create({
        data: {
          entityType: "CashVault",
          entityId: vault.id,
          action: "CREATE_VAULT",
          userId: req.user.id,
          newValueJson: JSON.stringify(vault),
          notes: "تم إنشاء خزنة جديدة وتعيين الرصيد الافتتاحي"
        }
      });

      return vault;
    });

    res.status(201).json({ success: true, data: newVault });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. الحركات المالية (الدخول والخروج)
// ==========================================
const createVaultTransaction = async (req, res) => {
  try {
    const data = req.body;
    const amount = new Prisma.Decimal(data.amount);
    let attachmentPaths = req.files ? req.files.map(f => `/uploads/vault/${f.filename}`) : [];

    const result = await prisma.$transaction(async (tx) => {
      const vault = await tx.cashVault.findUnique({ where: { id: data.vaultId } });
      
      if (!vault) throw new Error("الخزنة غير موجودة");
      if (vault.status !== "ACTIVE") throw new Error("لا يمكن تنفيذ عمليات على خزنة غير نشطة");

      let balanceBefore = vault.currentBalance;
      let balanceAfter = balanceBefore;
      let updateData = {};

      if (data.direction === "INBOUND") {
        balanceAfter = balanceBefore.add(amount);
        
        // تقسيم الرصيد حسب الفئة
        if (data.category === "FEES") updateData.feesBalance = vault.feesBalance.add(amount);
        else if (data.category === "RESERVE") updateData.reserveBalance = vault.reserveBalance.add(amount);
        else if (data.category === "BANK_SUPPORT") updateData.bankSupportBalance = vault.bankSupportBalance.add(amount);
        else updateData.pendingBalance = vault.pendingBalance.add(amount);

      } else if (data.direction === "OUTBOUND") {
        if (balanceBefore.lessThan(amount)) throw new Error("الرصيد غير كافٍ لإتمام العملية");
        balanceAfter = balanceBefore.sub(amount);

        // الخصم من الفئة المحددة
        if (data.category === "FEES") updateData.feesBalance = vault.feesBalance.sub(amount);
        else if (data.category === "RESERVE") updateData.reserveBalance = vault.reserveBalance.sub(amount);
        else if (data.category === "BANK_SUPPORT") updateData.bankSupportBalance = vault.bankSupportBalance.sub(amount);
        else updateData.pendingBalance = vault.pendingBalance.sub(amount);
      }

      updateData.currentBalance = balanceAfter;

      // تحديث الخزنة
      await tx.cashVault.update({
        where: { id: vault.id },
        data: updateData
      });

      // توليد رقم تسلسلي للحركة
      const txCount = await tx.cashVaultTransaction.count({ where: { vaultId: vault.id } });
      const transactionNo = `${vault.vaultCode}-${new Date().getFullYear()}-${String(txCount + 1).padStart(5, '0')}`;

      // إنشاء الحركة
      const newTx = await tx.cashVaultTransaction.create({
        data: {
          transactionNo,
          vaultId: vault.id,
          transactionType: data.transactionType,
          direction: data.direction,
          amount,
          category: data.category,
          transactionDate: data.transactionDate ? new Date(data.transactionDate) : new Date(),
          balanceBefore,
          balanceAfter,
          description: data.description,
          reason: data.reason,
          createdBy: req.user.id,
          deliveredBy: data.deliveredBy,
          receivedBy: data.receivedBy,
          linkedTransactionId: data.linkedTransactionId || null,
          linkedExternalDealId: data.linkedExternalDealId || null,
          attachmentIds: attachmentPaths,
          status: "APPROVED"
        }
      });

      // تسجيل التدقيق (Audit Log)
      await tx.cashVaultAuditLog.create({
        data: {
          entityType: "CashVaultTransaction",
          entityId: newTx.id,
          action: `CREATE_${data.direction}_TX`,
          userId: req.user.id,
          newValueJson: JSON.stringify(newTx),
          notes: `حركة مالية بقيمة ${amount.toString()} لفئة ${data.category}`
        }
      });

      return newTx;
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. المعاملات الخارجية (External Deals)
// ==========================================
const createExternalDeal = async (req, res) => {
  try {
    const data = req.body;
    
    // إنشاء المعاملة والالتزامات بضربة واحدة
    const deal = await prisma.externalDeal.create({
      data: {
        dealNo: `EXT-${Date.now()}`, // يمكن تخصيص المولد لاحقاً
        dealName: data.dealName,
        ownerOrClientName: data.ownerOrClientName,
        description: data.description,
        responsiblePerson: data.responsiblePerson,
        originalAgreementAmount: new Prisma.Decimal(data.originalAgreementAmount),
        distributionMethod: data.distributionMethod,
        createdBy: req.user.id,
        obligations: {
          create: data.obligations?.map(obl => ({
            partyName: obl.partyName,
            partyType: obl.partyType,
            amount: new Prisma.Decimal(obl.amount),
            reason: obl.reason
          })) || []
        }
      },
      include: { obligations: true }
    });

    res.status(201).json({ success: true, data: deal });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 4. التسويات وتوزيع الأرباح (Settlements)
// ==========================================
const executeSettlement = async (req, res) => {
  try {
    const { vaultId, grossCollected, totalObligations, totalExpenses, reserveAmount, bankSupportAmount, netDistributable, distributions, notes } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      
      const settlementNo = `SET-${Date.now()}`;
      
      const settlement = await tx.cashSettlement.create({
        data: {
          settlementNo,
          settlementType: "CUSTOM",
          vaultId,
          grossCollected: new Prisma.Decimal(grossCollected),
          extraAmounts: new Prisma.Decimal(0),
          totalObligations: new Prisma.Decimal(totalObligations),
          totalExpenses: new Prisma.Decimal(totalExpenses),
          netProfitBeforeReserve: new Prisma.Decimal(netDistributable).add(new Prisma.Decimal(reserveAmount)).add(new Prisma.Decimal(bankSupportAmount)),
          reserveAmount: new Prisma.Decimal(reserveAmount),
          bankSupportAmount: new Prisma.Decimal(bankSupportAmount),
          netDistributable: new Prisma.Decimal(netDistributable),
          status: "APPROVED",
          createdBy: req.user.id,
          approvedBy: req.user.id,
          approvedAt: new Date(),
          notes,
          distributions: {
            create: distributions.map(d => ({
              beneficiaryName: d.beneficiaryName,
              beneficiaryType: d.beneficiaryType,
              percentage: d.percentage ? new Prisma.Decimal(d.percentage) : null,
              amount: new Prisma.Decimal(d.amount),
              reason: d.reason,
              paymentMethod: d.paymentMethod
            }))
          }
        }
      });

      // هنا يتم توليد الحركات العكسية (Outbound) لتفريغ رصيد "الأتعاب" وتحويله للمستفيدين أو للاحتياطي
      // يتطلب تطبيق منطق مشابه لـ createVaultTransaction داخلياً

      return settlement;
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// جلب الحركات المالية لخزنة محددة
// ==========================================
const getVaultTransactions = async (req, res) => {
  try {
    const { id } = req.params;
    
    // جلب الحركات مع ترتيبها من الأحدث للأقدم
    const transactions = await prisma.cashVaultTransaction.findMany({
      where: { vaultId: id },
      orderBy: { transactionDate: "desc" },
    });

    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// إلغاء حركة مالية (إنشاء قيد عكسي - Reversal)
// ==========================================
const cancelTransaction = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await prisma.$transaction(async (tx) => {
      // 1. جلب الحركة الأصلية
      const originalTx = await tx.cashVaultTransaction.findUnique({
        where: { id },
        include: { vault: true }
      });

      if (!originalTx) throw new Error("الحركة المالية غير موجودة");
      if (originalTx.status === "CANCELLED") throw new Error("هذه الحركة ملغاة بالفعل");

      const vault = originalTx.vault;
      const amount = originalTx.amount;
      
      let updateData = {};
      let balanceBefore = vault.currentBalance;
      let balanceAfter = balanceBefore;

      // 2. عكس التأثير المحاسبي
      // إذا كانت الحركة إيداع (INBOUND)، نعكسها بخصم (OUTBOUND)
      if (originalTx.direction === "INBOUND") {
        balanceAfter = balanceBefore.sub(amount);
        
        if (originalTx.category === "FEES") updateData.feesBalance = vault.feesBalance.sub(amount);
        else if (originalTx.category === "RESERVE") updateData.reserveBalance = vault.reserveBalance.sub(amount);
        else if (originalTx.category === "BANK_SUPPORT") updateData.bankSupportBalance = vault.bankSupportBalance.sub(amount);
        else updateData.pendingBalance = vault.pendingBalance.sub(amount);

      } else if (originalTx.direction === "OUTBOUND") {
        // إذا كانت الحركة سحب، نعكسها بإضافة (INBOUND)
        balanceAfter = balanceBefore.add(amount);
        
        if (originalTx.category === "FEES") updateData.feesBalance = vault.feesBalance.add(amount);
        else if (originalTx.category === "RESERVE") updateData.reserveBalance = vault.reserveBalance.add(amount);
        else if (originalTx.category === "BANK_SUPPORT") updateData.bankSupportBalance = vault.bankSupportBalance.add(amount);
        else updateData.pendingBalance = vault.pendingBalance.add(amount);
      }

      updateData.currentBalance = balanceAfter;

      // 3. تحديث أرصدة الخزنة
      await tx.cashVault.update({
        where: { id: vault.id },
        data: updateData
      });

      // 4. تغيير حالة الحركة الأصلية إلى ملغاة
      await tx.cashVaultTransaction.update({
        where: { id },
        data: { status: "CANCELLED" }
      });

      // 5. تسجيل الإجراء في الـ Audit Log لضمان الشفافية
      await tx.cashVaultAuditLog.create({
        data: {
          entityType: "CashVaultTransaction",
          entityId: originalTx.id,
          action: "CANCEL_TRANSACTION",
          userId: req.user.id, // الموظف الذي قام بالإلغاء
          notes: `تم إلغاء الحركة رقم ${originalTx.transactionNo} وعكس القيد المحاسبي.`
        }
      });

      return originalTx;
    });

    res.json({ success: true, message: "تم الإلغاء وعكس القيد بنجاح", data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// جلب السجل التاريخي (Audit Log) لخزنة معينة
// ==========================================
const getVaultAuditLogs = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. جلب معرفات الحركات التابعة لهذه الخزنة
    const vaultTransactions = await prisma.cashVaultTransaction.findMany({
      where: { vaultId: id },
      select: { id: true }
    });
    const transactionIds = vaultTransactions.map(tx => tx.id);

    // 2. جلب سجلات التدقيق مع بيانات الموظف مباشرة (بفضل العلاقة الجديدة)
    const logs = await prisma.cashVaultAuditLog.findMany({
      where: {
        OR: [
          { entityType: "CashVault", entityId: id },
          { entityType: "CashVaultTransaction", entityId: { in: transactionIds } }
        ]
      },
      include: {
        user: { // 👈 جلب اسم الموظف مباشرة
          select: { id: true, name: true, firstNameAr: true } 
        }
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// لا تنسَ تصدير الدوال الجديدة في نهاية الملف
module.exports = {
  getAllVaults,
  createVault,
  getVaultTransactions, // 👈
  createVaultTransaction,
  cancelTransaction,    // 👈
  createExternalDeal,
  executeSettlement,
  getVaultAuditLogs
};
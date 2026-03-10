const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 1. جلب جميع الحسابات البنكية
const getBankAccounts = async (req, res) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        openedBy: { select: { name: true } },
        controlledBy: { select: { name: true } },
      },
    });

    const formattedData = accounts.map((acc) => {
      const totalBalance =
        acc.initialBalance + acc.systemBalance + acc.externalBalance;
      return {
        ...acc,
        totalBalance,
        // قراءة الأسماء من العلاقات للواجهة
        openedByName: acc.openedBy?.name || "—",
        controlledByName: acc.controlledBy?.name || "—",
        lastUpdated: acc.updatedAt.toISOString().split("T")[0],
      };
    });

    res.json({ success: true, data: formattedData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. إضافة حساب بنكي جديد
const createBankAccount = async (req, res) => {
  try {
    const data = req.body;

    const newAccount = await prisma.bankAccount.create({
      data: {
        bankName: data.bankName,
        accountName: data.accountName,
        accountNumber: data.accountNumber,
        iban: data.iban,
        // 💡 حفظ الـ IDs بدلاً من الأسماء
        openedById: data.openedById || null,
        controlledById: data.controlledById || null,
        openDate: data.openDate ? new Date(data.openDate) : null,
        authorizedPersons: data.authorizedPersons, // هذا الحقل نصي (String)
        initialBalance: parseFloat(data.initialBalance) || 0,
        initialBalanceDate: data.initialBalanceDate
          ? new Date(data.initialBalanceDate)
          : null,
        initialBalanceNotes: data.initialBalanceNotes,
      },
    });

    res.status(201).json({ success: true, data: newAccount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. تعديل حساب بنكي
const updateBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updatedAccount = await prisma.bankAccount.update({
      where: { id },
      data: {
        bankName: data.bankName,
        accountName: data.accountName,
        accountNumber: data.accountNumber,
        iban: data.iban,
        openedById: data.openedById || null,
        controlledById: data.controlledById || null,
        openDate: data.openDate ? new Date(data.openDate) : null,
        authorizedPersons: data.authorizedPersons,
        initialBalance: parseFloat(data.initialBalance) || 0,
        initialBalanceDate: data.initialBalanceDate
          ? new Date(data.initialBalanceDate)
          : null,
        initialBalanceNotes: data.initialBalanceNotes,
      },
    });

    res.json({ success: true, data: updatedAccount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. حذف حساب بنكي
const deleteBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.bankAccount.delete({ where: { id } });
    res.json({ success: true, message: "تم حذف الحساب البنكي بنجاح" });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "لا يمكن حذف هذا الحساب لوجود حركات مالية مرتبطة به.",
      });
  }
};

// 5. شحن شخصي لشريك (يزيد الرصيد الخارجي)
const addPersonalRecharge = async (req, res) => {
  try {
    const { accountId, partnerId, amount, date, notes } = req.body;
    const parsedAmount = parseFloat(amount) || 0;

    const transaction = await prisma.bankTransaction.create({
      data: {
        accountId,
        type: "شحن شخصي",
        amount: parsedAmount,
        partnerId: partnerId || null, // 💡 تم تعديلها لتأخذ الـ ID
        date: date ? new Date(date) : new Date(),
        notes,
      },
    });

    await prisma.bankAccount.update({
      where: { id: accountId },
      data: { externalBalance: { increment: parsedAmount } },
    });

    res
      .status(201)
      .json({
        success: true,
        data: transaction,
        message: "تم شحن رصيد الحساب بنجاح",
      });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  addPersonalRecharge,
};

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { generateQRDataURL } = require("../utils/qrGenerator");

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

    // 1. إنشاء الحساب أولاً
    const newAccount = await prisma.bankAccount.create({
      data: {
        bankName: data.bankName,
        bankLogo: data.bankLogo || null,
        accountNameAr: data.accountNameAr,
        accountNameEn: data.accountNameEn,
        currency: data.currency || "SAR",
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

    // 2. توليد الـ QR Code برابط الحساب الجديد
    try {
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const publicUrl = `${frontendUrl}/shared/bank/${newAccount.id}`;
      const qrCodeBase64 = await generateQRDataURL(publicUrl);

      // تحديث الحساب بكود الـ QR
      if (qrCodeBase64) {
        await prisma.bankAccount.update({
          where: { id: newAccount.id },
          data: { qrCodeData: qrCodeBase64 },
        });
        newAccount.qrCodeData = qrCodeBase64;
      }
    } catch (qrError) {
      console.error("Failed to generate QR Code on create:", qrError.message);
      // لن نوقف العملية في حال فشل توليد الـ QR، بل سنكمل إرجاع الحساب
    }

    res.status(201).json({ success: true, data: newAccount });
  } catch (error) {
    console.error("Create Bank Account Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. تعديل حساب بنكي
const updateBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    let qrCodeBase64 = undefined;

    // 1. محاولة توليد QR محدث (خاصة إذا تم تغيير بيانات تؤثر عليه مستقبلاً)
    try {
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const publicUrl = `${frontendUrl}/shared/bank/${id}`;
      qrCodeBase64 = await generateQRDataURL(publicUrl);
    } catch (qrError) {
      console.error("Failed to generate QR Code on update:", qrError.message);
    }

    // 2. تحديث الحساب
    const updatedAccount = await prisma.bankAccount.update({
      where: { id },
      data: {
        bankName: data.bankName,
        bankLogo: data.bankLogo || null,
        accountNameAr: data.accountNameAr,
        accountNameEn: data.accountNameEn,
        currency: data.currency || "SAR",
        accountNumber: data.accountNumber,
        iban: data.iban,
        openedById: data.openedById || null,
        controlledById: data.controlledById || null,
        openDate: data.openDate ? new Date(data.openDate) : null,
        authorizedPersons: data.authorizedPersons,
        // تحديث الـ QR فقط إذا تم توليده بنجاح
        ...(qrCodeBase64 && { qrCodeData: qrCodeBase64 }),
      },
    });

    res.json({ success: true, data: updatedAccount });
  } catch (error) {
    console.error("Update Bank Account Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🚀 دالة: جلب حساب بنكي للزوار (Public) لصفحة الـ QR
const getPublicBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const account = await prisma.bankAccount.findUnique({
      where: { id },
      select: {
        id: true,
        bankName: true,
        bankLogo: true,
        accountNameAr: true,
        accountNameEn: true,
        accountNumber: true,
        iban: true,
        currency: true,
      },
    });

    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "الحساب غير موجود" });
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(500).json({ success: false, message: "حدث خطأ" });
  }
};

// 4. حذف حساب بنكي
const deleteBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.bankAccount.delete({ where: { id } });
    res.json({ success: true, message: "تم حذف الحساب البنكي بنجاح" });
  } catch (error) {
    res.status(500).json({
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
        partnerId: partnerId || null,
        date: date ? new Date(date) : new Date(),
        notes,
      },
    });

    await prisma.bankAccount.update({
      where: { id: accountId },
      data: { externalBalance: { increment: parsedAmount } },
    });

    res.status(201).json({
      success: true,
      data: transaction,
      message: "تم شحن رصيد الحساب بنجاح",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. إضافة حركة بنكية (إيداع / سحب / مصروف) وتحديث الرصيد
const createBankTransaction = async (req, res) => {
  try {
    const { accountId, type, amount, date, notes } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!parsedAmount || parsedAmount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "المبلغ غير صحيح" });
    }

    const balanceChange = type === "deposit" ? parsedAmount : -parsedAmount;
    const typeAr =
      type === "deposit" ? "إيداع" : type === "withdrawal" ? "سحب" : "مصروف";

    const result = await prisma.$transaction([
      prisma.bankTransaction.create({
        data: {
          accountId,
          type: typeAr,
          amount: parsedAmount,
          date: date ? new Date(date) : new Date(),
          notes: notes || null,
        },
      }),
      prisma.bankAccount.update({
        where: { id: accountId },
        data: { systemBalance: { increment: balanceChange } },
      }),
    ]);

    res.status(201).json({
      success: true,
      message: "تم تسجيل العملية وتحديث الرصيد بنجاح",
      data: result[0],
    });
  } catch (error) {
    console.error("Bank Transaction Error:", error);
    res.status(500).json({ success: false, message: "فشل تسجيل العملية" });
  }
};

module.exports = {
  getBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  addPersonalRecharge,
  createBankTransaction,
  getPublicBankAccount,
};

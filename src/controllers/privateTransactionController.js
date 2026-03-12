const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ==================================================
// دالة توليد رقم المعاملة (سنة-شهر-خمس أرقام)
// مثال: 2026-03-00001
// ==================================================
const generatePrivateTxCode = async () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // إضافة 0 إذا كان الشهر أقل من 10
  const prefix = `${year}-${month}-`;

  // جلب آخر معاملة في هذا الشهر تحديداً
  const lastTx = await prisma.privateTransaction.findFirst({
    where: { transactionCode: { startsWith: prefix } },
    orderBy: { transactionCode: "desc" },
  });

  let nextNumber = 1;
  if (lastTx) {
    try {
      // فصل النص بناءً على (-) وأخذ الجزء الثالث الذي يمثل الرقم
      const parts = lastTx.transactionCode.split("-");
      const lastNumberStr = parts[2]; // مثال: 00001
      nextNumber = parseInt(lastNumberStr, 10) + 1;
    } catch (e) {
      nextNumber = 1;
    }
  }

  // دمج البادئة مع الرقم المكون من 5 خانات
  return `${prefix}${String(nextNumber).padStart(5, "0")}`;
};

// ==================================================
// دالة توليد كود العميل تلقائياً (مثال: C-001)
// ==================================================
const generateClientCode = async () => {
  const lastClient = await prisma.client.findFirst({
    orderBy: { createdAt: "desc" },
  });

  const year = new Date().getFullYear();

  if (!lastClient || !lastClient.clientCode) {
    return `CLT-${year}-001`;
  }

  // استخراج الرقم الأخير فقط
  const parts = lastClient.clientCode.split("-");
  const lastNumber = parseInt(parts[2]);

  if (isNaN(lastNumber)) {
    return `CLT-${year}-001`;
  }

  const nextNumber = String(lastNumber + 1).padStart(3, "0");

  return `CLT-${year}-${nextNumber}`;
};

// ==================================================
// 1. إنشاء معاملة خاصة جديدة
// POST /api/private-transactions
// ==================================================
const createPrivateTransaction = async (req, res) => {
  try {
    const {
      internalName,
      isInternalNameHidden,
      transactionType,
      surveyType,
      feeType,

      // العميل
      clientId,
      ownerName,
      ownerIdNumber,
      ownerMobile, // 👈 أضفنا استدعاء رقم الجوال هنا

      // الموقع والمراجع
      districtId,
      sector,
      plots,
      plan,
      oldDeed,
      serviceNo,
      requestNo,
      licenseNo,

      // الجهات والمرفقات والمصادر
      entities,
      receivedAttachmentsList,
      source,
      sourceType,
      sourceName,
      sourcePercent,

      // الماليات والأطراف
      totalFees,
      firstPayment,
      mediatorFees,
      agentFees,
      brokerId,
      followUpAgentId,
      stakeholderId,
      receiverId,
      engOfficeBrokerId,
    } = req.body;

    // 1. معالجة العميل (إذا كان عميل جديد سريع، نقوم بإنشائه أولاً في الداتابيز)
    // 1. معالجة العميل (إذا كان عميل جديد سريع، نقوم بإنشائه أولاً في الداتابيز)
    let finalClientId = clientId;

    if (!finalClientId) {
      if (!ownerName) {
        return res.status(400).json({
          success: false,
          message: "يرجى اختيار المالك أو إدخال اسم المالك الجديد.",
        });
      }

      const clientCode = await generateClientCode(); // توليد الكود

      // 💡 حماية قاعدة البيانات: الهوية إجبارية وفريدة (Unique) في الـ Schema
      // إذا لم يُدخل المستخدم رقم هوية، نولد له رقم مؤقت فريد حتى لا ينكسر النظام
      const uniqueIdNumber =
        ownerIdNumber && ownerIdNumber.trim() !== ""
          ? ownerIdNumber
          : `TMP-${Date.now()}`;

      // إنشاء عميل جديد بتنسيق يطابق الـ Prisma Schema 100%
      const newClient = await prisma.client.create({
        data: {
          clientCode: clientCode,
          mobile: ownerMobile || "بدون رقم",
          idNumber: uniqueIdNumber,
          type: "فرد", // 👈 حقل إجباري حسب Schema

          // 👈 الحقول التالية إجبارية كـ JSON
          name: { ar: ownerName, en: "", details: {} },
          contact: { mobile: ownerMobile || "بدون رقم", email: "", phone: "" },
          identification: { idType: "هوية وطنية", idNumber: uniqueIdNumber },

          isActive: true,
        },
      });
      finalClientId = newClient.id;
    }
    // 2. معالجة الأرقام والبيانات
    const transactionCode = await generatePrivateTxCode();
    const parsedTotalFees = totalFees ? parseFloat(totalFees) : 0;
    const parsedFirstPayment = firstPayment ? parseFloat(firstPayment) : 0;

    // تحديد عنوان المعاملة
    const txTitle =
      !isInternalNameHidden && internalName
        ? `${internalName} - ${transactionCode}`
        : `${transactionType || "معاملة"} - ${transactionCode}`;

    // 3. إنشاء المعاملة
    const newTransaction = await prisma.privateTransaction.create({
      data: {
        transactionCode,
        title: txTitle,
        category: transactionType || "غير محدد",
        complexity: surveyType || "بدون رفع",
        source: source || "مكتب ديتيلز",
        status: "in_progress",
        totalFees: parsedTotalFees,
        paidAmount: parsedFirstPayment,
        remainingAmount: parsedTotalFees - parsedFirstPayment,

        clientId: finalClientId,
        districtId: districtId || null,

        authorities: Array.isArray(entities) ? entities : [],
        attachments: Array.isArray(receivedAttachmentsList)
          ? receivedAttachmentsList
          : [],

        brokerId: brokerId || null,
        agentId: followUpAgentId || null,
        stakeholderId: stakeholderId || null,
        receiverId: receiverId || null,
        engOfficeBrokerId: engOfficeBrokerId || null,

        notes: {
          internalName: internalName || null,
          isInternalNameHidden: isInternalNameHidden || false,
          feeType: feeType || "نهائي",
          agentFees: agentFees ? parseFloat(agentFees) : 0,
          mediatorFees: mediatorFees ? parseFloat(mediatorFees) : 0,
          sourceDistribution: {
            type: sourceType,
            name: sourceName,
            percent: sourcePercent ? parseFloat(sourcePercent) : 0,
          },
          refs: {
            plots: Array.isArray(plots) ? plots : [],
            plan: plan || null,
            sector: sector || null,
            oldDeed: oldDeed || null,
            serviceNo: serviceNo || null,
            requestNo: requestNo || null,
            licenseNo: licenseNo || null,
            ownerMobile: ownerMobile || null, // حفظ الرقم كمرجع إضافي في الملاحظات
          },
          statuses: {
            collection:
              parsedFirstPayment >= parsedTotalFees && parsedTotalFees > 0
                ? "fully_collected"
                : parsedFirstPayment > 0
                  ? "partially_collected"
                  : "not_collected",
            approval: "approved",
            settlement: "unsettled",
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: "تم إنشاء المعاملة بنجاح",
      data: newTransaction,
    });
  } catch (error) {
    console.error("Create Private Transaction Error:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في السيرفر أثناء حفظ المعاملة",
      error: error.message,
    });
  }
};

// ==================================================
// 3. تسجيل تحصيل مالي (مربوط بالأشخاص والبنك)
// POST /api/private-transactions/payments
// ==================================================
// ==================================================
// 3. تسجيل تحصيل مالي (مربوط بالأشخاص والبنك)
// POST /api/private-transactions/payments
// ==================================================
const addPrivatePayment = async (req, res) => {
  try {
    // 💡 التعديل هنا: استقبال الحقول لتتطابق 100% مع ما يرسله الفرونت إند
    const {
      transactionId,
      amount,
      method, // الواجهة ترسل method
      paymentMethod,
      ref, // الواجهة ترسل ref
      periodRef,
      date, // 👈 هذا الحقل كان مفقوداً وهو إجباري في الداتابيز!
      collectedFromType,
      collectedFromId,
      collectedFromOther,
      bankAccountId,
      receiverId,
      notes,
    } = req.body;

    const paymentAmount = parseFloat(amount);

    if (!transactionId || isNaN(paymentAmount) || paymentAmount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "بيانات التحصيل غير صحيحة" });
    }

    const transaction = await prisma.privateTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction)
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });

    // مسار المرفق إن وجد
    const receiptImage = req.file
      ? `/uploads/payments/${req.file.filename}`
      : null;

    // استخدام Transaction لحماية قواعد البيانات
    const result = await prisma.$transaction(async (prismaDelegate) => {
      // 1. إنشاء الدفعة
      const newPayment = await prismaDelegate.privatePayment.create({
        data: {
          transactionId: transactionId,
          amount: paymentAmount,
          date: date ? new Date(date) : new Date(), // 👈 تمرير التاريخ الإجباري
          method: method || paymentMethod || "نقدي", // 👈 أخذ الطريقة من الواجهة
          periodRef: ref || periodRef || null, // 👈 أخذ المرجع من الواجهة
          collectedFromType: collectedFromType || "عميل",
          collectedFromId: collectedFromId || null,
          collectedFromName: collectedFromOther || null,
          bankAccountId: bankAccountId || null,
          receiverId: receiverId || null,
          notes: notes || "",
          receiptImage: receiptImage,
        },
      });

      // 2. تحديث المتبقي في المعاملة
      const newPaidAmount = (transaction.paidAmount || 0) + paymentAmount;
      const newRemainingAmount = (transaction.totalFees || 0) - newPaidAmount;

      await prismaDelegate.privateTransaction.update({
        where: { id: transactionId },
        data: {
          paidAmount: newPaidAmount,
          remainingAmount: newRemainingAmount < 0 ? 0 : newRemainingAmount,
        },
      });

      // 3. (اختياري) إذا كان الدفع بنكي، نزيد رصيد البنك
      if (
        (method === "تحويل بنكي" || paymentMethod === "بنكي") &&
        bankAccountId
      ) {
        await prismaDelegate.bankAccount.update({
          where: { id: bankAccountId },
          data: { systemBalance: { increment: paymentAmount } },
        });
      }

      return newPayment;
    });

    res
      .status(201)
      .json({ success: true, message: "تم تسجيل الدفعة بنجاح", data: result });
  } catch (error) {
    console.error("Add Payment Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 4. جلب إحصائيات لوحة القيادة
// GET /api/private-transactions/dashboard-stats
// ==================================================
const getDashboardStats = async (req, res) => {
  try {
    // جلب الإجماليات
    const aggregations = await prisma.privateTransaction.aggregate({
      _count: { id: true },
      _sum: { totalFees: true, paidAmount: true },
    });

    // 💡 جلب آخر 5 معاملات لعرضها في الجدول الصغير في الداشبورد
    const recentTx = await prisma.privateTransaction.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true } } },
    });

    const recentFormatted = recentTx.map((tx) => {
      let clientName = "عميل";
      if (tx.client?.name) {
        clientName =
          typeof tx.client.name === "string"
            ? JSON.parse(tx.client.name).ar
            : tx.client.name.ar;
      }
      return {
        id: tx.id,
        ref: tx.transactionCode,
        type: tx.category,
        client: clientName,
        value: tx.totalFees,
        status: tx.status === "in_progress" ? "جارية" : "مكتملة", // تعريب الحالة
        date: tx.createdAt.toISOString().split("T")[0],
      };
    });

    // عدد الوسطاء لتعبئة كارد "الوسطاء النشطون"
    const activeBrokersCount = await prisma.person.count({
      where: { role: "وسيط" },
    });

    res.json({
      success: true,
      data: {
        totalCount: aggregations._count.id || 0,
        totalProfits: aggregations._sum.totalFees || 0,
        vaultBalance: aggregations._sum.paidAmount || 0,
        activeBrokers: activeBrokersCount,
        recentTransactions: recentFormatted, // 👈 هذا ما ينتظره الفرونت إند للجدول
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل جلب الإحصائيات" });
  }
};

// ==================================================
// 5. حذف المعاملة
// DELETE /api/private-transactions/:id
// ==================================================
const deletePrivateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.privateTransaction.delete({ where: { id } });
    res.json({ success: true, message: "تم حذف المعاملة بنجاح" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "لا يمكن حذف معاملة مرتبطة بمدفوعات مالية.",
    });
  }
};

// ==================================================
// 6. تجميد / تنشيط المعاملة
// PATCH /api/private-transactions/:id/toggle-freeze
// ==================================================
const toggleFreezeTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    if (!tx)
      return res.status(404).json({ success: false, message: "غير موجودة" });

    const newStatus = tx.status === "مجمّدة" ? "جارية" : "مجمّدة";
    await prisma.privateTransaction.update({
      where: { id },
      data: { status: newStatus },
    });

    res.json({
      success: true,
      message: `تم تغيير حالة المعاملة إلى: ${newStatus}`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "حدث خطأ" });
  }
};
const getPrivateTransactions = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const cursor = req.query.cursor;

    const transactions = await prisma.privateTransaction.findMany({
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,

      orderBy: {
        createdAt: "desc",
      },

      select: {
        id: true,
        transactionCode: true,
        category: true,
        source: true,
        status: true,
        totalFees: true,
        paidAmount: true,
        remainingAmount: true,
        createdAt: true,
        notes: true,

        client: {
          select: { name: true },
        },

        districtNode: {
          select: {
            name: true,
            sector: {
              select: { name: true },
            },
          },
        },

        agent: {
          select: { name: true },
        },

        brokersList: {
          select: {
            id: true,
            fees: true,
            brokerId: true,
            broker: {
              select: { name: true },
            },
          },
        },
      },
    });

    const formattedData = [];

    for (const tx of transactions) {
      const notes =
        typeof tx.notes === "object" && tx.notes !== null ? tx.notes : {};

      // استخراج اسم العميل بشكل آمن
      let ownerName = "غير محدد";

      try {
        if (tx.client?.name) {
          const parsed =
            typeof tx.client.name === "string"
              ? JSON.parse(tx.client.name)
              : tx.client.name;

          ownerName = parsed?.ar || parsed || "غير محدد";
        }
      } catch {
        ownerName = tx.client?.name || "غير محدد";
      }

      // حالة التحصيل
      let collectionStatus = "غير محصل";

      if (tx.totalFees > 0) {
        if (tx.paidAmount >= tx.totalFees) collectionStatus = "محصل بالكامل";
        else if (tx.paidAmount > 0) collectionStatus = "محصل جزئي";
      }

      // التاريخ
      const dateObj = new Date(tx.createdAt);

      const formattedDate = `${dateObj.getFullYear()}/${String(
        dateObj.getMonth() + 1,
      ).padStart(2, "0")}/${String(dateObj.getDate()).padStart(2, "0")}`;

      // الوسطاء
      const brokers =
        tx.brokersList?.map((b) => ({
          id: b.id,
          personId: b.brokerId,
          name: b.broker?.name || "وسيط",
          fees: b.fees,
        })) || [];

      const totalBrokerFees = brokers.reduce((sum, b) => sum + b.fees, 0);

      const brokerNames =
        brokers.length > 0 ? brokers.map((b) => b.name).join(" و ") : "—";

      formattedData.push({
        id: tx.id,
        ref: tx.transactionCode,

        type: tx.category || "غير محدد",

        client: ownerName,

        district: tx.districtNode?.name || "غير محدد",

        sector:
          notes?.refs?.sector || tx.districtNode?.sector?.name || "غير محدد",

        plot: notes?.refs?.plot || "—",
        plan: notes?.refs?.plan || "—",

        office: tx.source || "مكتب ديتيلز",

        sourceName: notes?.sourceName || "مباشر",

        mediator: brokerNames,
        mediatorFees: totalBrokerFees,
        brokers,

        agentCost: notes?.agentFees || 0,

        totalFees: tx.totalFees || 0,
        paidAmount: tx.paidAmount || 0,

        remainingAmount:
          tx.remainingAmount || (tx.totalFees || 0) - (tx.paidAmount || 0),

        collectionStatus,

        status: tx.status || "جارية",

        date: formattedDate,
        created: formattedDate,
      });
    }

    const nextCursor =
      transactions.length === limit
        ? transactions[transactions.length - 1].id
        : null;

    res.json({
      success: true,
      count: formattedData.length,
      nextCursor,
      data: formattedData,
    });
  } catch (error) {
    console.error("Get Private Transactions Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// 💡 2. دالة حذف الدفعة (التحصيل)
const deletePrivatePayment = async (req, res) => {
  try {
    const { id } = req.params;
    // استرجاع الدفعة أولاً لمعرفة المعاملة المرتبطة والمبلغ
    const payment = await prisma.privatePayment.findUnique({ where: { id } });
    if (!payment)
      return res
        .status(404)
        .json({ success: false, message: "الدفعة غير موجودة" });

    // حذف الدفعة وتحديث رصيد المعاملة في عملية واحدة (Transaction)
    await prisma.$transaction(async (prismaDelegate) => {
      await prismaDelegate.privatePayment.delete({ where: { id } });

      if (payment.transactionId) {
        const tx = await prismaDelegate.privateTransaction.findUnique({
          where: { id: payment.transactionId },
        });
        if (tx) {
          const newPaid = Math.max(0, tx.paidAmount - payment.amount);
          const newRemaining = tx.totalFees - newPaid;
          await prismaDelegate.privateTransaction.update({
            where: { id: tx.id },
            data: { paidAmount: newPaid, remainingAmount: newRemaining },
          });
        }
      }
    });

    res.json({ success: true, message: "تم حذف الدفعة بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 3. رفع مرفقات المعاملة
const addTransactionAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرسال ملف" });

    // ملاحظة: إذا كان لديك جدول TransactionAttachment استخدمه،
    // وإلا يمكنك حفظ المرفقات كمصفوفة JSON داخل حقل notes أو attachments

    // سنعتبر أنك تحفظها في حقل notes.attachments مؤقتاً:
    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};
    let attachments = currentNotes.attachments || [];

    attachments.push({
      name: req.file.originalname,
      url: `/uploads/receipts/${req.file.filename}`,
      size: req.file.size,
    });

    currentNotes.attachments = attachments;

    await prisma.privateTransaction.update({
      where: { id },
      data: { notes: currentNotes },
    });

    res.json({ success: true, message: "تم رفع المرفق بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 4. إضافة موعد تحصيل
const addCollectionDate = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, amount, person, notes } = req.body;

    // يمكنك حفظ المواعيد في حقل json أو في جدول منفصل CollectionDate
    // للتبسيط سنحفظها في notes.collectionDates
    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};
    let dates = currentNotes.collectionDates || [];

    dates.push({
      id: Date.now().toString(),
      date,
      amount,
      person,
      notes,
      isLate: false,
    });
    currentNotes.collectionDates = dates;

    await prisma.privateTransaction.update({
      where: { id },
      data: { notes: currentNotes },
    });

    res.json({ success: true, message: "تمت إضافة الموعد" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const assignAgentToTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { agentId, fees } = req.body;

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    if (!tx)
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });

    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};
    currentNotes.agentFees = parseFloat(fees) || 0;

    await prisma.privateTransaction.update({
      where: { id },
      data: {
        agentId: agentId,
        notes: currentNotes,
      },
    });

    res.json({ success: true, message: "تم ربط المعقب بالمعاملة بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// تعيين وسيط لمعاملة (عبر الجدول الاحترافي)
// POST /api/private-transactions/:id/brokers
// ==================================================
const assignBrokerToTransaction = async (req, res) => {
  try {
    const { id } = req.params; // transactionId
    const { brokerId, fees } = req.body;

    // إضافة السجل في الجدول الوسيط الجديد
    const newBrokerRecord = await prisma.transactionBroker.create({
      data: {
        transactionId: id,
        brokerId: brokerId,
        fees: parseFloat(fees) || 0,
      },
    });

    res.json({
      success: true,
      message: "تم تعيين الوسيط بنجاح",
      data: newBrokerRecord,
    });
  } catch (error) {
    console.error("Assign Broker Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// حذف وسيط من معاملة
// DELETE /api/private-transactions/brokers/:brokerRecordId
// ==================================================
const removeBrokerFromTransaction = async (req, res) => {
  try {
    const { brokerRecordId } = req.params;
    await prisma.transactionBroker.delete({
      where: { id: brokerRecordId },
    });
    res.json({ success: true, message: "تم إزالة الوسيط من المعاملة" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// تحديث حالة المعاملة (التبويب الجديد: حالة المعاملة)
// POST /api/private-transactions/:id/status
// ==================================================
const updateTransactionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      currentStatus,
      serviceNumber,
      hijriYear1,
      licenseNumber,
      hijriYear2,
      oldLicenseNumber,
      authorityNotes,
      approvalDate, // 💡 نستقبل تاريخ الاعتماد إذا تم إرساله من الواجهة
    } = req.body;

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    if (!tx) {
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });
    }

    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};

    // مسار المرفق إن وُجد (ملاحظات الجهات)
    let noteAttachmentPath =
      currentNotes.transactionStatusData?.noteAttachment || null;
    if (req.file) {
      noteAttachmentPath = `/uploads/status_notes/${req.file.filename}`;
    }

    // تحديث بيانات الحالة داخل الـ JSON (notes)
    currentNotes.transactionStatusData = {
      currentStatus: currentStatus || "عند المهندس للدراسة",
      serviceNumber: serviceNumber || "",
      hijriYear1: hijriYear1 || "",
      licenseNumber: licenseNumber || "",
      hijriYear2: hijriYear2 || "",
      oldLicenseNumber: oldLicenseNumber || "",
      authorityNotes: authorityNotes || "",
      noteAttachment: noteAttachmentPath,
      // 💡 نحتفظ بتاريخ الاعتماد القديم إذا كان موجوداً ولم يتم إرسال جديد
      approvalDate:
        approvalDate ||
        currentNotes.transactionStatusData?.approvalDate ||
        null,
    };

    await prisma.privateTransaction.update({
      where: { id },
      data: { notes: currentNotes },
    });

    res.json({ success: true, message: "تم تحديث حالة المعاملة بنجاح" });
  } catch (error) {
    console.error("Update Transaction Status Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
// ==================================================
// تحديث بيانات المعاملة (الأساسية والمالية والتسكين والمرفقات)
// PUT /api/private-transactions/:id
// ==================================================
const updatePrivateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      year,
      month,
      client,
      districtId,
      sector,
      type,
      office,
      sourceName,
      totalFees,
      mediatorFees,
      agentCost,
      notes, // 👈 1. استلام الـ notes من الواجهة (التي تحتوي على المرفقات بعد الحذف)
    } = req.body;

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    if (!tx) {
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });
    }

    let newTransactionCode = tx.transactionCode;
    let newCreatedAt = tx.createdAt;

    // 1. التحقق من التسكين (تغيير السنة والشهر لتوليد كود جديد)
    if (year && month) {
      const currentYear = tx.createdAt.getFullYear().toString();
      const currentMonth = (tx.createdAt.getMonth() + 1)
        .toString()
        .padStart(2, "0");

      if (year !== currentYear || month !== currentMonth) {
        const prefix = `${year}-${month}-`;

        const lastTx = await prisma.privateTransaction.findFirst({
          where: { transactionCode: { startsWith: prefix } },
          orderBy: { transactionCode: "desc" },
        });

        let nextNumber = 1;
        if (lastTx) {
          try {
            const parts = lastTx.transactionCode.split("-");
            const lastNumberStr = parts[2];
            nextNumber = parseInt(lastNumberStr, 10) + 1;
          } catch (e) {
            nextNumber = 1;
          }
        }
        newTransactionCode = `${prefix}${String(nextNumber).padStart(5, "0")}`;
        newCreatedAt = new Date(`${year}-${month}-01T10:00:00Z`);
      }
    }

    // 2. تحديث اسم العميل
    if (client && tx.clientId) {
      await prisma.client.update({
        where: { id: tx.clientId },
        data: { name: { ar: client, en: "", details: {} } },
      });
    }

    // 3. تحديث الـ JSON الخاص بالملاحظات
    let currentNotes =
      typeof tx.notes === "object" && tx.notes !== null ? tx.notes : {};

    // 💡 السطر السحري لحل مشكلة الحذف: تحديث المرفقات إذا تم إرسالها بعد حذف ملف منها
    if (notes && notes.attachments !== undefined) {
      currentNotes.attachments = notes.attachments;
    }

    if (!currentNotes.refs) currentNotes.refs = {};
    if (sector) currentNotes.refs.sector = sector;

    // 4. التحديث الجذري للأتعاب داخل notes
    if (agentCost !== undefined && agentCost !== null) {
      currentNotes.agentFees = parseFloat(agentCost) || 0;
    }

    if (mediatorFees !== undefined && mediatorFees !== null) {
      currentNotes.mediatorFees = parseFloat(mediatorFees) || 0;
    }

    if (sourceName !== undefined) {
      currentNotes.sourceName = sourceName;
    }

    // 5. الحسابات المالية
    const parsedTotalFees =
      totalFees !== undefined ? parseFloat(totalFees) : tx.totalFees;
    const remainingAmount = parsedTotalFees - (tx.paidAmount || 0);

    // 6. الحفظ النهائي للتعديلات
    const updatedTx = await prisma.privateTransaction.update({
      where: { id },
      data: {
        transactionCode: newTransactionCode,
        createdAt: newCreatedAt,
        category: type || tx.category,
        source: office || tx.source,
        totalFees: parsedTotalFees,
        remainingAmount: remainingAmount < 0 ? 0 : remainingAmount,
        districtId: districtId || tx.districtId,
        notes: currentNotes,
      },
    });

    res.json({
      success: true,
      message: "تم التحديث بنجاح",
      data: updatedTx,
    });
  } catch (error) {
    console.error("Update Transaction Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 تحديث التصدير (Exports)
module.exports = {
  createPrivateTransaction,
  getPrivateTransactions,
  addPrivatePayment,
  deletePrivatePayment, // 👈 جديد
  addTransactionAttachment, // 👈 جديد
  addCollectionDate, // 👈 جديد
  getDashboardStats,
  deletePrivateTransaction,
  toggleFreezeTransaction,
  assignAgentToTransaction,
  assignBrokerToTransaction,
  removeBrokerFromTransaction,
  updateTransactionStatus,
  updatePrivateTransaction,
};

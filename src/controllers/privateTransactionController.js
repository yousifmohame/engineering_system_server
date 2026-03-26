const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ==================================================
// 💡 دالة مراقب الأحداث (Event Logger)
// ==================================================
const logTransactionEvent = async (
  prismaClient,
  transactionId,
  type,
  action,
  details,
  user,
) => {
  try {
    const tx = await prismaClient.privateTransaction.findUnique({
      where: { id: transactionId },
    });
    if (!tx) return;

    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};
    let logs = currentNotes.logs || [];

    // إضافة الحدث الجديد (يتم وضعه في بداية المصفوفة ليكون الأحدث أولاً)
    logs.unshift({
      type,
      action,
      details,
      date: new Date().toISOString(),
      user: user || "موظف النظام",
    });

    currentNotes.logs = logs;

    await prismaClient.privateTransaction.update({
      where: { id: transactionId },
      data: { notes: currentNotes },
    });
  } catch (error) {
    console.error("Logging Error:", error.message);
  }
};

// ==================================================
// دالة توليد رقم المعاملة (سنة-شهر-خمس أرقام)
// ==================================================
const generatePrivateTxCode = async () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
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

  return `${prefix}${String(nextNumber).padStart(5, "0")}`;
};

// ==================================================
// دالة توليد كود العميل تلقائياً
// ==================================================
const generateClientCode = async () => {
  const year = new Date().getFullYear();
  const prefix = `CLT-${year}-`;

  const lastClient = await prisma.client.findFirst({
    where: { clientCode: { startsWith: prefix } },
    orderBy: { clientCode: "desc" },
  });

  let nextNumber = 1;

  if (lastClient && lastClient.clientCode) {
    const parts = lastClient.clientCode.split("-");
    const lastNumber = parseInt(parts[2], 10);
    if (!isNaN(lastNumber)) {
      nextNumber = lastNumber + 1;
    }
  }

  return `${prefix}${String(nextNumber).padStart(3, "0")}`;
};

// ==================================================
// 1. إنشاء معاملة جديدة
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
      clientId,
      ownerName,
      ownerIdNumber,
      ownerMobile,
      clientType,
      districtId,
      sector,
      plots,
      plan,
      oldDeed,
      serviceNo,
      requestNo,
      licenseNo,
      entities,
      receivedAttachmentsList,
      source,
      sourceType,
      sourceName,
      sourcePercent,
      extraNotes,
      totalFees,
      firstPayment,
      mediatorFees,
      agentFees,
      brokerId,
      followUpAgentId,
      stakeholderId,
      receiverId,
      engOfficeBrokerId,
      addedBy,
    } = req.body;

    let finalClientId = clientId;

    if (!finalClientId) {
      if (!ownerName) {
        return res.status(400).json({
          success: false,
          message: "يرجى اختيار المالك أو إدخال اسم المالك الجديد.",
        });
      }
      const clientCode = await generateClientCode();
      const uniqueIdNumber =
        ownerIdNumber && ownerIdNumber.trim() !== ""
          ? ownerIdNumber
          : `TMP-${Date.now()}`;

      const newClient = await prisma.client.create({
        data: {
          clientCode: clientCode,
          mobile: ownerMobile || "بدون رقم",
          idNumber: uniqueIdNumber,
          type: clientType || "فرد سعودي",
          name: { ar: ownerName, en: "", details: {} },
          contact: { mobile: ownerMobile || "بدون رقم", email: "", phone: "" },
          identification: {
            idType: "هوية وطنية / سجل تجاري",
            idNumber: uniqueIdNumber,
          },
          isActive: true,
        },
      });
      finalClientId = newClient.id;
    }

    const transactionCode = await generatePrivateTxCode();
    const parsedTotalFees = totalFees ? parseFloat(totalFees) : 0;
    const parsedFirstPayment = firstPayment ? parseFloat(firstPayment) : 0;

    const txTitle =
      !isInternalNameHidden && internalName
        ? `${internalName} - ${transactionCode}`
        : `${transactionType || "معاملة"} - ${transactionCode}`;

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
          ...(extraNotes && typeof extraNotes === "object" ? extraNotes : {}),
          refs: {
            plots: Array.isArray(plots) ? plots : [],
            plan: plan || null,
            sector: sector || null,
            oldDeed: oldDeed || null,
            serviceNo: serviceNo || null,
            requestNo: requestNo || null,
            licenseNo: licenseNo || null,
            ownerMobile: ownerMobile || null,
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

    // 💡 توثيق إنشاء المعاملة
    await logTransactionEvent(
      prisma,
      newTransaction.id,
      "إنشاء",
      "فتح ملف المعاملة",
      "تم إنشاء المعاملة وفتح الملف الخاص بها في النظام",
      addedBy,
    );

    res.status(201).json({
      success: true,
      message: "تم إنشاء المعاملة بنجاح",
      data: newTransaction,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "خطأ في السيرفر أثناء حفظ المعاملة",
      error: error.message,
    });
  }
};

// ==================================================
// 2. جلب قائمة المعاملات (مع دعم الربط التلقائي للرخص)
// GET /api/private-transactions
// ==================================================
const getPrivateTransactions = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const cursor = req.query.cursor;

    // 💡 1. استقبال متغيرات الربط التلقائي من الفرونت إند
    const { permitNumber, year } = req.query;

    const where = {};

    // 💡 2. هندسة البحث الذكي للربط التلقائي
    if (permitNumber) {
      // بما أن رقم الرخصة محفوظ كـ JSON، نطلب من Prisma البحث في المسارات المحتملة لرقم الرخصة
      where.OR = [
        { notes: { path: ["refs", "licenseNo"], equals: permitNumber } },
        {
          notes: {
            path: ["transactionStatusData", "licenseNumber"],
            equals: permitNumber,
          },
        },
      ];

      // يمكن إضافة الفلترة بالسنة إذا أردت دقة أعلى (عادة رقم الرخصة كافٍ لأنه فريد)
      /*
      if (year) {
        where.AND = [
          { notes: { path: ["transactionStatusData", "hijriYear1"], equals: String(year) } }
        ];
      }
      */
    }

    const transactions = await prisma.privateTransaction.findMany({
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where, // 👈 3. تمرير شروط البحث هنا
      orderBy: { createdAt: "desc" },
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
        client: { select: { name: true } },
        districtNode: {
          select: { name: true, sector: { select: { name: true } } },
        },
        agent: { select: { name: true } },
        brokersList: {
          select: {
            id: true,
            fees: true,
            brokerId: true,
            broker: { select: { name: true } },
          },
        },
        tasks: true,
        payments: true,
        settlements: true,
      },
    });

    const formattedData = transactions.map((tx) => {
      const notes =
        typeof tx.notes === "object" && tx.notes !== null ? tx.notes : {};
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

      let collectionStatus = "غير محصل";
      if (tx.totalFees > 0) {
        if (tx.paidAmount >= tx.totalFees) collectionStatus = "محصل بالكامل";
        else if (tx.paidAmount > 0) collectionStatus = "محصل جزئي";
      }

      const dateObj = new Date(tx.createdAt);
      const formattedDate = `${dateObj.getFullYear()}/${String(dateObj.getMonth() + 1).padStart(2, "0")}/${String(dateObj.getDate()).padStart(2, "0")}`;

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

      return {
        id: tx.id,
        ref: tx.transactionCode,
        internalName: notes?.internalName || "",
        type: tx.category || "غير محدد",
        client: ownerName,
        district: tx.districtNode?.name || "غير محدد",
        sector:
          notes?.refs?.sector || tx.districtNode?.sector?.name || "غير محدد",
        plot: notes?.refs?.plots || "—",
        plan: notes?.refs?.plan || "—",
        office: tx.source || "مكتب ديتيلز",
        sourceName: notes?.sourceName || "مباشر",
        mediator: brokerNames,
        mediatorFees: totalBrokerFees,
        brokers,
        agentCost: notes?.agentFees || 0,
        totalFees: tx.totalFees || 0,
        paidAmount: tx.paidAmount || 0,
        agents: notes?.agents || [],
        remainingAmount:
          tx.remainingAmount || (tx.totalFees || 0) - (tx.paidAmount || 0),
        collectionStatus,
        status: tx.status || "جارية",
        date: formattedDate,
        created: tx.createdAt,
        notes: notes,
        remoteTasks: tx.tasks,
        paymentsList: tx.payments,
        settlements: tx.settlements,
        expenses: notes?.expenses || [],
        logs: notes?.logs || [],
      };
    });

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
    console.error("🔥 Get Transactions Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 3. إضافة تحصيل مالي
// ==================================================
const addPrivatePayment = async (req, res) => {
  try {
    const {
      transactionId,
      amount,
      method,
      paymentMethod,
      ref,
      periodRef,
      date,
      collectedFromType,
      collectedFromId,
      collectedFromOther,
      bankAccountId,
      receiverId,
      notes,
      collectedBy,
    } = req.body;

    const paymentAmount = parseFloat(amount);
    if (!transactionId || isNaN(paymentAmount) || paymentAmount <= 0)
      return res
        .status(400)
        .json({ success: false, message: "بيانات التحصيل غير صحيحة" });

    const transaction = await prisma.privateTransaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction)
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });

    const receiptImage = req.file
      ? `/uploads/payments/${req.file.filename}`
      : null;

    const result = await prisma.$transaction(async (prismaDelegate) => {
      const paymentData = {
        amount: paymentAmount,
        date: date ? new Date(date) : new Date(),
        method: method || paymentMethod || "نقدي",
        periodRef: ref || periodRef || null,
        collectedFromType: collectedFromType || "عميل",
        collectedFromName: collectedFromOther || null,
        notes: notes || "",
        receiptImage: receiptImage,
        collectedBy: collectedBy || "موظف النظام",
        transaction: { connect: { id: transactionId } },
      };

      if (bankAccountId && bankAccountId !== "")
        paymentData.bankAccount = { connect: { id: bankAccountId } };
      if (collectedFromId && collectedFromId !== "")
        paymentData.collectedFrom = { connect: { id: collectedFromId } };
      if (receiverId && receiverId !== "")
        paymentData.receiver = { connect: { id: receiverId } };

      const newPayment = await prismaDelegate.privatePayment.create({
        data: paymentData,
      });
      const newPaidAmount = (transaction.paidAmount || 0) + paymentAmount;
      await prismaDelegate.privateTransaction.update({
        where: { id: transactionId },
        data: {
          paidAmount: newPaidAmount,
          remainingAmount: Math.max(
            0,
            (transaction.totalFees || 0) - newPaidAmount,
          ),
        },
      });

      if (
        (method === "تحويل بنكي" || paymentMethod === "بنكي") &&
        bankAccountId &&
        bankAccountId !== ""
      ) {
        await prismaDelegate.bankAccount.update({
          where: { id: bankAccountId },
          data: { systemBalance: { increment: paymentAmount } },
        });
      }

      await logTransactionEvent(
        prismaDelegate,
        transactionId,
        "ماليات",
        "تحصيل دفعة",
        `تم تحصيل مبلغ ${paymentAmount} ر.س بطريقة: ${method || paymentMethod}`,
        collectedBy,
      );
      return newPayment;
    });

    res
      .status(201)
      .json({ success: true, message: "تم تسجيل الدفعة بنجاح", data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 4. حذف التحصيل
// ==================================================
const deletePrivatePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await prisma.privatePayment.findUnique({ where: { id } });
    if (!payment)
      return res
        .status(404)
        .json({ success: false, message: "الدفعة غير موجودة" });

    await prisma.$transaction(async (prismaDelegate) => {
      await prismaDelegate.privatePayment.delete({ where: { id } });
      if (payment.transactionId) {
        const tx = await prismaDelegate.privateTransaction.findUnique({
          where: { id: payment.transactionId },
        });
        if (tx) {
          const newPaid = Math.max(0, tx.paidAmount - payment.amount);
          await prismaDelegate.privateTransaction.update({
            where: { id: tx.id },
            data: {
              paidAmount: newPaid,
              remainingAmount: tx.totalFees - newPaid,
            },
          });
          await logTransactionEvent(
            prismaDelegate,
            tx.id,
            "ماليات",
            "حذف دفعة",
            `تم حذف دفعة محصلة بقيمة ${payment.amount} ر.س`,
            "مدير النظام",
          );
        }
      }
    });

    res.json({ success: true, message: "تم حذف الدفعة بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 5. رفع مرفقات عامة
// ==================================================
const addTransactionAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرسال ملف" });
    const { description, uploadedBy } = req.body;

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    if (!tx)
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });

    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};
    let attachments = currentNotes.attachments || [];

    attachments.push({
      name: description || req.file.originalname,
      url: `/uploads/receipts/${req.file.filename}`,
      size: req.file.size,
      uploadedBy: uploadedBy || "النظام",
      date: new Date().toISOString(),
    });

    currentNotes.attachments = attachments;
    await prisma.privateTransaction.update({
      where: { id },
      data: { notes: currentNotes },
    });
    await logTransactionEvent(
      prisma,
      id,
      "مرفقات",
      "رفع مستند",
      `تم رفع المرفق: ${description || req.file.originalname}`,
      uploadedBy,
    );

    res.json({ success: true, message: "تم رفع المرفق بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 6. إضافة موعد تحصيل
// ==================================================
const addCollectionDate = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, amount, person, notes, addedBy } = req.body;

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};
    let dates = currentNotes.collectionDates || [];

    dates.push({
      id: Date.now().toString(),
      date,
      amount,
      person,
      notes,
      addedBy: addedBy || "موظف النظام",
      isLate: false,
    });
    currentNotes.collectionDates = dates;

    await prisma.privateTransaction.update({
      where: { id },
      data: { notes: currentNotes },
    });
    await logTransactionEvent(
      prisma,
      id,
      "خطة التحصيل",
      "إضافة موعد",
      `تم إضافة موعد تحصيل بقيمة ${amount} ر.س`,
      addedBy,
    );

    res.json({ success: true, message: "تمت إضافة الموعد" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteCollectionDate = async (req, res) => {
  try {
    const { id, dateId } = req.params;
    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};
    currentNotes.collectionDates = (currentNotes.collectionDates || []).filter(
      (d) => d.id !== dateId,
    );

    await prisma.privateTransaction.update({
      where: { id },
      data: { notes: currentNotes },
    });
    await logTransactionEvent(
      prisma,
      id,
      "خطة التحصيل",
      "حذف موعد",
      `تم إزالة موعد تحصيل من الخطة`,
      "مدير النظام",
    );

    res.json({ success: true, message: "تم حذف الموعد بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 7. إدارة المعقبين
// ==================================================
const assignAgentToTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { agentId, role, fees, addedBy } = req.body;

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    const person = await prisma.person.findUnique({ where: { id: agentId } });

    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};
    let agentsArray = currentNotes.agents || [];

    agentsArray.push({
      id: agentId,
      name: person ? person.name : "معقب",
      role: role || "معقب",
      fees: parseFloat(fees) || 0,
    });
    currentNotes.agents = agentsArray;
    currentNotes.agentFees = agentsArray.reduce((sum, a) => sum + a.fees, 0);

    await prisma.privateTransaction.update({
      where: { id },
      data: { notes: currentNotes },
    });
    await logTransactionEvent(
      prisma,
      id,
      "أطراف المعاملة",
      "تعيين معقب",
      `تم تعيين المعقب: ${person?.name} بمبلغ ${fees}`,
      addedBy,
    );

    res.json({ success: true, message: "تم ربط المعقب بالمعاملة بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 8. إدارة الوسطاء
// ==================================================
const assignBrokerToTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { brokerId, fees, addedBy } = req.body;
    const newBrokerRecord = await prisma.transactionBroker.create({
      data: {
        transactionId: id,
        brokerId: brokerId,
        fees: parseFloat(fees) || 0,
      },
    });
    await logTransactionEvent(
      prisma,
      id,
      "أطراف المعاملة",
      "تعيين وسيط",
      `تم تعيين وسيط للمعاملة بمبلغ ${fees}`,
      addedBy,
    );

    res.json({
      success: true,
      message: "تم تعيين الوسيط بنجاح",
      data: newBrokerRecord,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const removeBrokerFromTransaction = async (req, res) => {
  try {
    const { brokerRecordId } = req.params;
    const { addedBy } = req.body; // 👈 استلام اسم الموظف من الواجهة

    const broker = await prisma.transactionBroker.findUnique({
      where: { id: brokerRecordId },
    });
    await prisma.transactionBroker.delete({ where: { id: brokerRecordId } });

    if (broker) {
      await logTransactionEvent(
        prisma,
        broker.transactionId,
        "أطراف المعاملة",
        "حذف وسيط",
        `تم إزالة وسيط من المعاملة`,
        addedBy,
      );
    }

    res.json({ success: true, message: "تم إزالة الوسيط من المعاملة" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 9. تحديث حالة المعاملة (الاعتماد والملاحظات)
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
      newAuthorityNote,
      addedBy,
      approvalDate,
    } = req.body;

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};
    let authorityHistory = currentNotes.authorityNotesHistory || [];
    let attachments = currentNotes.attachments || [];

    let noteAttachmentPath = null;

    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        if (file.fieldname === "file")
          noteAttachmentPath = `/uploads/status_notes/${file.filename}`;
        else if (file.fieldname === "approvalFiles") {
          let customName = "مرفق اعتماد";
          if (Array.isArray(req.body.approvalNames)) {
            const index = req.files
              .filter((f) => f.fieldname === "approvalFiles")
              .indexOf(file);
            customName = req.body.approvalNames[index] || customName;
          } else if (req.body.approvalNames)
            customName = req.body.approvalNames;

          attachments.push({
            name: customName,
            url: `/uploads/status_notes/${file.filename}`,
            size: file.size,
            uploadedBy: addedBy || "النظام",
            date: new Date().toISOString(),
          });
        }
      });
    }

    if (newAuthorityNote && newAuthorityNote.trim() !== "") {
      authorityHistory.push({
        text: newAuthorityNote,
        addedBy: addedBy || "موظف",
        date: new Date().toISOString(),
        attachment: noteAttachmentPath,
      });
    }

    currentNotes.transactionStatusData = {
      currentStatus: currentStatus || "عند المهندس للدراسة",
      serviceNumber: serviceNumber || "",
      hijriYear1: hijriYear1 || "",
      licenseNumber: licenseNumber || "",
      hijriYear2: hijriYear2 || "",
      oldLicenseNumber: oldLicenseNumber || "",
      noteAttachment: noteAttachmentPath,
      approvalDate:
        approvalDate ||
        currentNotes.transactionStatusData?.approvalDate ||
        null,
    };
    currentNotes.authorityNotesHistory = authorityHistory;
    currentNotes.attachments = attachments;

    await prisma.privateTransaction.update({
      where: { id },
      data: { notes: currentNotes },
    });
    await logTransactionEvent(
      prisma,
      id,
      "حالة المعاملة",
      "تحديث الحالة والمستندات",
      `تم تحديث حالة المعاملة إلى: ${currentStatus}`,
      addedBy,
    );

    res.json({ success: true, message: "تم تحديث حالة المعاملة بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 10. التحديث الجذري للبيانات الأساسية والمالية
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
      notes,
      internalName,
      isInternalNameHidden,
      plots,
      plan,
      area,
      mapsLink,
      updatedBy,
    } = req.body;

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    if (!tx)
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });

    let newTransactionCode = tx.transactionCode;
    let newCreatedAt = tx.createdAt;

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
            nextNumber = parseInt(lastTx.transactionCode.split("-")[2], 10) + 1;
          } catch (e) {}
        }
        newTransactionCode = `${prefix}${String(nextNumber).padStart(5, "0")}`;
        newCreatedAt = new Date(`${year}-${month}-01T10:00:00Z`);
      }
    }

    if (client && tx.clientId) {
      await prisma.client.update({
        where: { id: tx.clientId },
        data: { name: { ar: client, en: "", details: {} } },
      });
    }

    let currentNotes =
      typeof tx.notes === "object" && tx.notes !== null ? tx.notes : {};

    if (notes && notes.attachments !== undefined)
      currentNotes.attachments = notes.attachments;
    if (notes && notes.authorityNotesHistory !== undefined)
      currentNotes.authorityNotesHistory = notes.authorityNotesHistory;
    if (notes && notes.agents !== undefined) currentNotes.agents = notes.agents;
    if (notes && notes.agentFees !== undefined)
      currentNotes.agentFees = notes.agentFees;

    if (!currentNotes.refs) currentNotes.refs = {};
    if (sector !== undefined) currentNotes.refs.sector = sector;
    if (plots !== undefined) currentNotes.refs.plots = plots;
    if (plan !== undefined) currentNotes.refs.plan = plan;
    if (area !== undefined) currentNotes.refs.area = area;
    if (mapsLink !== undefined) currentNotes.refs.mapsLink = mapsLink;

    if (agentCost !== undefined && agentCost !== null)
      currentNotes.agentFees = parseFloat(agentCost) || 0;
    if (mediatorFees !== undefined && mediatorFees !== null)
      currentNotes.mediatorFees = parseFloat(mediatorFees) || 0;
    if (sourceName !== undefined) currentNotes.sourceName = sourceName;

    let newTitle = tx.title;
    if (internalName !== undefined) {
      currentNotes.internalName = internalName;
      currentNotes.isInternalNameHidden = isInternalNameHidden || false;
      newTitle =
        !isInternalNameHidden && internalName
          ? `${internalName} - ${newTransactionCode}`
          : `${type || tx.category || "معاملة"} - ${newTransactionCode}`;
    }

    const parsedTotalFees =
      totalFees !== undefined ? parseFloat(totalFees) : tx.totalFees;
    const remainingAmount = parsedTotalFees - (tx.paidAmount || 0);

    const updatedTx = await prisma.privateTransaction.update({
      where: { id },
      data: {
        transactionCode: newTransactionCode,
        title: newTitle,
        createdAt: newCreatedAt,
        category: type || tx.category,
        source: office || tx.source,
        totalFees: parsedTotalFees,
        remainingAmount: remainingAmount < 0 ? 0 : remainingAmount,
        districtId: districtId || tx.districtId,
        notes: currentNotes,
        status: req.body.status || tx.status, // 👈 للسماح بإغلاق المعاملة (مكتملة) عند التسوية
      },
    });

    await logTransactionEvent(
      prisma,
      id,
      "بيانات أساسية/مالية",
      "تحديث شامل",
      "تم تعديل بعض البيانات الأساسية أو الحسابات المالية للمعاملة",
      updatedBy,
    );

    res.json({ success: true, message: "تم التحديث بنجاح", data: updatedTx });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 11. إضافة مصروف تشغيلي
// ==================================================
const addPrivateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, description, date, addedBy } = req.body;

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    let currentNotes = typeof tx.notes === "object" && tx.notes ? tx.notes : {};
    let expenses = currentNotes.expenses || [];

    expenses.push({
      id: Date.now().toString(),
      amount: parseFloat(amount),
      description,
      date: date ? new Date(date).toISOString() : new Date().toISOString(),
      addedBy: addedBy || "موظف النظام",
    });
    currentNotes.expenses = expenses;

    await prisma.privateTransaction.update({
      where: { id },
      data: { notes: currentNotes },
    });
    await logTransactionEvent(
      prisma,
      id,
      "مصاريف تشغيل",
      "إضافة مصروف",
      `تم إضافة مصروف بقيمة ${amount} لغرض: ${description}`,
      addedBy,
    );

    res.json({ success: true, message: "تم إضافة المصروف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================================================
// 12. تجميد / تنشيط المعاملة
// ==================================================
const toggleFreezeTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    const newStatus = tx.status === "مجمّدة" ? "جارية" : "مجمّدة";
    await prisma.privateTransaction.update({
      where: { id },
      data: { status: newStatus },
    });
    await logTransactionEvent(
      prisma,
      id,
      "حالة المعاملة",
      "تجميد/تنشيط",
      `تم تغيير حالة المعاملة إلى: ${newStatus}`,
      req.body.updatedBy,
    );
    res.json({ success: true, message: `تم التغيير إلى: ${newStatus}` });
  } catch (error) {
    res.status(500).json({ success: false, message: "حدث خطأ" });
  }
};

// ==================================================
// 13. حذف المعاملة بالكامل
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
// 14. جلب إحصائيات لوحة القيادة
// ==================================================
const getDashboardStats = async (req, res) => {
  try {
    const aggregations = await prisma.privateTransaction.aggregate({
      _count: { id: true },
      _sum: { totalFees: true, paidAmount: true },
    });
    const recentTx = await prisma.privateTransaction.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true } } },
    });
    const recentFormatted = recentTx.map((tx) => {
      let clientName = "عميل";
      try {
        clientName =
          typeof tx.client?.name === "string"
            ? JSON.parse(tx.client.name).ar
            : tx.client?.name?.ar;
      } catch {
        clientName = tx.client?.name || "عميل";
      }
      return {
        id: tx.id,
        ref: tx.transactionCode,
        type: tx.category,
        client: clientName,
        value: tx.totalFees,
        status: tx.status === "in_progress" ? "جارية" : "مكتملة",
        date: tx.createdAt.toISOString().split("T")[0],
      };
    });
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
        recentTransactions: recentFormatted,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "فشل جلب الإحصائيات" });
  }
};

module.exports = {
  createPrivateTransaction,
  getPrivateTransactions,
  addPrivatePayment,
  deletePrivatePayment,
  addTransactionAttachment,
  addCollectionDate,
  getDashboardStats,
  deletePrivateTransaction,
  toggleFreezeTransaction,
  assignAgentToTransaction,
  assignBrokerToTransaction,
  removeBrokerFromTransaction,
  updateTransactionStatus,
  updatePrivateTransaction,
  addPrivateExpense,
  deleteCollectionDate,
};

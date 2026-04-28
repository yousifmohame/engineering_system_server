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
// 1. إنشاء معاملة جديدة (Enterprise Grade Edition)
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
      district,
      sector,
      plots,
      plan,
      landArea,
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
      designerOffice,
      supervisorOffice,

      generalNotes,

      // 👇 1. إضافة الحقول الجديدة هنا لاستقبالها من الفرونت إند
      hasAgreement,
      sourcePersonId,
      serviceNumber,
      serviceYear,
      serviceDate,
      requestNumber,
      requestYear,
      requestDate,
      electronicLicenseNumber,
      electronicLicenseHijriYear,
      electronicLicenseDate,
      // 👆 ==================================================
    } = req.body;

    let finalClientId = clientId;

    // 💡 التحقق من العميل الرئيسي وإنشاؤه إن لم يكن موجوداً
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

      const isMultiple = ownerName.includes(" و ");
      const dbClientName = isMultiple
        ? `مُلاّك (${ownerName.substring(0, 15)}...)`
        : ownerName;

      const newClient = await prisma.client.create({
        data: {
          clientCode: clientCode,
          mobile: ownerMobile || "بدون رقم",
          idNumber: uniqueIdNumber.substring(0, 20),
          type: clientType || "فرد سعودي",
          name: {
            ar: dbClientName,
            en: "",
            details: { fullOwnerNames: ownerName },
          },
          contact: { mobile: ownerMobile || "بدون رقم", email: "", phone: "" },
          identification: {
            idType: "هوية وطنية / سجل تجاري",
            idNumber: uniqueIdNumber.substring(0, 20),
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

    const taxData = extraNotes?.taxData || {};

    let fetchedAgentName = "معقب (أساسي)";
    if (followUpAgentId) {
      const agentPerson = await prisma.person.findUnique({
        where: { id: followUpAgentId },
      });
      if (agentPerson) fetchedAgentName = agentPerson.name;
    }

    // 💡 👈 تجهيز قائمة الملاك التفصيلية لإنشائها في الجدول المستقل
    const detailedOwnersList = extraNotes?.detailedOwnersList || [];

    // إذا لم تكن هناك قائمة ملاك مفصلة، نعتمد المالك الرئيسي كمالك وحيد في القائمة
    if (detailedOwnersList.length === 0) {
      detailedOwnersList.push({
        clientId: finalClientId,
        ownerName: ownerName,
        idNumber: ownerIdNumber || null,
        isPrimary: true,
      });
    }

    const newTransaction = await prisma.privateTransaction.create({
      data: {
        transactionCode,
        title: txTitle,
        category: transactionType || "غير محدد",
        complexity: surveyType || "بدون رفع",

        source: source || "مكتب ديتيلز",
        // 👇 2. حفظ مصدر المعاملة المرتبط بجدول الأشخاص
        sourcePersonId: sourcePersonId || undefined,

        status: "in_progress",
        createdBy: addedBy || "مدير النظام",

        clientId: finalClientId,
        clientType: clientType || null,
        ownerNames: ownerName || null,
        ownerIds: ownerIdNumber || null,

        designerOfficeId: designerOffice || undefined,
        supervisorOfficeId: supervisorOffice || undefined,

        // 👇 3. حفظ حالة الاتفاقية
        hasAgreement: hasAgreement || false,

        // 💡 👈 إنشاء الروابط في الجدول الوسيط للملاك
        ownersList: {
          create: detailedOwnersList.map((owner) => ({
            clientId: owner.clientId || finalClientId, // تأكيد وجود ID
            // ownerName: owner.ownerName,
            idNumber: owner.idNumber || null,
            isPrimary: owner.isPrimary || false,
          })),
        },

        districtId: districtId || null,
        districtName: district || null,
        sector: sector || null,
        planNumber: plan || null,
        plots: Array.isArray(plots) ? plots : [],
        landArea: landArea ? parseFloat(landArea) : null,
        oldDeed: oldDeed || null,

        // الحقول القديمة (في حال كان هناك اعتماد عليها)
        serviceNo: serviceNo || null,
        requestNo: requestNo || null,
        licenseNo: licenseNo || null,

        // 👇 4. تخزين الحقول الجديدة المفصلة (الخدمة، الطلب، الرخصة)
        serviceNumber: serviceNumber || null,
        serviceYear: serviceYear || null,
        serviceDate: serviceDate ? new Date(serviceDate) : null,

        requestNumber: requestNumber || null,
        requestYear: requestYear || null,
        requestDate: requestDate ? new Date(requestDate) : null,

        electronicLicenseNumber: electronicLicenseNumber || null,
        electronicLicenseHijriYear: electronicLicenseHijriYear || null,
        electronicLicenseDate: electronicLicenseDate
          ? new Date(electronicLicenseDate)
          : null,
        // 👆 =========================================================

        totalFees: parsedTotalFees,
        paidAmount: parsedFirstPayment,
        remainingAmount: parsedTotalFees - parsedFirstPayment,
        firstPayment: parsedFirstPayment,
        feeType: feeType || "نهائي",

        taxType: taxData.taxType || "بدون احتساب ضريبة",
        netAmount: taxData.netAmount
          ? parseFloat(taxData.netAmount)
          : parsedTotalFees,
        taxAmount: taxData.taxAmount ? parseFloat(taxData.taxAmount) : 0,

        sourceType: sourceType || "مباشر",
        sourceName: sourceName || null,
        sourcePercent: sourcePercent ? parseFloat(sourcePercent) : 0,

        authorities: Array.isArray(entities) ? entities : [],
        attachments: Array.isArray(receivedAttachmentsList)
          ? receivedAttachmentsList
          : [],

        brokerId: brokerId || null,
        agentId: followUpAgentId || null,
        stakeholderId: stakeholderId || null,
        receiverId: receiverId || null,
        engOfficeBrokerId: engOfficeBrokerId || null,

        brokersList: brokerId
          ? {
              create: [
                {
                  brokerId: brokerId,
                  fees: mediatorFees ? parseFloat(mediatorFees) : 0,
                },
              ],
            }
          : undefined,

        notes: {
          internalName: internalName || null,
          isInternalNameHidden: isInternalNameHidden || false,
          ownerMobile: ownerMobile || null,
          mediatorFees: mediatorFees ? parseFloat(mediatorFees) : 0,
          agentFees: agentFees ? parseFloat(agentFees) : 0,
          transactionComments: extraNotes?.transactionComments || [],
          generalNotes: generalNotes || null,
          generalNotesUpdatedBy: generalNotes ? addedBy || "مدير النظام" : null,
          generalNotesUpdatedAt: generalNotes ? new Date() : null,

          agents: followUpAgentId
            ? [
                {
                  id: followUpAgentId,
                  name: fetchedAgentName,
                  role: "مراجعة وتعقيب",
                  fees: agentFees ? parseFloat(agentFees) : 0,
                },
              ]
            : [],

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
    console.error("Create Tx Error:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في السيرفر أثناء حفظ المعاملة",
      error: error.message,
    });
  }
};

// ==================================================
// 3. جلب قائمة المعاملات (مع دعم الربط التلقائي للرخص والبيانات الشاملة)
// GET /api/private-transactions
// ==================================================
const getPrivateTransactions = async (req, res) => {
  try {
    const { permitNumber, year } = req.query;

    const where = {};

    if (permitNumber) {
      where.OR = [
        { licenseNo: permitNumber },
        { requestNo: permitNumber },
        { notes: { path: ["refs", "licenseNo"], equals: permitNumber } },
        {
          notes: {
            path: ["transactionStatusData", "licenseNumber"],
            equals: permitNumber,
          },
        },
      ];
    }

    const transactions = await prisma.privateTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        transactionCode: true,
        title: true,
        category: true,
        source: true,
        status: true,
        totalFees: true,
        paidAmount: true,
        remainingAmount: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
        notes: true,
        serviceNo: true,
        requestNo: true,
        licenseNo: true,
        oldDeed: true,

        designerOfficeId: true,
        supervisorOfficeId: true,
        hasAgreement: true, // 💡 حقل الاتفاقية

        electronicLicenseNumber: true,
        electronicLicenseHijriYear: true,
        electronicLicenseDate: true,
        oldLicenseNumber: true,
        oldLicenseHijriYear: true,
        oldLicenseDate: true,

        // 💡 التواريخ الجديدة للطلب والخدمة
        requestNumber: true,
        requestYear: true,
        requestDate: true,
        serviceNumber: true,
        serviceYear: true,
        serviceDate: true,

        responsibleEmployee: true,
        surveyRequestNumber: true,
        surveyRequestYear: true,
        surveyServiceNumber: true,
        surveyServiceYear: true,
        surveyReportNumber: true,
        surveyReportDate: true,
        contractNumber: true,
        contractApprovalDate: true,
        contractApprovedBy: true,

        ownerNames: true,
        districtName: true,
        sector: true,
        planNumber: true,
        plots: true,
        landArea: true,
        taxType: true,
        netAmount: true,
        taxAmount: true,
        sourceName: true,

        isOnAxis: true,
        streetName: true,
        officialMapLink: true,

        // 💡 مصدر المعاملة المرتبط بجدول الموظفين
        sourcePerson: {
          select: { id: true, name: true, role: true },
        },

        ownersList: {
          select: {
            isPrimary: true,
            client: {
              select: {
                id: true,
                name: true,
                idNumber: true,
              },
            },
          },
        },

        client: {
          select: {
            id: true,
            name: true,
            mobile: true,
            contact: true,
            idNumber: true,
            type: true,
            grade: true,
            identification: true,
            _count: { select: { transactions: true } },
          },
        },
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
        files: { select: { size: true } },
      },
    });

    const formattedData = transactions.map((tx) => {
      const totalSize =
        tx.files && tx.files.length > 0
          ? tx.files.reduce((sum, file) => sum + (file.size || 0), 0)
          : 0;
      const notes =
        typeof tx.notes === "object" && tx.notes !== null ? tx.notes : {};

      const sortedOwners =
        tx.ownersList?.sort(
          (a, b) => (b.isPrimary ? 1 : -1) - (a.isPrimary ? 1 : -1),
        ) || [];

      let finalDetailedOwners = [];
      let displayNames = [];

      if (sortedOwners.length > 0) {
        finalDetailedOwners = sortedOwners.map((o) => {
          let cName = "غير محدد";
          if (o.client?.name) {
            cName =
              typeof o.client.name === "string"
                ? o.client.name
                : o.client.name.ar || "غير محدد";
          }
          displayNames.push(cName);
          return {
            clientId: o.client.id,
            ownerName: cName,
            idNumber: o.client.idNumber,
            isPrimary: o.isPrimary,
          };
        });
      } else {
        let cName =
          typeof tx.client?.name === "string"
            ? tx.client?.name
            : tx.client?.name?.ar || tx.ownerNames || "غير محدد";
        displayNames.push(cName);
        finalDetailedOwners = [
          { clientId: tx.client?.id, ownerName: cName, isPrimary: true },
        ];
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

      const clientPhone =
        tx.client?.mobile ||
        tx.client?.contact?.mobile ||
        notes?.ownerMobile ||
        "—";

      return {
        phone: clientPhone,
        updatedAt: tx.updatedAt,
        createdAt: tx.createdAt,
        createdBy: tx.createdBy,
        id: tx.id,
        ref: tx.transactionCode,
        internalName: notes?.internalName || tx.title?.split(" - ")[0] || "",
        type: tx.category || "غير محدد",

        client: displayNames.join(" و ") || "غير محدد",
        clientObj: tx.client,
        detailedOwnersList: finalDetailedOwners,

        // 💡 تحديث object الـ requestData ليتضمن التواريخ الجديدة والاتفاقية
        requestData: {
          designerOffice: tx.designerOfficeId || "",
          supervisorOffice: tx.supervisorOfficeId || "",
          hasAgreement: tx.hasAgreement || false, // 👈

          electronicLicenseNumber: tx.electronicLicenseNumber || "",
          electronicLicenseHijriYear: tx.electronicLicenseHijriYear || "",
          electronicLicenseDate: tx.electronicLicenseDate || "",

          oldLicenseNumber: tx.oldLicenseNumber || "",
          oldLicenseHijriYear: tx.oldLicenseHijriYear || "",
          oldLicenseDate: tx.oldLicenseDate || "",

          requestNumber: tx.requestNumber || "",
          requestYear: tx.requestYear || "",
          requestDate: tx.requestDate || "", // 👈

          serviceNumber: tx.serviceNumber || "",
          serviceYear: tx.serviceYear || "",
          serviceDate: tx.serviceDate || "", // 👈

          responsibleEmployee: tx.responsibleEmployee || "",
          surveyRequestNumber: tx.surveyRequestNumber || "",
          surveyRequestYear: tx.surveyRequestYear || "",
          surveyServiceNumber: tx.surveyServiceNumber || "",
          surveyServiceYear: tx.surveyServiceYear || "",
          surveyReportNumber: tx.surveyReportNumber || "",
          surveyReportDate: tx.surveyReportDate || "",
          contractNumber: tx.contractNumber || "",
          contractApprovalDate: tx.contractApprovalDate || "",
          contractApprovedBy: tx.contractApprovedBy || "",
        },

        district:
          tx.districtName ||
          notes?.refs?.districtName ||
          tx.districtNode?.name ||
          "غير محدد",
        sector:
          tx.sector ||
          notes?.refs?.sector ||
          tx.districtNode?.sector?.name ||
          "غير محدد",

        plots:
          Array.isArray(tx.plots) && tx.plots.length > 0
            ? tx.plots.join(" ، ")
            : notes?.refs?.plots || "",

        plan: tx.planNumber || notes?.refs?.plan || "",

        landArea:
          tx.landArea || notes?.refs?.landArea || notes?.refs?.area || 0,

        mapsLink: notes?.refs?.mapsLink || "",

        // 💡 تحديث مصدر المعاملة ليأخذ الاسم من الجدول المرتبط إذا وجد
        office: tx.sourcePerson?.name || tx.source || "مكتب ديتيلز",
        sourcePersonId: tx.sourcePerson?.id || null, // 👈

        sourceName: tx.sourceName || notes?.sourceName || "مباشر",
        mediator: brokerNames,
        mediatorFees: totalBrokerFees,
        serviceNo: tx.serviceNo,
        requestNo: tx.requestNo,
        licenseNo: tx.licenseNo,
        oldDeed: tx.oldDeed,
        brokers,
        agentCost: notes?.agentFees || 0,
        totalFees: tx.totalFees || 0,

        taxData: tx.taxType
          ? {
              taxType: tx.taxType,
              netAmount: tx.netAmount,
              taxAmount: tx.taxAmount,
            }
          : notes?.taxData || null,

        paidAmount: tx.paidAmount || 0,
        agents: notes?.agents || [],
        remainingAmount:
          tx.remainingAmount || (tx.totalFees || 0) - (tx.paidAmount || 0),
        collectionStatus,
        totalSize: totalSize,
        status: tx.status || "جارية",
        date: formattedDate,
        created: tx.createdAt,
        notes: notes,
        remoteTasks: tx.tasks,
        paymentsList: tx.payments,
        settlements: tx.settlements,
        expenses: notes?.expenses || [],
        logs: notes?.logs || [],
        isOnAxis: tx.isOnAxis || notes?.refs?.isOnAxis || "لا",
        streetName: tx.streetName || notes?.refs?.streetName || "",
        officialMapLink: tx.officialMapLink || notes?.refs?.officialMapLink || "",
      };
    });

    res.json({
      success: true,
      count: formattedData.length,
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
// 2. تحديث معاملة (تحديث شامل وقوي)
// PUT /api/private-transactions/:id
// ==================================================
const updatePrivateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    // 👇🔥 هذا هو الكود السحري الذي سيحل مشكلة عدم الحفظ 🔥👇
    // فك تشفير البيانات التي تصل كنصوص (Strings) بسبب الـ FormData
    if (typeof data.notes === "string") {
      try {
        data.notes = JSON.parse(data.notes);
      } catch (e) {}
    }
    if (typeof data.requestData === "string") {
      try {
        data.requestData = JSON.parse(data.requestData);
      } catch (e) {}
    }
    if (typeof data.detailedOwnersList === "string") {
      try {
        data.detailedOwnersList = JSON.parse(data.detailedOwnersList);
      } catch (e) {}
    }
    if (typeof data.plots === "string" && data.plots.startsWith("[")) {
      try {
        data.plots = JSON.parse(data.plots);
      } catch (e) {}
    }
    // 👆 ==================================================== 👆

    // 1. جلب المعاملة الأصلية للتحقق
    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    if (!tx) {
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });
    }

    let newTransactionCode = tx.transactionCode;
    let newCreatedAt = tx.createdAt;

    // 2. معالجة السنة والشهر (تحديث الكود إذا تغير التاريخ)
    if (data.year && data.month) {
      const currentYear = tx.createdAt.getFullYear().toString();
      const currentMonth = (tx.createdAt.getMonth() + 1)
        .toString()
        .padStart(2, "0");

      if (data.year !== currentYear || data.month !== currentMonth) {
        const prefix = `${data.year}-${data.month}-`;
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
        newCreatedAt = new Date(`${data.year}-${data.month}-01T10:00:00Z`);
      }
    }

    // 3. تحديث اسم العميل في جدول العملاء إذا تم تمريره
    if (data.client && tx.clientId) {
      await prisma.client.update({
        where: { id: tx.clientId },
        data: { name: { ar: data.client, en: "", details: {} } },
      });
    }

    // 4. معالجة الـ JSON Notes (الأهم في الكود)
    // هنا يجب ألا نفقد الملاحظات القديمة!
    let currentNotes =
      typeof tx.notes === "object" && tx.notes !== null ? { ...tx.notes } : {};

    // تحديث خصائص Notes فقط إذا تم إرسالها من الواجهة
    if (data.notes) {
      if (data.notes.transactionComments !== undefined)
        currentNotes.transactionComments = data.notes.transactionComments;
      if (data.notes.attachments !== undefined)
        currentNotes.attachments = data.notes.attachments;
      if (data.notes.authorityNotesHistory !== undefined)
        currentNotes.authorityNotesHistory = data.notes.authorityNotesHistory;
      if (data.notes.agents !== undefined)
        currentNotes.agents = data.notes.agents;
      if (data.notes.agentFees !== undefined)
        currentNotes.agentFees = data.notes.agentFees;
      if (data.notes.expenses !== undefined)
        currentNotes.expenses = data.notes.expenses; // 👈 مهم جداً لتاب المصاريف
      if (data.notes.logs !== undefined) currentNotes.logs = data.notes.logs;
      if (data.notes.collectionDates !== undefined)
        currentNotes.collectionDates = data.notes.collectionDates;
    }

    if (!currentNotes.refs) currentNotes.refs = {};
    if (data.mapsLink !== undefined) currentNotes.refs.mapsLink = data.mapsLink;

    // 5. تجهيز الكائن الأساسي للتحديث
    const dataToUpdate = {
      updatedAt: new Date(),
      createdAt: newCreatedAt,
      transactionCode: newTransactionCode,
    };

    // التحديث المشروط للحقول الأساسية (لا نُحدث الحقل إلا إذا كان موجوداً في الـ Request)
    if (data.type !== undefined) dataToUpdate.category = data.type;
    if (data.office !== undefined) dataToUpdate.source = data.office;
    if (data.status !== undefined) dataToUpdate.status = data.status; // 👈 التحديث السليم للحالة
    if (data.ownerNames !== undefined)
      dataToUpdate.ownerNames = data.ownerNames;
    if (data.area !== undefined)
      dataToUpdate.landArea = parseFloat(data.area) || 0;
    if (data.plan !== undefined) dataToUpdate.planNumber = data.plan;
    if (data.sector !== undefined) dataToUpdate.sector = data.sector;
    if (data.sourceName !== undefined)
      dataToUpdate.sourceName = data.sourceName;
    if (data.isOnAxis !== undefined) dataToUpdate.isOnAxis = data.isOnAxis;
    if (data.streetName !== undefined)
      dataToUpdate.streetName = data.streetName;
    if (data.officialMapLink !== undefined)
      dataToUpdate.officialMapLink = data.officialMapLink;
    if (data.supervisingOfficeId !== undefined)
      dataToUpdate.supervisorOfficeId = data.supervisingOfficeId;
    if (data.designingOfficeId !== undefined)
      dataToUpdate.designerOfficeId = data.designingOfficeId;

    // 6. الربط الذكي بالأحياء (التصحيح هنا)
    if (data.districtId) {
      dataToUpdate.districtNode = { connect: { id: data.districtId } };
      // 👈 السطر التالي كان مفقوداً، وهو يضمن مسح الاسم القديم واستبداله بالجديد
      dataToUpdate.districtName = data.district || data.districtName;
    } else if (data.district !== undefined) {
      dataToUpdate.districtName = data.district;
    }

    // 7. معالجة البلوكات والمخططات
    if (data.plots !== undefined) {
      if (typeof data.plots === "string") {
        dataToUpdate.plots = data.plots
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (Array.isArray(data.plots)) {
        dataToUpdate.plots = data.plots;
      }
    }

    // 8. الملاحظات العامة
    if (data.generalNotes !== undefined) {
      currentNotes.generalNotes = data.generalNotes;
      currentNotes.generalNotesUpdatedBy = data.updatedBy || "موظف النظام";
      currentNotes.generalNotesUpdatedAt = new Date();
    }

    // 9. بيانات الطلب (Request Data)
    if (data.requestData) {
      if (data.requestData.designerOffice !== undefined)
        dataToUpdate.designerOfficeId = data.requestData.designerOffice || null;
      if (data.requestData.supervisorOffice !== undefined)
        dataToUpdate.supervisorOfficeId =
          data.requestData.supervisorOffice || null;
      if (data.requestData.hasAgreement !== undefined)
        dataToUpdate.hasAgreement = data.requestData.hasAgreement;
      if (data.requestData.sourcePersonId !== undefined)
        dataToUpdate.sourcePersonId = data.requestData.sourcePersonId || null;

      if (data.requestData.electronicLicenseNumber !== undefined)
        dataToUpdate.electronicLicenseNumber =
          data.requestData.electronicLicenseNumber || null;
      if (data.requestData.electronicLicenseHijriYear !== undefined)
        dataToUpdate.electronicLicenseHijriYear =
          data.requestData.electronicLicenseHijriYear || null;
      if (data.requestData.electronicLicenseDate !== undefined)
        dataToUpdate.electronicLicenseDate = data.requestData
          .electronicLicenseDate
          ? new Date(data.requestData.electronicLicenseDate)
          : null;

      if (data.requestData.oldLicenseNumber !== undefined)
        dataToUpdate.oldLicenseNumber =
          data.requestData.oldLicenseNumber || null;
      if (data.requestData.oldLicenseHijriYear !== undefined)
        dataToUpdate.oldLicenseHijriYear =
          data.requestData.oldLicenseHijriYear || null;
      if (data.requestData.oldLicenseDate !== undefined)
        dataToUpdate.oldLicenseDate = data.requestData.oldLicenseDate
          ? new Date(data.requestData.oldLicenseDate)
          : null;

      if (data.requestData.requestNumber !== undefined)
        dataToUpdate.requestNumber = data.requestData.requestNumber || null;
      if (data.requestData.requestYear !== undefined)
        dataToUpdate.requestYear = data.requestData.requestYear || null;
      if (data.requestData.requestDate !== undefined)
        dataToUpdate.requestDate = data.requestData.requestDate
          ? new Date(data.requestData.requestDate)
          : null;

      if (data.requestData.serviceNumber !== undefined)
        dataToUpdate.serviceNumber = data.requestData.serviceNumber || null;
      if (data.requestData.serviceYear !== undefined)
        dataToUpdate.serviceYear = data.requestData.serviceYear || null;
      if (data.requestData.serviceDate !== undefined)
        dataToUpdate.serviceDate = data.requestData.serviceDate
          ? new Date(data.requestData.serviceDate)
          : null;

      if (data.requestData.responsibleEmployee !== undefined)
        dataToUpdate.responsibleEmployee =
          data.requestData.responsibleEmployee || null;
      if (data.requestData.surveyRequestNumber !== undefined)
        dataToUpdate.surveyRequestNumber =
          data.requestData.surveyRequestNumber || null;
      if (data.requestData.surveyRequestYear !== undefined)
        dataToUpdate.surveyRequestYear =
          data.requestData.surveyRequestYear || null;
      if (data.requestData.surveyServiceNumber !== undefined)
        dataToUpdate.surveyServiceNumber =
          data.requestData.surveyServiceNumber || null;
      if (data.requestData.surveyServiceYear !== undefined)
        dataToUpdate.surveyServiceYear =
          data.requestData.surveyServiceYear || null;
      if (data.requestData.surveyReportNumber !== undefined)
        dataToUpdate.surveyReportNumber =
          data.requestData.surveyReportNumber || null;
      if (data.requestData.surveyReportDate !== undefined)
        dataToUpdate.surveyReportDate = data.requestData.surveyReportDate
          ? new Date(data.requestData.surveyReportDate)
          : null;

      if (data.requestData.contractNumber !== undefined)
        dataToUpdate.contractNumber = data.requestData.contractNumber || null;
      if (data.requestData.contractApprovalDate !== undefined)
        dataToUpdate.contractApprovalDate = data.requestData
          .contractApprovalDate
          ? new Date(data.requestData.contractApprovalDate)
          : null;
      if (data.requestData.contractApprovedBy !== undefined)
        dataToUpdate.contractApprovedBy =
          data.requestData.contractApprovedBy || null;
    }

    // 10. معالجة الصور المرفوعة مباشرة
    if (req.files) {
      if (req.files.newSiteImage && req.files.newSiteImage[0]) {
        dataToUpdate.siteImage = `/uploads/transactions/${req.files.newSiteImage[0].filename}`;
      }
      if (req.files.generalNotesFile && req.files.generalNotesFile[0]) {
        dataToUpdate.generalNotesFileUrl = `/uploads/transactions/${req.files.generalNotesFile[0].filename}`;
      }
    }

    // 11. تحديث الأمور المالية
    if (data.totalFees !== undefined) {
      dataToUpdate.totalFees = parseFloat(data.totalFees) || 0;
      dataToUpdate.remainingAmount = Math.max(
        0,
        dataToUpdate.totalFees - (tx.paidAmount || 0),
      );
    }

    // إذا كان هناك تعديل للضرائب
    if (data.taxType !== undefined || data.taxData !== undefined) {
      dataToUpdate.taxType =
        data.taxType || data.taxData?.taxType || tx.taxType;
      dataToUpdate.taxAmount = parseFloat(
        data.taxAmount || data.taxData?.taxAmount || tx.taxAmount || 0,
      );
      dataToUpdate.netAmount = parseFloat(
        data.netAmount || data.taxData?.netAmount || tx.netAmount || 0,
      );
    }

    // 12. تحديث اسم المعاملة الداخلي (الاسم الشائع)
    if (data.internalName !== undefined) {
      currentNotes.internalName = data.internalName;
      currentNotes.isInternalNameHidden =
        data.isInternalNameHidden === "true" ||
        data.isInternalNameHidden === true;
      const typeLabel = data.type || tx.category || "معاملة";
      dataToUpdate.title =
        !currentNotes.isInternalNameHidden && data.internalName
          ? `${data.internalName} - ${newTransactionCode}`
          : `${typeLabel} - ${newTransactionCode}`;
    }

    // 13. قائمة الملاك المعقدة
    const detailedOwnersList =
      data.notes?.detailedOwnersList || data.detailedOwnersList;
    if (detailedOwnersList !== undefined && Array.isArray(detailedOwnersList)) {
      dataToUpdate.ownersList = {
        deleteMany: {},
        create: detailedOwnersList
          .filter((o) => o.clientId)
          .map((owner) => ({
            clientId: owner.clientId,
            idNumber: owner.idNumber || null,
            isPrimary: owner.isPrimary || false,
          })),
      };

      const primaryOwner =
        detailedOwnersList.find((o) => o.isPrimary) || detailedOwnersList[0];
      if (primaryOwner && primaryOwner.clientId) {
        dataToUpdate.clientId = primaryOwner.clientId;
      }
    }

    // الدمج النهائي للـ JSON
    dataToUpdate.notes = currentNotes;

    // التنفيذ في قاعدة البيانات
    const updatedTx = await prisma.privateTransaction.update({
      where: { id },
      data: dataToUpdate,
    });

    await logTransactionEvent(
      prisma,
      id,
      "تحديث النظام",
      "تعديل معاملة",
      "تم تعديل بيانات المعاملة أو ملفاتها من خلال النظام",
      data.updatedBy || req.user?.id,
    );

    res.json({ success: true, message: "تم التحديث بنجاح", data: updatedTx });
  } catch (error) {
    console.error("Update Transaction Error:", error);
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
// ==================================================
// 15. إسناد وتعديل مهمة لموظف (تتعامل مباشرة مع TransactionTask)
// ==================================================
const assignTask = async (req, res) => {
  try {
    const { id } = req.params; // Transaction ID
    // 💡 نستقبل taskId لمعرفة هل هو تعديل أم إنشاء جديد
    const {
      taskId,
      assigneeId,
      description,
      deadline,
      isUrgent,
      taskName,
      cost,
      addedBy,
    } = req.body;

    if (!assigneeId || !description || !deadline) {
      return res
        .status(400)
        .json({ success: false, message: "يرجى إكمال بيانات المهمة الأساسية" });
    }

    // جلب اسم الموظف لتوثيقه في السجل
    const worker = await prisma.person.findUnique({
      where: { id: assigneeId },
    });
    if (!worker)
      return res
        .status(404)
        .json({ success: false, message: "الموظف غير موجود" });

    let savedTask;

    if (taskId) {
      // 💡 1. وضع التعديل (Update)
      savedTask = await prisma.transactionTask.update({
        where: { id: taskId },
        data: {
          workerId: assigneeId,
          description: description,
          deadline: new Date(deadline),
          isUrgent: isUrgent || false,
        },
      });

      await logTransactionEvent(
        prisma,
        id,
        "إدارة المهام",
        "تعديل مهمة",
        `تم تعديل بيانات المهمة المسندة للموظف ${worker.name}`,
        addedBy || "مدير النظام",
      );
    } else {
      // 💡 2. وضع الإنشاء (Create)
      savedTask = await prisma.transactionTask.create({
        data: {
          transactionId: id,
          workerId: assigneeId,
          taskName: taskName || description.substring(0, 20) + "...",
          description: description,
          deadline: new Date(deadline),
          isUrgent: isUrgent || false,
          cost: parseFloat(cost) || 0,
          assignedBy: addedBy || "مدير النظام",
          isCompleted: false,
        },
      });

      await logTransactionEvent(
        prisma,
        id,
        "إدارة المهام",
        "إسناد مهمة",
        `تم إسناد مهمة للموظف ${worker.name} بتفاصيل: ${description.substring(0, 50)}...`,
        addedBy || "مدير النظام",
      );
    }

    res.status(200).json({
      success: true,
      message: taskId ? "تم تعديل المهمة بنجاح" : "تم إسناد المهمة بنجاح",
      data: savedTask,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حفظ المهمة",
      error: error.message,
    });
  }
};

// ==================================================
// 17. حذف المهمة من قِبل المشرف
// ==================================================
const deleteTask = async (req, res) => {
  try {
    const { id, taskId } = req.params; // Transaction ID & Task ID
    const { deletedBy } = req.body;

    const task = await prisma.transactionTask.findUnique({
      where: { id: taskId },
    });
    if (!task)
      return res.status(404).json({
        success: false,
        message: "المهمة غير موجودة أو تم حذفها مسبقاً",
      });

    // حذف المهمة من الجدول
    await prisma.transactionTask.delete({ where: { id: taskId } });

    // توثيق الحذف
    await logTransactionEvent(
      prisma,
      id,
      "إدارة المهام",
      "حذف مهمة",
      `تم إلغاء وحذف المهمة التي كانت بوصف: ${task.description.substring(0, 30)}...`,
      deletedBy || "مدير النظام",
    );

    res.status(200).json({ success: true, message: "تم حذف المهمة بنجاح" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف المهمة",
      error: error.message,
    });
  }
};
// ==================================================
// 16. تسليم المهمة بواسطة الموظف
// ==================================================
const submitTask = async (req, res) => {
  try {
    const { id, taskId } = req.params; // Transaction ID & Task ID
    const { comment, submittedBy } = req.body;

    // 💡 قراءة مسار الملف المرفق (إن وجد)
    let fileUrl = null;
    if (req.file) {
      fileUrl = `/uploads/tasks/${req.file.filename}`;
    }

    // 💡 تحديث حالة المهمة في جدول TransactionTask
    const updatedTask = await prisma.transactionTask.update({
      where: { id: taskId },
      data: {
        isCompleted: true,
        submitComment: comment || "",
        submitFileUrl: fileUrl,
        submittedAt: new Date(),
      },
    });

    // 💡 توثيق التسليم في السجل
    await logTransactionEvent(
      prisma,
      id,
      "إدارة المهام",
      "تسليم مهمة",
      `تم تسليم المهمة الموكلة بتعليق: ${comment ? comment.substring(0, 30) + "..." : "بدون تعليق"}`,
      submittedBy || "الموظف",
    );

    res.status(200).json({
      success: true,
      message: "تم تسليم المهمة بنجاح",
      data: updatedTask,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تسليم المهمة",
      error: error.message,
    });
  }
};

// ... (في نفس الملف privateTransactionController.js، تأكد من وجود دالة توليد السريال أو قم بإضافتها في الأعلى)
const generateSmartSerial = async (modelName, prefix) => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));

  const countToday = await prisma[modelName].count({
    where: { createdAt: { gte: startOfDay, lte: endOfDay } },
  });

  const sequence = String(countToday + 1).padStart(3, "0");
  return `${prefix}-${dateStr}-${sequence}`;
};

// --------------------------------------------------

const addAuthorityNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { note, addedBy, assignedTo } = req.body;

    let attachmentUrl = null;
    if (req.file) {
      attachmentUrl = `../../uploads/transactions/${req.file.filename}`;
    }

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    if (!tx)
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });

    const currentNotes =
      typeof tx.notes === "object" && tx.notes !== null ? tx.notes : {};
    const history = currentNotes.authorityNotesHistory || [];

    history.push({
      id: Date.now().toString(),
      note,
      addedBy: addedBy || "مستخدم النظام",
      assignedTo: assignedTo || null,
      date: new Date().toISOString(),
      attachment: attachmentUrl,
    });

    const updatedTx = await prisma.privateTransaction.update({
      where: { id },
      data: { notes: { ...currentNotes, authorityNotesHistory: history } },
    });

    // 🚀 إصلاح إنشاء المهمة التلقائية
    if (assignedTo) {
      try {
        // توليد سريال للمهمة
        const serial = await generateSmartSerial("officeTask", "T");

        await prisma.officeTask.create({
          data: {
            serialNumber: serial,
            title: `إفادة بلدي - ${tx.transactionCode || "معاملة"}`, // حقل الـ Title الذي أضفناه سابقاً
            description: `توجيه من (${addedBy || "النظام"}):\n\n${note}`,
            priority: "high",
            status: "active",
            creatorName: addedBy || "نظام التوجيه الآلي",
            transactionId: id,
            // تخزين الموظف كـ JSON string كما يتطلب الموديل لديك
            assignedEmployees: JSON.stringify([
              { id: "auto", name: assignedTo },
            ]),
          },
        });
      } catch (taskError) {
        console.error("خطأ غير حرج: فشل إنشاء مهمة من التوجيه", taskError);
        // لا نوقف العملية إذا فشلت المهمة، فالملاحظة تم حفظها بالفعل
      }
    }

    res.json({ success: true, message: "تم إضافة الملاحظة", data: updatedTx });
  } catch (error) {
    console.error("Add Authority Note Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🚀 تحديث ملاحظة موجودة
const updateAuthorityNote = async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const { note, assignedTo } = req.body;

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    if (!tx)
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });

    const currentNotes = tx.notes || {};
    const history = currentNotes.authorityNotesHistory || [];

    const noteIndex = history.findIndex((n) => n.id === noteId);
    if (noteIndex === -1)
      return res
        .status(404)
        .json({ success: false, message: "الملاحظة غير موجودة" });

    // تحديث النص والتوجيه
    history[noteIndex].note = note;
    if (assignedTo !== undefined) history[noteIndex].assignedTo = assignedTo;

    // إذا كان هناك ملف جديد، استبدل القديم
    if (req.file) {
      history[noteIndex].attachment =
        `/uploads/transactions/${req.file.filename}`;
    }

    const updatedTx = await prisma.privateTransaction.update({
      where: { id },
      data: { notes: { ...currentNotes, authorityNotesHistory: history } },
    });

    res.json({ success: true, message: "تم التحديث بنجاح", data: updatedTx });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🚀 حذف ملاحظة
const deleteAuthorityNote = async (req, res) => {
  try {
    const { id, noteId } = req.params;

    const tx = await prisma.privateTransaction.findUnique({ where: { id } });
    if (!tx)
      return res
        .status(404)
        .json({ success: false, message: "المعاملة غير موجودة" });

    const currentNotes = tx.notes || {};
    let history = currentNotes.authorityNotesHistory || [];

    // فلترة الملاحظة لحذفها
    history = history.filter((n) => n.id !== noteId);

    const updatedTx = await prisma.privateTransaction.update({
      where: { id },
      data: { notes: { ...currentNotes, authorityNotesHistory: history } },
    });

    res.json({ success: true, message: "تم الحذف بنجاح", data: updatedTx });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
  assignTask,
  submitTask,
  deleteTask,
  addAuthorityNote,
  updateAuthorityNote,
  deleteAuthorityNote,
};

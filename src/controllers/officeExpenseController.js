const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 1. جلب جميع المصروفات
const getExpenses = async (req, res) => {
  try {
    const expenses = await prisma.officeExpense.findMany({
      orderBy: { expenseDate: "desc" },
      include: {
        payer: { select: { name: true, id: true } },
        payee: { select: { name: true, id: true } },
      },
    });

    const formattedData = expenses.map((exp) => ({
      id: exp.id,
      item: exp.item,
      amount: exp.amount,
      payer: exp.payer?.name || exp.payerName || "الشركة",
      payerId: exp.payer?.id || "",
      method: exp.method,
      source: exp.source,
      date: exp.expenseDate ? exp.expenseDate.toISOString().split("T")[0] : "",
      notes: exp.notes || "—",
      payee: exp.payee?.name || exp.payeeName || "—",
      payeeId: exp.payee?.id || "",
      hasAttachment: !!exp.attachmentUrl,
      attachmentUrl: exp.attachmentUrl,
      isClearable: exp.isClearable,
      linkToSettlement: exp.linkToSettlement,
      isSettled: exp.linkToSettlement === true,
    }));

    res.json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Get Expenses Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. تسجيل مصروف جديد
const createExpense = async (req, res) => {
  try {
    const data = req.body;
    let attachmentPath = null;
    if (req.file) attachmentPath = `/uploads/expenses/${req.file.filename}`;

    const expenseData = {
      item: data.item,
      amount: parseFloat(data.amount) || 0,
      method: data.method,
      source: data.source,
      expenseDate: data.date ? new Date(data.date) : new Date(),
      notes: data.notes,
      isClearable: data.isClearable === "true" || data.isClearable === true,
      linkToSettlement:
        data.linkToSettlement === "true" || data.linkToSettlement === true,
      attachmentUrl: attachmentPath,
    };

    // 💡 التعيين المباشر للدافع (أسرع وأكثر أماناً من connect)
    if (
      data.payerId &&
      data.payerId !== "undefined" &&
      data.payerId !== "null" &&
      data.payerId !== ""
    ) {
      expenseData.payerId = data.payerId;
    } else {
      expenseData.payerName = "الشركة";
    }

    // 💡 التعيين المباشر للمستفيد
    if (
      data.payeeId &&
      data.payeeId !== "undefined" &&
      data.payeeId !== "null" &&
      data.payeeId !== ""
    ) {
      expenseData.payeeId = data.payeeId;
    } else {
      expenseData.payeeName = data.payeeName || "جهة غير محددة";
    }

    const newExpense = await prisma.officeExpense.create({ data: expenseData });
    res.status(201).json({ success: true, data: newExpense });
  } catch (error) {
    console.error("Expense Create Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. تعديل المصروف
const updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    let updateData = {
      item: data.item,
      amount: parseFloat(data.amount) || 0,
      method: data.method,
      source: data.source,
    };

    if (data.date) updateData.expenseDate = new Date(data.date);
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.isClearable !== undefined)
      updateData.isClearable =
        data.isClearable === "true" || data.isClearable === true;
    if (data.linkToSettlement !== undefined)
      updateData.linkToSettlement =
        data.linkToSettlement === "true" || data.linkToSettlement === true;

    if (req.file) {
      updateData.attachmentUrl = `/uploads/expenses/${req.file.filename}`;
    }

    // 💡 تحديث الدافع (معالجة الـ undefined والـ null بنجاح)
    if (
      data.payerId &&
      data.payerId !== "undefined" &&
      data.payerId !== "null" &&
      data.payerId !== ""
    ) {
      updateData.payerId = data.payerId;
      updateData.payerName = null;
    } else if (data.payerName !== undefined || data.payerId === "") {
      updateData.payerId = null;
      updateData.payerName = data.payerName || "الشركة";
    }

    // 💡 تحديث المستفيد (التصحيح الجذري لمشكلتك هنا)
    if (
      data.payeeId &&
      data.payeeId !== "undefined" &&
      data.payeeId !== "null" &&
      data.payeeId !== ""
    ) {
      updateData.payeeId = data.payeeId;
      updateData.payeeName = null;
    } else if (data.payeeName !== undefined || data.payeeId === "") {
      updateData.payeeId = null;
      updateData.payeeName = data.payeeName || "جهة غير محددة";
    }

    const updatedExpense = await prisma.officeExpense.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, data: updatedExpense });
  } catch (error) {
    console.error("Expense Update Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. حذف المصروف
const deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.officeExpense.delete({ where: { id } });
    res.json({ success: true, message: "تم حذف المصروف بنجاح" });
  } catch (error) {
    console.error("Expense Delete Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getExpenses, createExpense, updateExpense, deleteExpense };

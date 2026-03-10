const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 1. جلب جميع المصروفات
const getExpenses = async (req, res) => {
  try {
    const expenses = await prisma.officeExpense.findMany({
      orderBy: { expenseDate: "desc" },
      include: {
        payer: { select: { name: true, id: true } }, // جلب الدافع
        payee: { select: { name: true, id: true } }, // 💡 جلب المستفيد
      }
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
      // 💡 معالجة اسم المستفيد
      payee: exp.payee?.name || exp.payeeName || "—",
      payeeId: exp.payee?.id || "",
      hasAttachment: !!exp.attachmentUrl,
      attachmentUrl: exp.attachmentUrl,
      isClearable: exp.isClearable,
      linkToSettlement: exp.linkToSettlement,
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
      linkToSettlement: data.linkToSettlement === "true" || data.linkToSettlement === true,
      attachmentUrl: attachmentPath,
    };

    // 💡 معالجة الدافع (Payer)
    if (data.payerId && data.payerId !== "") {
      expenseData.payer = { connect: { id: data.payerId } };
    } else {
      expenseData.payerName = "الشركة"; 
    }

    // 💡 معالجة المستفيد (Payee)
    if (data.payeeId && data.payeeId !== "") {
      expenseData.payee = { connect: { id: data.payeeId } };
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
      expenseDate: data.date ? new Date(data.date) : undefined,
      notes: data.notes,
      isClearable: data.isClearable === 'true' || data.isClearable === true,
      linkToSettlement: data.linkToSettlement === 'true' || data.linkToSettlement === true,
    };

    if (req.file) updateData.attachmentUrl = `/uploads/expenses/${req.file.filename}`;

    // تحديث الدافع
    if (data.payerId && data.payerId !== "") {
      updateData.payer = { connect: { id: data.payerId } };
      updateData.payerName = null;
    } else if (data.payerId === "") {
      updateData.payer = { disconnect: true };
      updateData.payerName = "الشركة";
    }

    // 💡 تحديث المستفيد
    if (data.payeeId && data.payeeId !== "") {
      updateData.payee = { connect: { id: data.payeeId } };
      updateData.payeeName = null;
    } else if (data.payeeId === "") {
      updateData.payee = { disconnect: true };
      updateData.payeeName = data.payeeName || "جهة غير محددة";
    }

    const updatedExpense = await prisma.officeExpense.update({
      where: { id },
      data: updateData
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
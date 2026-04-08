const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

exports.getAllLinks = async (req, res) => {
  try {
    const links = await prisma.quickLink.findMany({
      include: { category: true },
      orderBy: [
        { isPinned: "desc" },
        { pinOrder: "asc" }, // 👈 الترتيب للمثبت
        { usageCount: "desc" },
        { createdAt: "desc" },
      ],
    });
    res.json({ success: true, data: links });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createLink = async (req, res) => {
  try {
    const {
      title,
      url,
      description,
      categoryId,
      accessLevel,
      requiresLogin,
      loginData,
      assignedEmployees,
      validUntil,
      loginExpiry,
      customFields,
      notes,
      importance,
      createdBy,
    } = req.body;

    const link = await prisma.quickLink.create({
      data: {
        title,
        url,
        description,
        categoryId,
        accessLevel: accessLevel || "الكل",
        requiresLogin: requiresLogin === true || requiresLogin === "true",
        loginData,
        assignedEmployees,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null, // إذا كان فارغاً سيكون null (غير محدد)
        loginExpiry: loginExpiry ? new Date(loginExpiry).toISOString() : null,
        customFields: customFields || [],
        notes,
        importance: importance || "عادي",
        createdBy: createdBy || "مدير النظام",
        updatedBy: createdBy || "مدير النظام",
      },
    });
    res.status(201).json({ success: true, data: link });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateLink = async (req, res) => {
  try {
    const {
      title,
      url,
      description,
      categoryId,
      accessLevel,
      requiresLogin,
      loginData,
      assignedEmployees,
      validUntil,
      loginExpiry,
      customFields,
      notes,
      isPinned,
      importance,
      updatedBy,
    } = req.body;

    const dataToUpdate = {
      updatedBy: updatedBy || "موظف",
    };

    if (title !== undefined) dataToUpdate.title = title;
    if (url !== undefined) dataToUpdate.url = url;
    if (description !== undefined) dataToUpdate.description = description;
    if (categoryId !== undefined) dataToUpdate.categoryId = categoryId;
    if (accessLevel !== undefined) dataToUpdate.accessLevel = accessLevel;
    if (requiresLogin !== undefined)
      dataToUpdate.requiresLogin =
        requiresLogin === true || requiresLogin === "true";
    if (loginData !== undefined) dataToUpdate.loginData = loginData;
    if (assignedEmployees !== undefined)
      dataToUpdate.assignedEmployees = assignedEmployees;

    // 💡 السماح بتمرير null لإلغاء التاريخ (غير محدد)
    if (validUntil !== undefined)
      dataToUpdate.validUntil = validUntil
        ? new Date(validUntil).toISOString()
        : null;
    if (loginExpiry !== undefined)
      dataToUpdate.loginExpiry = loginExpiry
        ? new Date(loginExpiry).toISOString()
        : null;

    if (customFields !== undefined) dataToUpdate.customFields = customFields;
    if (notes !== undefined) dataToUpdate.notes = notes;
    if (isPinned !== undefined)
      dataToUpdate.isPinned = isPinned === true || isPinned === "true";
    if (importance !== undefined) dataToUpdate.importance = importance;

    const link = await prisma.quickLink.update({
      where: { id: req.params.id },
      data: dataToUpdate,
    });
    res.json({ success: true, data: link });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 دالة جديدة لتبديل الترتيب بين رابطين مثبتين
exports.reorderLinks = async (req, res) => {
  try {
    const { link1Id, link1Order, link2Id, link2Order } = req.body;
    await prisma.$transaction([
      prisma.quickLink.update({
        where: { id: link1Id },
        data: { pinOrder: link2Order },
      }),
      prisma.quickLink.update({
        where: { id: link2Id },
        data: { pinOrder: link1Order },
      }),
    ]);
    res.json({ success: true, message: "تم إعادة الترتيب" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteLink = async (req, res) => {
  try {
    await prisma.quickLink.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "تم حذف الرابط بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.incrementUsage = async (req, res) => {
  try {
    const link = await prisma.quickLink.update({
      where: { id: req.params.id },
      data: { usageCount: { increment: 1 } },
    });
    res.json({ success: true, data: link });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Controllers للتصنيفات (بدون تغيير) ---
exports.getCategories = async (req, res) => {
  try {
    const categories = await prisma.linkCategory.findMany();
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.createCategory = async (req, res) => {
  try {
    const category = await prisma.linkCategory.create({
      data: { name: req.body.name },
    });
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "قد يكون التصنيف موجوداً بالفعل" });
  }
};
exports.deleteCategory = async (req, res) => {
  try {
    await prisma.linkCategory.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "تم حذف التصنيف" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "لا يمكن حذف تصنيف يحتوي على روابط" });
  }
};

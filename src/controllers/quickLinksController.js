const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ==========================================
// Controllers للروابط
// ==========================================

exports.getAllLinks = async (req, res) => {
  try {
    const links = await prisma.quickLink.findMany({
      include: { category: true },
      orderBy: [
        { isPinned: "desc" },
        { usageCount: "desc" },
        { createdAt: "desc" },
      ],
    });
    res.json({ success: true, data: links });
  } catch (error) {
    console.error("Get Links Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createLink = async (req, res) => {
  try {
    // 💡 استخراج الحقول الآمنة فقط لتجنب أي تعارض مع Prisma
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
        // 💡 معالجة التواريخ لتكون بصيغة ISO مقبولة لـ Prisma
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        loginExpiry: loginExpiry ? new Date(loginExpiry).toISOString() : null,
        customFields: customFields || [],
        notes,
      },
    });

    res.status(201).json({ success: true, data: link });
  } catch (error) {
    console.error("Create Link Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل إنشاء الرابط: " + error.message });
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
      isPinned, // 💡 في حال تم طلب تثبيت/إلغاء تثبيت الرابط
    } = req.body;

    // 💡 بناء كائن التحديث ديناميكياً لتحديث الحقول المُرسلة فقط
    const dataToUpdate = {};

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

    // معالجة التواريخ
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

    const link = await prisma.quickLink.update({
      where: { id: req.params.id },
      data: dataToUpdate,
    });

    res.json({ success: true, data: link });
  } catch (error) {
    console.error("Update Link Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل تحديث الرابط: " + error.message });
  }
};

exports.deleteLink = async (req, res) => {
  try {
    await prisma.quickLink.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "تم حذف الرابط بنجاح" });
  } catch (error) {
    console.error("Delete Link Error:", error);
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
    console.error("Increment Usage Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// Controllers للتصنيفات
// ==========================================

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
      .json({
        success: false,
        message: "لا يمكن حذف تصنيف يحتوي على روابط. يرجى حذف الروابط أولاً.",
      });
  }
};

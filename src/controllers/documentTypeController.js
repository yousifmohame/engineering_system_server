const prisma = require("../utils/prisma");

exports.getAllDocumentTypes = async (req, res) => {
  try {
    const { search } = req.query;
    const where = {};

    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { classification: { contains: search, mode: "insensitive" } },
      ];
    }

    const docTypes = await prisma.documentType.findMany({
      where,
      orderBy: { code: "asc" }, // ترتيب حسب الكود
    });

    res.json(docTypes);
  } catch (error) {
    console.error("Error fetching doc types:", error);
    res.status(500).json({ message: "فشل جلب أنواع المستندات" });
  }
};

exports.createDocumentType = async (req, res) => {
  try {
    const {
      name,
      nameEn,
      classification,
      maxSizeMB,
      requiresSignature,
      confidentiality,
      allowMultiple,
      status,
    } = req.body;

    // 1. منطق التوليد التلقائي للكود (DOC-001, DOC-002...)
    const count = await prisma.documentType.count();
    const sequence = String(count + 1).padStart(3, "0"); // يضيف أصفار في البداية
    const generatedCode = `DOC-${sequence}`;

    // 2. الإنشاء في قاعدة البيانات
    const newType = await prisma.documentType.create({
      data: {
        code: generatedCode, // الكود المولد
        name,
        nameEn,
        classification,
        maxSizeMB: maxSizeMB ? parseInt(maxSizeMB) : 5,
        requiresSignature: requiresSignature || false,
        confidentiality: confidentiality || "General",
        allowMultiple: allowMultiple || false,
        status: status || "Active",
        allowedExtensions: ["PDF", "JPG", "PNG"], // افتراضي، يمكن تعديله لاحقاً
      },
    });

    res.status(201).json(newType);
  } catch (error) {
    console.error("Create Doc Type Error:", error);
    res.status(400).json({ message: "فشل إنشاء النوع: " + error.message });
  }
};

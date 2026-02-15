const prisma = require("../utils/prisma");
const aiService = require("../services/aiExtractionService");

// 1. جلب قائمة الملفات (310-LST)
exports.getAllPropertyFiles = async (req, res) => {
  try {
    const files = await prisma.ownershipFile.findMany({
      include: { client: { select: { name: true, clientCode: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(files);
  } catch (error) {
    res.status(500).json({ message: "فشل جلب ملفات الملكية" });
  }
};

// 2. معالجة الرفع والذكاء الاصطناعي (310-UPL)
exports.processPropertyAI = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "يرجى رفع ملف الصك" });

    // استدعاء خدمة الذكاء الاصطناعي
    const aiResult = await aiService.extractPropertyData(
      req.file.buffer,
      req.file.mimetype,
    );

    if (!aiResult.success) {
      return res.status(500).json({ message: aiResult.error });
    }

    // ملاحظة: لا نحفظ في القاعدة الآن؛ نرسل البيانات للفرونت إند للمراجعة (Review Pattern)
    res.json({
      success: true,
      documents: aiResult.documents,
      totalPages: aiResult.totalPages,
      fileMetadata: {
        originalName: req.file.originalname,
        size: req.file.size,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "خطأ في معالجة الملف" });
  }
};

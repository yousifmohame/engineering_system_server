const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// 1. جلب جميع العقود
const getContracts = async (req, res) => {
  try {
    const contracts = await prisma.contract.findMany({
      include: {
        client: { select: { name: true, clientCode: true, type: true } },
        quotation: { select: { total: true } },
      },
      orderBy: { startDate: "desc" },
    });

    // تنسيق البيانات لتناسب الفرونت إند
    const formattedData = contracts.map((c) => {
      // استخراج اسم العميل إذا كان JSON
      let clientName = "غير محدد";
      if (c.client?.name) {
        const parsedName =
          typeof c.client.name === "string"
            ? JSON.parse(c.client.name)
            : c.client.name;
        clientName = parsedName.ar || "غير محدد";
      }

      return {
        id: c.contractCode,
        realId: c.id, // نحتاج الـ ID الحقيقي للحذف والتعديل
        type: c.title,
        clientType: c.client?.type || "فرد",
        clientName: clientName,
        clientId: c.client?.clientCode || "—",
        hasRep: false, // يمكن ربطها لاحقاً
        repType: "—",
        status:
          c.status === "Active"
            ? "معتمد"
            : c.status === "Draft"
              ? "مسودة"
              : "ملغي",
        date: c.startDate.toISOString().split("T")[0],
        expiry: c.endDate.toISOString().split("T")[0],
        value: c.totalValue
          ? c.totalValue.toLocaleString("ar-SA")
          : c.quotation?.total?.toLocaleString("ar-SA") || "—",
        lastUpdate: c.startDate.toISOString().split("T")[0], // مؤقتاً
      };
    });

    res.json(formattedData);
  } catch (error) {
    res.status(500).json({ message: "فشل جلب العقود", error: error.message });
  }
};

// 2. إنشاء عقد جديد (من الـ Wizard)
const createContract = async (req, res) => {
  try {
    const { title, clientId, status, totalValue } = req.body;

    // توليد كود عقد تلقائي
    const count = await prisma.contract.count();
    const contractCode = `CNT-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

    const newContract = await prisma.contract.create({
      data: {
        contractCode,
        title: title || "عقد خدمات هندسية",
        clientId, // ID العميل الذي تم اختياره من النظام
        status: status || "Draft",
        startDate: new Date(),
        endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)), // افتراضياً سنة واحدة
        totalValue: parseFloat(totalValue || 0),
      },
    });

    res.status(201).json(newContract);
  } catch (error) {
    res.status(500).json({ message: "فشل إنشاء العقد", error: error.message });
  }
};

// 3. حذف العقد
const deleteContract = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.contract.delete({ where: { id } });
    res.json({ message: "تم حذف العقد بنجاح" });
  } catch (error) {
    res.status(500).json({ message: "فشل حذف العقد", error: error.message });
  }
};

const getTemplates = async (req, res) => {
  try {
    const templates = await prisma.contractTemplate.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(templates);
  } catch (error) {
    res.status(500).json({ message: "فشل جلب القوالب", error: error.message });
  }
};

// إنشاء قالب جديد
const createTemplate = async (req, res) => {
  try {
    const {
      title,
      description,
      clientType,
      serviceType,
      hasRep,
      isProxy,
      isDefault,
      sections,
    } = req.body;

    // إذا كان القالب الجديد "افتراضي"، يمكننا إزالة الافتراضي من القوالب الأخرى المشابهة
    if (isDefault) {
      await prisma.contractTemplate.updateMany({
        where: { clientType, serviceType },
        data: { isDefault: false },
      });
    }

    const newTemplate = await prisma.contractTemplate.create({
      data: {
        title,
        description,
        clientType,
        serviceType,
        hasRep: hasRep || false,
        isProxy: isProxy || false,
        isDefault: isDefault || false,
        sections: parseInt(sections) || 12,
      },
    });

    res.status(201).json(newTemplate);
  } catch (error) {
    res.status(500).json({ message: "فشل إنشاء القالب", error: error.message });
  }
};

// تعديل قالب موجود
const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      clientType,
      serviceType,
      hasRep,
      isProxy,
      isDefault,
      sections,
    } = req.body;

    if (isDefault) {
      await prisma.contractTemplate.updateMany({
        where: { clientType, serviceType },
        data: { isDefault: false },
      });
    }

    const updatedTemplate = await prisma.contractTemplate.update({
      where: { id },
      data: {
        title,
        description,
        clientType,
        serviceType,
        hasRep: hasRep || false,
        isProxy: isProxy || false,
        isDefault: isDefault || false,
        sections: parseInt(sections) || 12,
      },
    });

    res.json(updatedTemplate);
  } catch (error) {
    res.status(500).json({ message: "فشل تعديل القالب", error: error.message });
  }
};

// حذف قالب
const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.contractTemplate.delete({ where: { id } });
    res.json({ message: "تم حذف القالب بنجاح" });
  } catch (error) {
    res.status(500).json({ message: "فشل حذف القالب", error: error.message });
  }
};

// زيادة عدد الاستخدامات لقالب معين (يُستدعى عند إنشاء عقد من قالب)
const incrementTemplateUse = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await prisma.contractTemplate.update({
      where: { id },
      data: { usesCount: { increment: 1 } },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: "فشل التحديث", error: error.message });
  }
};

module.exports = {
  getContracts,
  createContract,
  deleteContract,
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  incrementTemplateUse,
};

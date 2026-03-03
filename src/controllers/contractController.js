const { PrismaClient } = require("@prisma/client");
const { OpenAI } = require("openai");
const prisma = new PrismaClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 1. جلب جميع العقود
const getContracts = async (req, res) => {
  try {
    const contracts = await prisma.contract.findMany({
      include: {
        client: { select: { name: true, clientCode: true, type: true } },
        // 👈 جلب بيانات عرض السعر والملكية المرتبطة به
        quotation: {
          select: {
            id: true,
            number: true,
            total: true,
            ownership: { select: { id: true, code: true } }, // جلب الملكية من داخل عرض السعر
          },
        },
      },
      orderBy: { startDate: "desc" },
    });

    // تنسيق البيانات لتناسب الفرونت إند
    const formattedData = contracts.map((c) => {
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
        realId: c.id,
        type: c.title,
        clientType: c.client?.type || "فرد",
        clientName: clientName,
        clientId: c.client?.clientCode || "—",
        hasRep: false,
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
        lastUpdate: c.startDate.toISOString().split("T")[0],

        quotationId: c.quotation?.id || null,
        quotationNumber: c.quotation?.number || null,
        propertyId: c.quotation?.ownership?.id || null,
        propertyCode: c.quotation?.ownership?.code || null,

        // 👈 هذا السطر مهم جداً! بدونه ستختفي التعديلات عند الضغط على العقد مرة أخرى
        clauses: c.clauses,
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
    // 👈 1. استقبال الحقول الجديدة من الفرونت إند
    const {
      title,
      clientId,
      status,
      totalValue,
      quotationId,
      propertyId,
      templateId,
      clauses,
    } = req.body;

    const count = await prisma.contract.count();
    const contractCode = `CNT-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

    const newContract = await prisma.contract.create({
      data: {
        contractCode,
        title: title || "عقد خدمات هندسية",
        clientId,
        status: status || "Draft",
        startDate: new Date(),
        endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        totalValue: parseFloat(totalValue || 0),

        quotationId: quotationId || null,

        // 👈 2. حفظ الملكية والقالب والبنود في الداتابيز
        ownershipId: propertyId || null,
        templateId: templateId || null,
        clauses: clauses || [],
      },
    });

    res.status(201).json(newContract);
  } catch (error) {
    res.status(500).json({ message: "فشل إنشاء العقد", error: error.message });
  }
};

// تحديث العقد (حفظ التعديلات من المحرر)
const updateContract = async (req, res) => {
  try {
    const { id } = req.params;
    const { clauses } = req.body;

    const updatedContract = await prisma.contract.update({
      where: { id },
      data: {
        clauses: clauses || [],
      },
    });

    res.json(updatedContract);
  } catch (error) {
    res.status(500).json({ message: "فشل تحديث العقد", error: error.message });
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
      clauses,
    } = req.body; // 👈 استخراج clauses

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
        clauses: clauses || [], // 👈 حفظ البنود
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
      clauses,
    } = req.body; // 👈 استخراج clauses

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
        clauses: clauses || [], // 👈 تحديث البنود
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

// ===============================================
// مراجعة العقد بالذكاء الاصطناعي (AI Review)
// POST /api/contracts/analyze-ai
// ===============================================
const analyzeContractAI = async (req, res) => {
  try {
    const { clauses, clientId, propertyId, type } = req.body;

    // 1. جلب تفاصيل العميل والملكية لتقديم سياق (Context) للذكاء الاصطناعي
    const client = clientId ? await prisma.client.findUnique({ where: { id: clientId } }) : null;
    const property = propertyId ? await prisma.ownershipFile.findUnique({ where: { id: propertyId } }) : null;

    let clientName = "غير محدد";
    if (client && client.name) {
        clientName = typeof client.name === 'string' ? JSON.parse(client.name).ar || client.name : client.name.ar || client.name;
    }

    // 2. تجميع النص الذي سيقرأه الـ AI
    const contextData = `
      نوع العقد: ${type || 'غير محدد'}
      
      بيانات العميل المربوط:
      - الاسم: ${clientName}
      - الهوية: ${client?.idNumber || 'غير متوفر'}
      - النوع: ${client?.type || 'غير متوفر'}
      
      بيانات الملكية المربوطة:
      - ${property ? `صك رقم: ${property.deedNumber || 'بدون'}، الحي: ${property.district}` : 'لا يوجد ملكية مربوطة بهذا العقد'}

      بنود العقد الحالية (JSON):
      ${JSON.stringify(clauses, null, 2)}
    `;

    // 3. كتابة التلقين (Prompt) بصرامة ليطابق تصميم الفرونت إند
    const prompt = `
      أنت مستشار قانوني سعودي محترف، متخصص في صياغة ومراجعة عقود المكاتب الهندسية حسب الأنظمة السعودية.
      الرجاء مراجعة بيانات العقد والبنود المرفقة وإرجاع النتيجة بصيغة JSON فقط.

      المطلوب استخراجه في الـ JSON:
      {
        "clientConsistency": {
          "status": "success" أو "warning",
          "title": "عنوان قصير للحالة",
          "message": "رسالة توضح هل بيانات العميل مكتملة أم يوجد نواقص مهمة للعقد"
        },
        "propertyStatus": {
          "status": "success" أو "warning",
          "title": "عنوان حالة الملكية",
          "message": "رسالة توضح إذا كانت الملكية مربوطة أم لا، ونصيحة بربطها إن لم تكن"
        },
        "improvementSuggestion": {
          "clauseId": "اكتب الـ id الخاص بالبند الذي يحتاج تحسين (مثلا: intro)",
          "title": "عنوان الاقتراح (مثال: تحسين صياغة المقدمة)",
          "reason": "لماذا تقترح هذا التعديل؟",
          "suggestedText": "اكتب النص القانوني الجديد والمحسن بالكامل هنا. استخدم اسم العميل (${clientName}) داخل النص ليكون واقعياً."
        },
        "summary": "اكتب ملخصاً لأهم 3 أو 4 شروط في العقد على شكل أسطر يفصل بينها \\n"
      }

      بيانات العقد للمراجعة:
      ${contextData}
    `;

    // 4. استدعاء OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3, // درجة منخفضة لضمان الرد القانوني الدقيق
    });

    const parsedData = JSON.parse(response.choices[0].message.content);

    res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("AI Contract Analysis Error:", error);
    res.status(500).json({ success: false, message: "فشل تحليل العقد بالذكاء الاصطناعي", error: error.message });
  }
};

module.exports = {
  getContracts,
  createContract,
  updateContract,
  deleteContract,
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  incrementTemplateUse,
  analyzeContractAI
};

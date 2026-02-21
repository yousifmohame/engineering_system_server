const prisma = require("../utils/prisma");
// const aiService = require("../services/aiExtractionService");
const { OpenAI } = require("openai");
const { fromBuffer } = require("pdf2pic");
const { PDFDocument } = require("pdf-lib");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.analyzeDeedAI = async (req, res) => {
  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرسال أي ملف" });
    }

    const mimeType = imageBase64.substring(
      imageBase64.indexOf(":") + 1,
      imageBase64.indexOf(";"),
    );
    const base64Data = imageBase64.split(",")[1];
    const fileBuffer = Buffer.from(base64Data, "base64");

    let imagesToSend = [];

    // ==========================================
    // 1. معالجة الـ PDF (الأسلوب المؤسسي المحسّن)
    // ==========================================
    if (mimeType === "application/pdf") {
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const totalPages = pdfDoc.getPageCount();

      // حماية السيرفر: تقييد الحد الأقصى للصفحات (مثلاً 5 صفحات للصكوك)
      const pagesToProcess = Math.min(totalPages, 5);

      console.log(
        `🚀 رصد ${totalPages} صفحات PDF. جاري معالجة ${pagesToProcess} صفحة بوضع التحسين (Enterprise Mode)...`,
      );

      // إعدادات احترافية لتقليل حجم الـ Payload بنسبة 90% مع الحفاظ على الدقة للـ OCR
      const options = {
        density: 150,
        format: "jpeg",
        width: 1240,
        height: 1754,
      };

      const convert = fromBuffer(fileBuffer, options);

      for (let i = 1; i <= pagesToProcess; i++) {
        console.log(`📸 معالجة الصفحة ${i}...`);
        const image = await convert(i, { responseType: "base64" });
        imagesToSend.push(`data:image/jpeg;base64,${image.base64}`);
      }
    }
    // ==========================================
    // 2. معالجة الصور المباشرة (JPG/PNG/JPEG)
    // ==========================================
    else if (mimeType.startsWith("image/")) {
      imagesToSend.push(imageBase64);
    } else {
      return res
        .status(400)
        .json({ success: false, message: "نوع الملف غير مدعوم." });
    }

    console.log(
      `🧠 جاري إرسال ${imagesToSend.length} صور إلى OpenAI للتحليل الشامل...`,
    );

    // ==========================================
    // 3. البرومبت الشامل (Master Extraction Prompt)
    // ==========================================
    const prompt = `
    أنت خبير معتمد ومراجع قانوني في وزارة العدل والهيئة العامة للعقار في السعودية.
    مهمتك قراءة الصورة/الصور المرفقة والتي تمثل "صكاً عقارياً" (قد يكون صك كتابة عدل قديم، أو وثيقة بورصة عقارية، أو صك سجل عقاري RER).
    استخرج البيانات التالية بدقة متناهية وأعدها كـ JSON صالح 100%.

    🔍 **دليل البحث الاستراتيجي حسب نوع الصك:**
    1. **السجل العقاري (RER):** "رقم العقار" هو رقم الوثيقة (مثل 4251638128200000). المساحة واستعمال العقار تكون في جدول "بيانات قطعة الأرض".
    2. **البورصة العقارية:** رقم الوثيقة عادة 12 رقم (مثل 918501007702). قد يحتوي الصك على عدة عقارات (العقار 1 من 2). اجمع المساحات معاً، وادمج أرقام القطع بفاصلة (مثال: 1/80, 3/80). استخرج قيمة الصفقة.
    3. **صكوك كتابة العدل القديمة (النصية):** اقرأ النص السردي. استخرج رقم الصك من الأعلى، المساحة من جملة "ومساحتها (...) متر"، الأطوال من "شمالا ... بطول (...)". واستخرج الثمن من "بثمن وقدره (...)".
    
    ⚠️ **قواعد البيانات الصارمة (Data Types):**
    - الأرقام (المساحة totalArea، الأطوال length، نسبة التملك sharePercentage، قيمة الصفقة transactionValue) يجب أن تكون من نوع Number.
    - إزالة الفواصل من الأرقام الكبيرة: مثلاً "4,500,000" تصبح 4500000. و "1,250" تصبح 1250. أزل أي نصوص مثل "م2" أو "%" أو "ريال".
    - إذا لم تجد المعلومة، أرجع null (للنصوص) أو 0 (للأرقام). لا تخمن أبداً.

    التركيبة المطلوبة للـ JSON:
    {
      "documentInfo": {
        "documentNumber": "رقم الوثيقة/الصك/العقار (String)",
        "hijriDate": "تاريخ الوثيقة الهجري DD/MM/YYYY (String)",
        "gregorianDate": "تاريخ الوثيقة الميلادي DD/MM/YYYY (String)",
        "documentType": "صك ملكية أو وثيقة تملك أو صك تسجيل ملكية (String)",
        "issuingAuthority": "الجهة المصدرة: وزارة العدل أو الهيئة العامة للعقار أو كتابة العدل (String)",
        "propertyId": "رقم الهوية العقارية إن وجد (String)"
      },
      "previousDocumentInfo": {
        "previousDocumentNumber": "رقم الوثيقة/الصك السابق (String)",
        "previousDocumentDate": "تاريخ الوثيقة السابقة (String)",
        "transactionValue": قيمة انتقال الملكية/قيمة الصفقة/الثمن (Number)
      },
      "locationInfo": {
        "city": "اسم المدينة (String)",
        "district": "اسم الحي (String)"
      },
      "plots": [
        {
          "plotNumber": "رقم القطعة (String)",
          "planNumber": "رقم المخطط (String)",
          "blockNumber": "رقم البلك (String)",
          "area": مساحة هذه القطعة فقط (Number),
          "propertyType": "قطعة أرض، أرض فضاء، فيلا، الخ (String)",
          "usageType": "سكني، تجاري، زراعي، الخ (String)"
        }
      ],
      "propertySpecs": {
        "totalArea": إجمالي مساحة كل القطع معاً (Number)
      },
      "owners": [
        {
          "name": "اسم المالك أو الشركة (String)",
          "identityNumber": "رقم الهوية الوطنية أو الرقم الموحد (String)",
          "nationality": "الجنسية (String)",
          "sharePercentage": نسبة التملك من 0 إلى 100 (Number)
        }
      ],
      "boundaries": [
        { "direction": "شمال", "length": الطول (Number), "description": "وصف المجاور أو الشارع (String)" },
        { "direction": "جنوب", "length": الطول (Number), "description": "وصف المجاور أو الشارع (String)" },
        { "direction": "شرق", "length": الطول (Number), "description": "وصف المجاور أو الشارع (String)" },
        { "direction": "غرب", "length": الطول (Number), "description": "وصف المجاور أو الشارع (String)" }
      ],
      "metadata": {
        "confidenceScore": تقييمك لدقة استخراج البيانات من 0 إلى 100 (Number),
        "aiNotes": "ملاحظاتك (String)"
      }
    }
    `;

    const contentArray = [{ type: "text", text: prompt }];
    imagesToSend.forEach((imgUrl) => {
      contentArray.push({
        type: "image_url",
        image_url: { url: imgUrl, detail: "high" },
      });
    });

    // إرسال الطلب لـ OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: contentArray }],
      response_format: { type: "json_object" },
      temperature: 0.0, // دقة مطلقة 100%
    });

    const parsedData = JSON.parse(response.choices[0].message.content);
    console.log("✅ تم تحليل الصك بجميع تفاصيله بنجاح!");

    res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("AI Analysis Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل تحليل الوثيقة بالذكاء الاصطناعي",
      details: error.message,
    });
  }
};

exports.getAllProperties = async (req, res) => {
  try {
    const { search, limit = 10, page = 1, clientId } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (clientId) {
      where.clientId = clientId;
    }

    if (search) {
      where.OR = [
        { deedNumber: { contains: search } },
        { district: { contains: search } },
        { client: { name: { path: ["ar"], string_contains: search } } },
      ];
    }

    const [deeds, total] = await Promise.all([
      prisma.ownershipFile.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        orderBy: { createdAt: "desc" },
        include: {
          client: { select: { id: true, name: true, mobile: true } },
        },
      }),
      prisma.ownershipFile.count({ where }),
    ]);

    res.json({
      success: true,
      data: deeds, // البيانات تأتي الآن بنفس الأسماء المطلوبة للواجهة
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error getting properties:", error);
    res.status(500).json({ success: false, message: "فشل جلب البيانات" });
  }
};

exports.createProperty = async (req, res) => {
  try {
    const {
      deedNumber,
      deedDate,
      district,
      city,
      plotNumber,
      blockNumber,
      planNumber,
      area,
      clientId,
      notes,
      documents = [],
      plots = [],
      owners = [],
      boundaries = [],
      attachments = [],
    } = req.body;

    if (!clientId) {
      return res
        .status(400)
        .json({ success: false, message: "يجب إدخال اسم أو معرّف العميل" });
    }

    // ==========================================
    // 0. معالجة رقم الصك (منع التكرار ومنع مشكلة النصوص الفارغة)
    // ==========================================
    // ==========================================
    // 0. معالجة رقم الصك (دعم الصكوك المتعددة)
    // ==========================================
    const validDeedNumber =
      deedNumber && String(deedNumber).trim() !== ""
        ? String(deedNumber).trim()
        : null;

    if (validDeedNumber) {
      // نستخدم findFirst بدلاً من findUnique لأن الحقل لم يعد Unique
      const existingDeed = await prisma.ownershipFile.findFirst({
        where: { deedNumber: validDeedNumber },
      });

      // يمكنك إزالة هذا الشرط تماماً إذا أردت السماح بحفظ نفس الأرقام في ملفات مختلفة
      if (existingDeed) {
        return res.status(400).json({
          success: false,
          message: `عفواً، الصك المرجعي (${validDeedNumber}) مرتبط بملف آخر مسبقاً.`,
        });
      }
    }

    // ==========================================
    // 1. معالجة التاريخ بأمان (Safe Date Parsing)
    // ==========================================
    let validDeedDate = null;
    if (deedDate) {
      const parsedDate = new Date(deedDate);
      if (!isNaN(parsedDate.getTime())) {
        validDeedDate = parsedDate;
      } else {
        console.log(
          `⚠️ التاريخ المدخل غير صالح كـ Date ميلادي: ${deedDate} (سيتم تركه فارغاً)`,
        );
      }
    }

    // ==========================================
    // 2. معالجة العميل (Smart Client Connection)
    // ==========================================
    let finalClientId = clientId;
    if (clientId.includes(" ") || /[\u0600-\u06FF]/.test(clientId)) {
      console.log(`👤 جاري إنشاء عميل جديد تلقائياً باسم: ${clientId}`);

      const clientsCount = await prisma.client.count();
      const newClientCode = `C-${String(clientsCount + 1).padStart(5, "0")}`;

      const tempIdNumber =
        "10" +
        Math.floor(Math.random() * 100000000)
          .toString()
          .padStart(8, "0");
      const tempMobile =
        "05" +
        Math.floor(Math.random() * 100000000)
          .toString()
          .padStart(8, "0");

      const newClient = await prisma.client.create({
        data: {
          clientCode: newClientCode,
          name: { ar: clientId },
          mobile: tempMobile,
          idNumber: tempIdNumber,
          type: "Individual",
          contact: {},
          identification: {},
        },
      });
      finalClientId = newClient.id;
    }

    // ==========================================
    // 3. توليد الكود والحفظ
    // ==========================================
    const currentYear = new Date().getFullYear();
    const count = await prisma.ownershipFile.count();
    const sequence = String(count + 1).padStart(4, "0");
    const code = `PRO-800-${sequence}`;

    const newDeed = await prisma.ownershipFile.create({
      data: {
        code,
        deedNumber: validDeedNumber, // 👈 استخدام الرقم المعالج هنا
        deedDate: validDeedDate,
        district,
        city: city || "الرياض",
        planNumber: planNumber || null,
        plotNumber: plotNumber || null,
        blockNumber: blockNumber || null,
        area: area ? parseFloat(area) : 0,
        status: "Active",
        notes,

        // حفظ بيانات الذكاء الاصطناعي
        documents,
        plots,
        owners,
        boundaries,
        attachments,

        // ربط العميل بالمعرّف الآمن
        client: { connect: { id: finalClientId } },
      },
    });

    res.status(201).json({
      success: true,
      message: "تم حفظ الصك وبيانات الـ AI بنجاح!",
      data: newDeed,
    });
  } catch (error) {
    console.error("Create Property Error:", error);
    res
      .status(400)
      .json({ success: false, message: "فشل الحفظ: " + error.message });
  }
};

// تحديث بيانات ملف الملكية (الصك)
exports.updateProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      // 1. المصفوفات (JSON)
      documents,
      plots,
      owners,
      boundaries,
      attachments,

      // 2. الحقول الأساسية
      area,
      city,
      district,
      planNumber,
      deedNumber, // 👈 تمت الإضافة
      deedDate, // 👈 تمت الإضافة
      status, // 👈 تمت الإضافة (لتاب التحقق)
      notes, // 👈 تمت الإضافة (لتاب الملاحظات)
    } = req.body;

    // معالجة التاريخ إذا تم إرسال تاريخ جديد
    let validDeedDate = undefined;
    if (deedDate) {
      const parsedDate = new Date(deedDate);
      if (!isNaN(parsedDate.getTime())) {
        validDeedDate = parsedDate;
      }
    }

    const updatedProperty = await prisma.ownershipFile.update({
      where: { id },
      data: {
        // تحديث الحقول الأساسية (نستخدم !== undefined للسماح بحفظ القيم الفارغة إذا مسحها المستخدم)
        ...(area !== undefined && { area: parseFloat(area) }),
        ...(city !== undefined && { city }),
        ...(district !== undefined && { district }),
        ...(planNumber !== undefined && { planNumber }),
        ...(deedNumber !== undefined && { deedNumber }),
        ...(validDeedDate !== undefined && { deedDate: validDeedDate }),
        ...(status !== undefined && { status }), // ✅ حفظ تغيير الحالة
        ...(notes !== undefined && { notes }), // ✅ حفظ الملاحظات

        // تحديث حقول الـ JSON
        ...(documents && { documents }),
        ...(plots && { plots }),
        ...(owners && { owners }),
        ...(boundaries && { boundaries }),
        ...(attachments && { attachments }),
      },
    });

    res.json({
      success: true,
      data: updatedProperty,
      message: "تم تحديث الملف وتخزين البيانات بنجاح",
    });
  } catch (error) {
    console.error("Update Property Error:", error);
    res
      .status(500)
      .json({ success: false, message: "فشل في تحديث بيانات الملكية" });
  }
};

// 3. جلب تفاصيل صك
exports.getPropertyById = async (req, res) => {
  try {
    const { id } = req.params;
    const property = await prisma.ownershipFile.findUnique({
      where: { id },
      include: {
        client: {
          select: { id: true, name: true, mobile: true, idNumber: true },
        },
      },
    });

    if (!property) {
      return res
        .status(404)
        .json({ success: false, message: "ملف الملكية غير موجود" });
    }

    res.json({ success: true, data: property });
  } catch (error) {
    console.error("Error fetching property details:", error);
    res.status(500).json({ success: false, message: "فشل جلب التفاصيل" });
  }
};

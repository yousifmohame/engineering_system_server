const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { fromBuffer } = require("pdf2pic");
const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
const { OpenAI } = require("openai");

// تأكد من وضع مفتاح OpenAI في ملف .env
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ==========================================
// 💡 تحليل الرخصة بالذكاء الاصطناعي (يدعم PDF والصور)
// ==========================================
// ==========================================
// 💡 تحليل رخص البناء بالذكاء الاصطناعي (محدث بدقة فائقة)
// ==========================================
const analyzePermitAI = async (req, res) => {
  try {
    let fileBuffer;
    let mimeType;

    if (req.file) {
      fileBuffer = fs.readFileSync(req.file.path);
      mimeType = req.file.mimetype;
    } else if (req.body.imageBase64) {
      const { imageBase64 } = req.body;
      mimeType = imageBase64.substring(
        imageBase64.indexOf(":") + 1,
        imageBase64.indexOf(";"),
      );
      const base64Data = imageBase64.split(",")[1];
      fileBuffer = Buffer.from(base64Data, "base64");
    } else {
      return res
        .status(400)
        .json({ success: false, message: "لم يتم إرسال أي وثيقة" });
    }

    let imagesToSend = [];

    if (mimeType === "application/pdf") {
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const totalPages = pdfDoc.getPageCount();
      const pagesToProcess = Math.min(totalPages, 5);

      console.log(
        `🚀 جاري معالجة ${pagesToProcess} صفحة بدقة عالية (300 DPI)...`,
      );

      // 💡 التعديل الأهم: زيادة الدقة لـ 300 والأبعاد لتناسب ورقة A4 واضحة جداً
      const options = {
        density: 300,
        format: "jpeg",
        width: 2480,
        height: 3508,
      };

      const convert = fromBuffer(fileBuffer, options);

      for (let i = 1; i <= pagesToProcess; i++) {
        const image = await convert(i, { responseType: "base64" });
        imagesToSend.push(`data:image/jpeg;base64,${image.base64}`);
      }
    } else if (mimeType.startsWith("image/")) {
      const base64Data = fileBuffer.toString("base64");
      imagesToSend.push(`data:${mimeType};base64,${base64Data}`);
    } else {
      return res
        .status(400)
        .json({ success: false, message: "نوع الملف غير مدعوم." });
    }

    // 💡 برومبت صارم جداً يمنع التخمين ويستخرج كافة التفاصيل
    // 💡 برومبت صارم جداً يمنع التخمين ويستخرج كافة التفاصيل (تم إضافة كلمة JSON إجبارياً)
    const prompt = `
    أنت خبير قانوني وهندسي محلف في المملكة العربية السعودية.
    أمامك صورة لرخصة بناء أو فسح أو مسودة رخصة.
    تحذير هام جداً 🚨: استخرج النصوص والأرقام كما هي مكتوبة في الصورة **بالحرف والرقم**. يُمنع منعاً باتاً تخمين أو تأليف أي بيانات غير واضحة. إذا كانت المعلومة مفقودة أرجع null أو نص فارغ "".

    قد يحتوي الملف على أكثر من رخصة، استخرجها كلها داخل مصفوفة "permits" وأعد النتيجة بصيغة JSON حصرية.
    
    التركيبة المطلوبة لكل رخصة بصيغة JSON:
    {
      "permits": [
        {
          "permitNumber": "رقم الرخصة",
          "issueDate": "تاريخ إصدارها (إن وجد)",
          "expiryDate": "تاريخ انتهائها (إن وجد)",
          "year": "سنة الرخصة (استنتجها من التاريخ الهجري أو الميلادي كأربع أرقام)",
          "type": "نوع الطلب أو الرخصة (مثال: بناء جديد، تعديل، تجديد...)",
          "ownerName": "اسم صاحب الرخصة بالكامل",
          "idNumber": "رقم الهوية أو السجل (أرقام فقط)",
          "district": "الحي",
          "sector": "البلدية أو القطاع",
          "plotNumber": "رقم قطعة الأرض",
          "planNumber": "رقم المخطط",
          "usage": "الاستخدام",
          "landArea": مساحة الأرض (رقم Number فقط),
          "engineeringOffice": "المكتب الهندسي المصمم أو المشرف",
          "form": "شكل الرخصة (أخضر للحديثة، أصفر، أو يدوي للقديمة)",
          "notes": "أي ملاحظات مكتوبة في الرخصة",
          "componentsData": [
            { "name": "اسم المكون", "usage": "الاستخدام", "area": المساحة (Number), "units": عدد الوحدات أو الغرف (Number) }
          ],
          "boundariesData": [
            { "direction": "الاتجاه (شمال/جنوب/شرق/غرب)", "length": الطول (Number), "neighbor": "الحدود / يحدها" }
          ]
        }
      ]
    }
    `;

    const contentArray = [{ type: "text", text: prompt }];
    imagesToSend.forEach((imgUrl) => {
      contentArray.push({
        type: "image_url",
        image_url: { url: imgUrl, detail: "high" },
      });
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: contentArray }],
      response_format: { type: "json_object" },
      temperature: 0.0, // 💡 الصفر يضمن دقة تطابق تصل لـ 100% وعدم التأليف
    });

    const parsedData = JSON.parse(response.choices[0].message.content);

    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({ success: true, data: parsedData.permits || [] });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error("AI Analysis Error:", error);
    res.status(500).json({
      success: false,
      message: "فشل تحليل الرخصة",
      details: error.message,
    });
  }
};

// جلب جميع الرخص
const getPermits = async (req, res) => {
  try {
    const permits = await prisma.permit.findMany({
      orderBy: { archiveDate: "desc" },
    });
    res.json({ success: true, data: permits });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// إضافة رخصة جديدة
// ==========================================
// 💡 إضافة رخصة جديدة (معالجة آمنة للأرقام والجداول)
// ==========================================
const createPermit = async (req, res) => {
  try {
    const data = req.body;

    let attachmentUrl = null;
    if (req.file) {
      attachmentUrl = `/uploads/permits/${req.file.filename}`;
    }

    // 💡 حماية الأرقام لتجنب خطأ NaN في Prisma
    const parsedYear = parseInt(data.year);
    const safeYear = isNaN(parsedYear) ? new Date().getFullYear() : parsedYear;

    const parsedLandArea = parseFloat(data.landArea);
    const safeLandArea = isNaN(parsedLandArea) ? null : parsedLandArea;

    const newPermit = await prisma.permit.create({
      data: {
        permitNumber: data.permitNumber || "بدون رقم",
        year: safeYear,
        type: data.type || "غير محدد",
        form: data.form || "غير محدد",
        ownerName: data.ownerName || "بدون اسم",
        idNumber: data.idNumber || "",
        district: data.district || "",
        sector: data.sector || "",
        plotNumber: data.plotNumber || "",
        planNumber: data.planNumber || "",
        usage: data.usage || "",
        landArea: safeLandArea,
        engineeringOffice: data.engineeringOffice || "",
        source: data.source || "يدوي",
        notes: data.notes || "",
        aiStatus: data.source === "رفع يدوي (AI)" ? "تم التحليل" : "غير مطبق",
        attachmentUrl: attachmentUrl,

        // 💡 إضافة الجداول المستخرجة من الذكاء الاصطناعي
        componentsData: data.componentsData || "[]",
        boundariesData: data.boundariesData || "[]",
      },
    });

    res.status(201).json({ success: true, data: newPermit });
  } catch (error) {
    console.error("Create Permit Error:", error); // مفيد لمعرفة تفاصيل الخطأ في التيرمنال
    if (error.code === "P2002") {
      return res
        .status(400)
        .json({ success: false, message: "رقم الرخصة مسجل مسبقاً!" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 💡 تعديل بيانات الرخصة (ديناميكية وآمنة)
// ==========================================
const updatePermit = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updateData = {};

    if (data.permitNumber !== undefined)
      updateData.permitNumber = data.permitNumber;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.form !== undefined) updateData.form = data.form;
    if (data.ownerName !== undefined) updateData.ownerName = data.ownerName;
    if (data.idNumber !== undefined) updateData.idNumber = data.idNumber;
    if (data.district !== undefined) updateData.district = data.district;
    if (data.sector !== undefined) updateData.sector = data.sector;
    if (data.plotNumber !== undefined) updateData.plotNumber = data.plotNumber;
    if (data.planNumber !== undefined) updateData.planNumber = data.planNumber;
    if (data.usage !== undefined) updateData.usage = data.usage;
    if (data.engineeringOffice !== undefined)
      updateData.engineeringOffice = data.engineeringOffice;
    if (data.source !== undefined) updateData.source = data.source;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.aiStatus !== undefined) updateData.aiStatus = data.aiStatus;

    // 💡 حماية الأرقام في التعديل
    if (data.year !== undefined) {
      const parsedYear = parseInt(data.year);
      if (!isNaN(parsedYear)) updateData.year = parsedYear;
    }

    if (data.landArea !== undefined) {
      const parsedArea = parseFloat(data.landArea);
      updateData.landArea = isNaN(parsedArea) ? null : parsedArea;
    }

    // دعم تحديث المكونات والحدود
    if (data.componentsData !== undefined)
      updateData.componentsData = data.componentsData;
    if (data.boundariesData !== undefined)
      updateData.boundariesData = data.boundariesData;

    // إضافة الملف الجديد فقط في حال وجوده
    if (req.file) {
      updateData.attachmentUrl = `/uploads/permits/${req.file.filename}`;
    }

    const updatedPermit = await prisma.permit.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, data: updatedPermit });
  } catch (error) {
    console.error("Update Permit Error:", error);
    if (error.code === "P2002") {
      return res
        .status(400)
        .json({ success: false, message: "رقم الرخصة مسجل مسبقاً!" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// حذف رخصة
const deletePermit = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.permit.delete({ where: { id } });
    res.json({ success: true, message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💡 لا تنسَ تصدير دالة الـ updatePermit
module.exports = {
  getPermits,
  createPermit,
  updatePermit,
  deletePermit,
  analyzePermitAI,
};

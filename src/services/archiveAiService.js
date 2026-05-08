const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { decrypt } = require("../utils/cryptoUtils");

const prisma = new PrismaClient();

const SYSTEM_PROMPT = `
أنت مهندس استشاري وخبير قانوني عقاري في المملكة العربية السعودية، تعمل كنظام استخراج بيانات (Data Extractor) عالي الدقة.
مهمتك هي تحليل المستندات المرفقة للمشروع (رخص بناء، صكوك ملكية، كروكيات مساحية، تقارير، ومخططات) واستخراج البيانات المعمارية والقانونية المطلوبة بدقة متناهية.

القواعد الأساسية الصارمة:
1. استخرج البيانات بناءً على الهيكل المطلوب أدناه فقط.
2. إذا لم تكن المعلومة موجودة في المستندات، قم بإرجاع القيمة null للنصوص و 0 للأرقام.
3. الأرقام: حول أي رقم هندي (١،٢،٣) إلى إنجليزي (1,2,3).
4. المساحات والأطوال: استخرج الرقم فقط (Float).
5. تعدد الأسماء: إذا وجدت أكثر من مالك أو أكثر من مكتب هندسي، ضعهم جميعاً في المصفوفة (Array) ولا تحذف أحداً.

يجب أن يكون الناتج حصرياً بصيغة JSON متوافق تماماً مع هذا الهيكل:
{
  "title": "اسم المشروع أو وصفه العام المستنتج",
  "projectType": "سكني أو تجاري أو متعدد الاستخدامات أو صناعي",
  "transactionType": "إصدار رخصة، أو تعديل مكونات، أو إضافة ملحق، أو فرز...",
  "ownerNames": ["اسم المالك الأول", "اسم المالك الثاني"],
  "ownerType": "اعتباري (إذا كان شركة/مؤسسة) أو طبيعي (إذا كان أفراد)",
  "contactMobile": "أي رقم جوال مسجل للمالك",
  "poBox": "صندوق البريد أو الرمز البريدي إن وجد",
  "requestNumber": "رقم الطلب (إن وجد)",
  "requestYear": "سنة الطلب (إن وجدت)",
  "serviceNumber": "رقم الخدمة (إن وجد)",
  "serviceYear": "سنة الخدمة (إن وجدت)",
  "licenseNumber": "رقم رخصة البناء",
  "licenseHijriYear": "سنة إصدار الرخصة بالهجري (مثال: 1445) كـ String",
  "licenseIssueDate": "تاريخ إصدار الرخصة (YYYY-MM-DD)",
  "licenseExpiryDate": "تاريخ انتهاء الرخصة (YYYY-MM-DD)",
  "deedNumber": "رقم صك الملكية",
  "deedDate": "تاريخ الصك (YYYY-MM-DD)",
  "city": "المدينة (غالباً الرياض)",
  "sectorName": "القطاع الإداري الذي يقع فيه الحي (مثال: شمال، جنوب، شرق، غرب، وسط)",
  "districtName": "اسم الحي الذي يقع فيه المشروع",
  "planNumber": "رقم المخطط المعتمد",
  "plots": ["رقم القطعة الأولى", "رقم القطعة الثانية"],
  "mainStreet": "اسم الشارع الرئيسي وعرضه",
  "designerOfficeNames": ["المكتب المصمم الأول", "المكتب المصمم الثاني"],
  "supervisorOfficeNames": ["المكتب المشرف الأول"],
  "totalArea": 0,
  "coverageRatio": 0,
  "far": 0,
  "floorsAbove": 0,
  "floorsBelow": 0,
  "parkingRequired": 0,
  "parkingAvailable": 0,
  "boundaries": [
    { "direction": "شمالاً", "desc": "وصف الجار أو الشارع", "length": 0 }
  ],
  "floorAreas": [
    { "floor": "اسم الدور", "area": 0 }
  ],
  "setbacks": [
    { "direction": "الجهة", "required": 0, "implemented": 0, "status": "مطابق أو مخالف" }
  ],
  "archiveNotes": "ملاحظات عامة واحترافية اكتشفتها",
  "aiConfidence": 0
}
`;

exports.processArchiveJob = async (jobData, updateProgress) => {
  const { projectId } = jobData;
  const uploadedGeminiFiles = [];
  let ai; // 👈 تعريف متغير الذكاء الاصطناعي في الأعلى لنتمكن من مسح الملفات في الـ finally

  try {
    const systemSettings = await prisma.systemSettings.findUnique({
      where: { id: 1 },
    });
    const apiKey = systemSettings?.geminiApiKey
      ? decrypt(systemSettings.geminiApiKey)
      : process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey.trim() === "" || apiKey.includes("***")) {
      throw new Error("⚠️ مفتاح الذكاء الاصطناعي غير متوفر في إعدادات النظام.");
    }

    // 💡 حماية انقطاع الاتصال (Timeout Protection)
    // زيادة المهلة إلى دقيقتين بدلاً من 10 ثوانٍ للسماح برفع الملفات الكبيرة
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 120000 },
    });

    // 1. جلب المشروع والملفات
    const project = await prisma.archivedProject.findUnique({
      where: { id: projectId },
      include: { files: true },
    });

    if (!project || !project.files || project.files.length === 0) {
      throw new Error("لم يتم العثور على المشروع أو لا توجد ملفات لتحليلها.");
    }

    // ==========================================
    // 🛡️ الفلتر الذكي (AI Worker Shield)
    // ==========================================
    // نستبعد ملفات AutoCAD و Revit وغيرها، ونبقي فقط ما يفهمه الذكاء الاصطناعي
    const analyzableFiles = project.files.filter((file) => {
      if (!file.fileName) return false;
      const ext = file.fileName.split(".").pop().toLowerCase();
      // جوجل جيميناي يدعم فقط هذه الصيغ للتحليل البصري
      return ["pdf", "png", "jpg", "jpeg", "webp"].includes(ext);
    });

    if (analyzableFiles.length === 0) {
      throw new Error(
        "⚠️ تم الحفظ بنجاح، ولكن تم تخطي التحليل لعدم وجود ملفات مدعومة (PDF أو صور). تم تجاهل الملفات الهندسية.",
      );
    }

    await updateProgress(20);

    // 2. رفع الملفات المدعومة فقط لجوجل
    for (const file of analyzableFiles) {
      // 👈 التغيير هنا لاستخدام المصفوفة المفلترة
      const filePath = path.join(__dirname, "../../", file.fileUrl);
      if (fs.existsSync(filePath)) {
        const uploadResult = await ai.files.upload({
          file: filePath,
          mimeType: file.fileType,
          displayName: file.originalName,
        });
        uploadedGeminiFiles.push(uploadResult);
      }
    }

    if (uploadedGeminiFiles.length === 0)
      throw new Error("فشل رفع الملفات المحددة لجيميناي.");

    await updateProgress(50);

    // 3. التحدث مع جيميناي
    const fileParts = uploadedGeminiFiles.map((f) => ({
      fileData: { fileUri: f.uri, mimeType: f.mimeType },
    }));

    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [
        "يرجى تحليل جميع هذه المستندات واستخراج البيانات بصيغة JSON فقط.",
        ...fileParts,
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    await updateProgress(80);

    // 4. معالجة البيانات
    let responseText = response.text || "";
    responseText = responseText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const extractedData = JSON.parse(
      responseText.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)),
    );

    // --- معالجة البيانات الذكية (الأسماء، المكاتب، التكرار) ---
    const finalOwnerName =
      Array.isArray(extractedData.ownerNames) &&
      extractedData.ownerNames.length > 0
        ? extractedData.ownerNames.join(" - ")
        : extractedData.ownerName || "غير محدد";
    const isCompany = ["شركة", "مؤسسة", "مكتب", "بنك", "وزارة", "هيئة"].some(
      (kw) => finalOwnerName.includes(kw),
    );
    const finalOwnerType = isCompany ? "اعتباري (شركة)" : "طبيعي (أفراد)";

    const finalDesignerOffice =
      Array.isArray(extractedData.designerOfficeNames) &&
      extractedData.designerOfficeNames.length > 0
        ? extractedData.designerOfficeNames.join(" - ")
        : null;
    const finalSupervisorOffice =
      Array.isArray(extractedData.supervisorOfficeNames) &&
      extractedData.supervisorOfficeNames.length > 0
        ? extractedData.supervisorOfficeNames.join(" - ")
        : null;

    if (
      extractedData.licenseNumber &&
      typeof extractedData.licenseNumber === "string"
    ) {
      const parts = extractedData.licenseNumber.split(/\s*[\/\-]\s*/);
      if (parts.length === 2) {
        if (parts[1].trim().startsWith("14") && parts[1].trim().length === 4) {
          extractedData.licenseNumber = parts[0].trim();
          extractedData.licenseHijriYear = parts[1].trim();
        } else if (
          parts[0].trim().startsWith("14") &&
          parts[0].trim().length === 4
        ) {
          extractedData.licenseNumber = parts[1].trim();
          extractedData.licenseHijriYear = parts[0].trim();
        }
      }
    }

    // رادار التكرار الذكي
    let duplicateWarning = "";
    if (
      extractedData.licenseNumber &&
      String(extractedData.licenseNumber).trim() !== ""
    ) {
      const existingByLicense = await prisma.archivedProject.findFirst({
        where: {
          id: { not: projectId },
          licenseNumber: String(extractedData.licenseNumber).trim(),
        },
      });
      if (existingByLicense) {
        duplicateWarning += `⚠️ تنبيه تكرار قوي: تم العثور على مشروع مسجل مسبقاً برمز (${existingByLicense.archiveCode}) يحمل نفس رقم رخصة البناء!\n\n`;
      }
    }

    if (
      extractedData.planNumber &&
      Array.isArray(extractedData.plots) &&
      extractedData.plots.length > 0
    ) {
      const projectsWithSamePlan = await prisma.archivedProject.findMany({
        where: {
          id: { not: projectId },
          planNumber: String(extractedData.planNumber).trim(),
        },
      });
      const extractedPlotsStr = extractedData.plots.map((p) =>
        String(p).trim(),
      );
      for (const proj of projectsWithSamePlan) {
        const dbPlots = Array.isArray(proj.plots)
          ? proj.plots.map((p) => String(p).trim())
          : [];
        const hasOverlap = extractedPlotsStr.some((plot) =>
          dbPlots.includes(plot),
        );
        if (hasOverlap) {
          duplicateWarning += `⚠️ تنبيه تكرار موقع: تم العثور على مشروع سابق برمز (${proj.archiveCode}) يقع في نفس المخطط ويتقاطع في أرقام القطع!\n\n`;
          break;
        }
      }
    }
    const finalArchiveNotes =
      duplicateWarning + (extractedData.archiveNotes || "");

    // 5. حفظ البيانات في المشروع المؤرشف
    await prisma.archivedProject.update({
      where: { id: projectId },
      data: {
        title: extractedData.title || "مشروع مؤرشف (مستخرج آلياً)",
        projectType: extractedData.projectType || "غير محدد",
        transactionType: extractedData.transactionType,
        ownerName: finalOwnerName,
        designerOfficeName: finalDesignerOffice,
        supervisorOfficeName: finalSupervisorOffice,
        ownerType: finalOwnerType,
        sectorName: extractedData.sectorName,
        districtName: extractedData.districtName,
        contactMobile: extractedData.contactMobile,
        poBox: extractedData.poBox,
        requestNumber: extractedData.requestNumber
          ? String(extractedData.requestNumber)
          : null,
        requestYear: extractedData.requestYear
          ? String(extractedData.requestYear)
          : null,
        serviceNumber: extractedData.serviceNumber
          ? String(extractedData.serviceNumber)
          : null,
        serviceYear: extractedData.serviceYear
          ? String(extractedData.serviceYear)
          : null,
        licenseNumber: extractedData.licenseNumber,
        licenseHijriYear: extractedData.licenseHijriYear
          ? String(extractedData.licenseHijriYear)
          : null,
        licenseIssueDate: extractedData.licenseIssueDate
          ? new Date(extractedData.licenseIssueDate)
          : null,
        licenseExpiryDate: extractedData.licenseExpiryDate
          ? new Date(extractedData.licenseExpiryDate)
          : null,
        deedNumber: extractedData.deedNumber,
        deedDate: extractedData.deedDate
          ? new Date(extractedData.deedDate)
          : null,
        city: extractedData.city || "الرياض",
        planNumber: extractedData.planNumber,
        plots: extractedData.plots || [],
        mainStreet: extractedData.mainStreet,
        boundaries: extractedData.boundaries || [],
        totalArea: extractedData.totalArea,
        coverageRatio: extractedData.coverageRatio,
        far: extractedData.far,
        floorsAbove: extractedData.floorsAbove,
        floorsBelow: extractedData.floorsBelow,
        parkingRequired: extractedData.parkingRequired,
        parkingAvailable: extractedData.parkingAvailable,
        floorAreas: extractedData.floorAreas || [],
        setbacks: extractedData.setbacks || [],
        archiveNotes: finalArchiveNotes,
        aiConfidence: extractedData.aiConfidence || 0,
        aiStatus: "completed",
      },
    });

    // 6. إنشاء الرخصة التلقائية
    if (
      extractedData.licenseNumber &&
      extractedData.licenseNumber.trim() !== ""
    ) {
      try {
        const existingPermit = await prisma.permit.findFirst({
          where: {
            permitNumber: extractedData.licenseNumber,
            hijriYear: extractedData.licenseHijriYear
              ? String(extractedData.licenseHijriYear)
              : undefined,
          },
        });
        if (!existingPermit) {
          await prisma.permit.create({
            data: {
              permitNumber: extractedData.licenseNumber,
              hijriYear: extractedData.licenseHijriYear
                ? String(extractedData.licenseHijriYear)
                : null,
              issueDate: extractedData.licenseIssueDate
                ? String(extractedData.licenseIssueDate)
                : null,
              expiryDate: extractedData.licenseExpiryDate
                ? String(extractedData.licenseExpiryDate)
                : null,
              ownerName: finalOwnerName,
            },
          });
        }
      } catch (e) {
        console.error("Error creating auto-permit:", e.message);
      }
    }

    return { success: true, message: "تم الانتهاء من تحليل الأرشيف بنجاح." };
  } catch (error) {
    // تحديث حالة المشروع عند الفشل
    await prisma.archivedProject.update({
      where: { id: projectId },
      data: {
        aiStatus: "failed",
        archiveNotes: `رسالة النظام: ${error.message}`,
      },
    });
    throw error;
  } finally {
    // تنظيف الملفات من سيرفرات جوجل بشكل آمن
    if (ai && uploadedGeminiFiles.length > 0) {
      for (const file of uploadedGeminiFiles) {
        try {
          await ai.files.delete({ name: file.name });
        } catch (e) {
          console.error("خطأ أثناء مسح الملف من خوادم جوجل:", e.message);
        }
      }
    }
  }
};

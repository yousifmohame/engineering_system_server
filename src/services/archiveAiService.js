const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { decrypt } = require("../utils/cryptoUtils");

const prisma = new PrismaClient();

// 💡 دالة لتنظيف وتوحيد النصوص العربية لزيادة دقة المطابقة كخطة بديلة (Fallback)
const normalizeArabic = (text) => {
  if (!text) return "";
  return text
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ال/g, "")
    .replace(/(شركة|مؤسسة|مكتب|للاستشارات|الهندسية|حي|مخطط)/g, "")
    .replace(/\s+/g, "")
    .trim();
};

exports.processArchiveJob = async (jobData, updateProgress) => {
  const { projectId } = jobData;
  const uploadedGeminiFiles = [];
  let ai;

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

    ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 120000 }, // مهلة رفع واسعة للمخططات الكبيرة
    });

    const project = await prisma.archivedProject.findUnique({
      where: { id: projectId },
      include: { files: true },
    });

    if (!project || !project.files || project.files.length === 0) {
      throw new Error("لم يتم العثور على المشروع أو لا توجد ملفات لتحليلها.");
    }

    const analyzableFiles = project.files.filter((file) => {
      if (!file.fileName) return false;
      const ext = file.fileName.split(".").pop().toLowerCase();
      return ["pdf", "png", "jpg", "jpeg", "webp"].includes(ext);
    });

    if (analyzableFiles.length === 0) {
      throw new Error(
        "⚠️ تم تخطي التحليل لعدم وجود ملفات مدعومة (PDF أو صور).",
      );
    }

    await updateProgress(15);

    // =========================================================
    // 🧠 1. تجهيز عقل الذكاء الاصطناعي (Dynamic Context Injection)
    // =========================================================
    // نجلب أسماء الأحياء المعتمدة من قاعدة البيانات ونرسلها كدليل إرشادي لـ Gemini
    let validDistrictsList = "الرياض، العليا، الملقا، الياسمين"; // قيم افتراضية
    try {
      const allDistricts = await prisma.riyadhDistrict.findMany({
        select: { name: true },
      });
      if (allDistricts.length > 0) {
        validDistrictsList = allDistricts.map((d) => d.name).join("، ");
      }
    } catch (e) {
      console.warn("Could not load districts for AI prompt, using defaults.");
    }

    // بناء الـ Prompt الديناميكي
    const DYNAMIC_SYSTEM_PROMPT = `
أنت مهندس استشاري وخبير قانوني عقاري في المملكة العربية السعودية، تعمل كنظام استخراج بيانات (Data Extractor) عالي الدقة.
مهمتك هي تحليل المستندات المرفقة للمشروع واستخراج البيانات المعمارية والقانونية المطلوبة بدقة متناهية.

⚠️ قائمة الأحياء المعتمدة بالنظام:
[${validDistrictsList}]

القواعد الأساسية الصارمة:
1. استخراج الحي (districtName): ابحث في المستند، ثم اختر الاسم المطابق من "قائمة الأحياء المعتمدة" المرفقة أعلاه. (مثال: إذا قرأت "مخطط الملقى"، اكتب "الملقا" لتطابق القائمة).
2. استخرج البيانات بناءً على الهيكل المطلوب أدناه فقط. وإذا لم تكن المعلومة موجودة، قم بإرجاع القيمة null للنصوص و 0 للأرقام.
3. الأرقام: حول أي رقم هندي (١،٢،٣) إلى إنجليزي (1,2,3).
4. المساحات والأطوال: استخرج الرقم فقط (Float).

يجب أن يكون الناتج حصرياً بصيغة JSON متوافق تماماً مع هذا الهيكل:
{
  "title": "اسم المشروع أو وصفه العام المستنتج",
  "projectType": "سكني أو تجاري أو متعدد الاستخدامات أو صناعي",
  "transactionType": "إصدار رخصة، أو تعديل مكونات، أو إضافة ملحق، أو فرز...",
  "ownerNames": ["اسم المالك الأول"],
  "ownerType": "اعتباري (إذا كان شركة/مؤسسة) أو طبيعي (إذا كان أفراد)",
  "contactMobile": "أي رقم جوال مسجل للمالك",
  "poBox": "صندوق البريد أو الرمز البريدي إن وجد",
  "requestNumber": "رقم الطلب (إن وجد)",
  "requestYear": "سنة الطلب (إن وجدت)",
  "serviceNumber": "رقم الخدمة (إن وجد)",
  "serviceYear": "سنة الخدمة (إن وجدت)",
  "licenseNumber": "رقم رخصة البناء",
  "licenseHijriYear": "سنة إصدار الرخصة بالهجري",
  "licenseIssueDate": "تاريخ إصدار الرخصة (YYYY-MM-DD)",
  "licenseExpiryDate": "تاريخ انتهاء الرخصة (YYYY-MM-DD)",
  "deedNumber": "رقم صك الملكية",
  "deedDate": "تاريخ الصك (YYYY-MM-DD)",
  "city": "المدينة (غالباً الرياض)",
  "sectorName": "القطاع الإداري",
  "districtName": "اسم الحي المستخرج والمطابق للقائمة المعتمدة",
  "planNumber": "رقم المخطط المعتمد",
  "plots": ["رقم القطعة الأولى"],
  "mainStreet": "اسم الشارع الرئيسي وعرضه",
  "designerOfficeNames": ["المكتب المصمم الأول"],
  "supervisorOfficeNames": ["المكتب المشرف الأول"],
  "totalArea": 0,
  "coverageRatio": 0,
  "far": 0,
  "floorsAbove": 0,
  "floorsBelow": 0,
  "parkingRequired": 0,
  "parkingAvailable": 0,
  "boundaries": [{ "direction": "شمالاً", "desc": "وصف الجار", "length": 0 }],
  "floorAreas": [{ "floor": "اسم الدور", "area": 0 }],
  "setbacks": [{ "direction": "الجهة", "required": 0, "implemented": 0, "status": "مطابق أو مخالف" }],
  "archiveNotes": "ملاحظات عامة واحترافية",
  "aiConfidence": 0
}
`;

    // 2. رفع الملفات لجوجل
    for (const file of analyzableFiles) {
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
      throw new Error("فشل رفع الملفات لجيميناي.");
    await updateProgress(45);

    // 3. التحدث مع جيميناي باستخدام الـ Prompt الديناميكي
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
        systemInstruction: DYNAMIC_SYSTEM_PROMPT, // 👈 استخدام الـ Prompt الجديد
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    await updateProgress(70);

    // 4. معالجة البيانات وتنظيفها
    let responseText = response.text || "";
    responseText = responseText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const extractedData = JSON.parse(
      responseText.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)),
    );

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

    // رادار التكرار
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
        duplicateWarning += `⚠️ تنبيه تكرار قوي: مشروع مسبق برمز (${existingByLicense.archiveCode}) برقم الرخصة ذاته!\n\n`;
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
        if (extractedPlotsStr.some((plot) => dbPlots.includes(plot))) {
          duplicateWarning += `⚠️ تنبيه تكرار موقع: مشروع برمز (${proj.archiveCode}) يتقاطع في أرقام القطع!\n\n`;
          break;
        }
      }
    }
    const finalArchiveNotes =
      duplicateWarning + (extractedData.archiveNotes || "");

    // =========================================================
    // 🤖 5. الأتمتة العميقة للمطابقة والربط الآلي (Fuzzy Match Fallback)
    // =========================================================
    await updateProgress(85);

    let autoClientId = null;
    let autoDistrictId = null;
    let autoSectorId = null;
    let autoPlanId = null;
    let autoDesignerId = null;
    let autoSupervisorId = null;

    try {
      // -- ربط أو إنشاء المالك (العميل) --
      if (finalOwnerName && finalOwnerName !== "غير محدد") {
        const cleanOwner = normalizeArabic(finalOwnerName);
        const allClients = await prisma.client.findMany();
        const matchedClient = allClients.find((c) => {
          const cName = typeof c.name === "object" ? c.name?.ar : c.name;
          const cleanDb = normalizeArabic(cName);
          return (
            cleanDb === cleanOwner ||
            (cleanDb.length > 4 && cleanOwner.includes(cleanDb))
          );
        });

        if (matchedClient) {
          autoClientId = matchedClient.id;
        } else {
          const clientCount = await prisma.client.count();
          const currentYear = new Date().getFullYear();
          const sequentialNumber = String(clientCount + 1).padStart(3, "0");
          const autoClientCode = `CLT-${currentYear}-${sequentialNumber}`;

          const newClient = await prisma.client.create({
            data: {
              clientCode: autoClientCode,
              name: { ar: finalOwnerName, en: finalOwnerName },
              type: finalOwnerType,
              mobile:
                extractedData.contactMobile ||
                `05000${Math.floor(1000 + Math.random() * 9000)}`,
              idNumber: `10000${Math.floor(10000 + Math.random() * 90000)}`,
              contact: {
                email: "",
                phone: extractedData.contactMobile || "",
                address: extractedData.city || "الرياض",
              },
              identification: {
                age: null,
                birthPlace: "",
                hijriDate: "",
                gregorianDate: "",
              }, // 👈 إرضاء Prisma الصارم
            },
          });
          autoClientId = newClient.id;
        }
      }

      // -- ربط الحي وتحديد القطاع --
      if (extractedData.districtName) {
        const cleanDist = normalizeArabic(extractedData.districtName);
        const allDistricts = await prisma.riyadhDistrict.findMany();

        const matchedDist = allDistricts.find((d) => {
          const dNameClean = normalizeArabic(d.name);

          // 🛡️ درع الحماية: إذا كان الحي في الداتابيز فارغاً أو حرفاً واحداً، تجاهله تماماً!
          if (!dNameClean || dNameClean.length < 2) return false;

          return (
            dNameClean === cleanDist ||
            dNameClean.includes(cleanDist) ||
            cleanDist.includes(dNameClean)
          );
        });

        if (matchedDist) {
          autoDistrictId = matchedDist.id;
          autoSectorId = matchedDist.sectorId;
        }
      }
      // -- ربط أو إنشاء المخطط (بأرقام القطع) --
      if (extractedData.planNumber) {
        const planNumStr = String(extractedData.planNumber).trim();
        let plan = await prisma.riyadhPlan.findFirst({
          where: { planNumber: planNumStr },
        });

        if (!plan) {
          const count = await prisma.riyadhPlan.count();
          plan = await prisma.riyadhPlan.create({
            data: {
              planNumber: planNumStr,
              name: planNumStr,
              internalCode: `PLAN-${String(count + 1).padStart(3, "0")}`,
              status: "معتمد",
              city: extractedData.city || "الرياض",
            },
          });
        }
        autoPlanId = plan.id;
      }

      // -- ربط المكاتب الهندسية --
      const linkOffice = async (officeName) => {
        if (!officeName) return null;
        const cleanOffice = normalizeArabic(officeName);
        const allOffices = await prisma.intermediaryOffice.findMany();
        const matched = allOffices.find((o) => {
          const oName =
            o.nameAr ||
            (typeof o.name === "object" ? o.name?.ar : o.name) ||
            "";
          const cleanDb = normalizeArabic(oName);
          return (
            cleanDb === cleanOffice ||
            (cleanDb.length > 4 && cleanOffice.includes(cleanDb))
          );
        });

        if (matched) return matched.id;

        const newOffice = await prisma.intermediaryOffice.create({
          data: {
            nameAr: officeName,
            nameEn: officeName,
            commercialRegister: "0000000000",
            code: "TMP-" + Date.now() + Math.floor(Math.random() * 100),
          },
        });
        return newOffice.id;
      };

      autoDesignerId = await linkOffice(finalDesignerOffice);
      autoSupervisorId = await linkOffice(finalSupervisorOffice);
    } catch (autoLinkError) {
      console.error("Auto Linking Warning (Non-Fatal):", autoLinkError.message);
    }

    // =========================================================
    // 6. حفظ البيانات النهائية في المشروع
    // =========================================================
    await updateProgress(95);

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
        city: extractedData.city || "الرياض", // 👈 حماية الحقل الإجباري
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

        // 🚀 المعرفات التي ربطها الذكاء الاصطناعي بنجاح
        clientId: autoClientId,
        districtId: autoDistrictId,
        planId: autoPlanId,
        designerOfficeId: autoDesignerId,
        supervisorOfficeId: autoSupervisorId,
      },
    });

    // 7. إنشاء الرخصة التلقائية
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

    return {
      success: true,
      message: "تم الانتهاء من تحليل الأرشيف والمطابقة بنجاح.",
    };
  } catch (error) {
    await prisma.archivedProject.update({
      where: { id: projectId },
      data: {
        aiStatus: "failed",
        archiveNotes: `فشل التحليل: ${error.message}`,
      },
    });
    throw error;
  } finally {
    if (ai && uploadedGeminiFiles.length > 0) {
      for (const file of uploadedGeminiFiles) {
        try {
          await ai.files.delete({ name: file.name });
        } catch (e) {}
      }
    }
  }
};

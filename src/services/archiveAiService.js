const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { decrypt } = require("../utils/cryptoUtils");

const prisma = new PrismaClient();

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
      httpOptions: { timeout: 600000 },
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

    let validDistrictsList = "الرياض، العليا، الملقا، الياسمين";
    try {
      const allDistricts = await prisma.riyadhDistrict.findMany({
        select: { name: true },
      });
      if (allDistricts.length > 0)
        validDistrictsList = allDistricts.map((d) => d.name).join("، ");
    } catch (e) {
      console.warn("Could not load districts for AI prompt, using defaults.");
    }

    // 🚀 التعديل 1: السماح بأرقام القطع النصية والمخططات "بدون" في الـ Prompt
    const DYNAMIC_SYSTEM_PROMPT = `
أنت مهندس استشاري وخبير قانوني عقاري في المملكة العربية السعودية، تعمل كنظام استخراج بيانات (Data Extractor) عالي الدقة.
مهمتك هي تحليل المستندات المرفقة للمشروع واستخراج البيانات المعمارية والقانونية المطلوبة بدقة متناهية.

⚠️ قائمة الأحياء المعتمدة بالنظام:
[${validDistrictsList}]

القواعد الأساسية:
1. إذا كان المخطط مسجل باسم "بدون"، فاكتب "بدون" صراحة في الحقل planNumber. وإذا كان هناك "رمز" أو "بلك" مرافق له، اكتبه (مثال: "بدون - بلك أ").
2. أرقام القطع قد تكون أرقاماً (15, 16) أو نصوصاً وصفية (القطعة الشمالية، الجزء الغربي). استخرجها كما هي وضعها كمصفوفة نصوص في الحقل plots.
3. استخرج الحي (districtName) بما يطابق القائمة المرفقة.
4. إذا لم تكن المعلومة موجودة، أرجع null للنصوص و 0 للأرقام. حول الأرقام الهندية (١،٢) إلى إنجليزية (1,2).

يجب أن يكون الناتج حصرياً بصيغة JSON متوافق تماماً مع هذا الهيكل:
{
  "title": "اسم المشروع",
  "projectType": "سكني أو تجاري...",
  "transactionType": "إصدار رخصة...",
  "ownerNames": ["اسم المالك الأول"],
  "ownerType": "اعتباري أو طبيعي",
  "contactMobile": "رقم الجوال",
  "poBox": "صندوق البريد",
  "requestNumber": "رقم الطلب",
  "requestYear": "سنة الطلب",
  "serviceNumber": "رقم الخدمة",
  "serviceYear": "سنة الخدمة",
  "licenseNumber": "رقم رخصة البناء",
  "licenseHijriYear": "سنة الإصدار بالهجري",
  "licenseIssueDate": "تاريخ إصدار الرخصة",
  "licenseExpiryDate": "تاريخ انتهاء الرخصة",
  "deedNumber": "رقم الصك",
  "deedDate": "تاريخ الصك",
  "city": "المدينة",
  "sectorName": "القطاع",
  "districtName": "اسم الحي",
  "planNumber": "رقم المخطط أو كلمة 'بدون'",
  "plots": ["رقم القطعة 1", "القطعة الشمالية"],
  "mainStreet": "الشارع الرئيسي",
  "designerOfficeNames": ["المصمم"],
  "supervisorOfficeNames": ["المشرف"],
  "totalArea": 0,
  "coverageRatio": 0,
  "far": 0,
  "floorsAbove": 0,
  "floorsBelow": 0,
  "parkingRequired": 0,
  "parkingAvailable": 0,
  "boundaries": [{ "direction": "شمالاً", "desc": "وصف الجار", "length": 0 }],
  "floorAreas": [{ "floor": "اسم الدور", "area": 0 }],
  "setbacks": [{ "direction": "الجهة", "required": 0, "implemented": 0, "status": "مطابق" }],
  "archiveNotes": "ملاحظات",
  "aiConfidence": 0
}
`;

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
        systemInstruction: DYNAMIC_SYSTEM_PROMPT,
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    await updateProgress(70);

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
    const isCompany = ["شركة", "مؤسسة", "م مكتب", "بنك", "وزارة", "هيئة"].some(
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
      if (existingByLicense)
        duplicateWarning += `⚠️ تنبيه تكرار قوي: مشروع مسبق برمز (${existingByLicense.archiveCode}) برقم الرخصة ذاته!\n\n`;
    }

    // 🚀 التعديل 2: تحديد ما إذا كان المخطط "بدون" وإضافة رسالة تخزق العين في الملاحظات!
    let isWithoutPlan = false;
    let planNumStr = extractedData.planNumber
      ? String(extractedData.planNumber).trim()
      : null;

    if (
      planNumStr &&
      (planNumStr === "بدون" || planNumStr.includes("بدون مخطط"))
    ) {
      isWithoutPlan = true;
      duplicateWarning += `🛑 تنبيه هام وعاجل: هذا المخطط مصنف كـ "بدون". يتطلب النظام إدخال رمز المخطط من الخرائط الرسمية أو كود البلك لضمان عدم ضياع المعاملة!\n\n`;
    }

    const finalArchiveNotes =
      duplicateWarning + (extractedData.archiveNotes || "");

    await updateProgress(85);

    let autoClientId = null,
      autoDistrictId = null,
      autoSectorId = null,
      autoPlanId = null,
      autoDesignerId = null,
      autoSupervisorId = null;

    try {
      // -- ربط المالك --
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

        if (matchedClient) autoClientId = matchedClient.id;
        else {
          const clientCount = await prisma.client.count();
          const autoClientCode = `CLT-${new Date().getFullYear()}-${String(clientCount + 1).padStart(3, "0")}`;
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
              },
            },
          });
          autoClientId = newClient.id;
        }
      }

      // -- ربط الحي --
      if (extractedData.districtName) {
        const cleanDist = normalizeArabic(extractedData.districtName);
        const allDistricts = await prisma.riyadhDistrict.findMany();
        const matchedDist = allDistricts.find((d) => {
          const dNameClean = normalizeArabic(d.name);
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

      // -- 🚀 التعديل 3: المعالجة الذكية للمخطط (لا ننشئ مخطط "بدون" عشوائياً) --
      if (planNumStr) {
        if (isWithoutPlan) {
          // إذا كان بدون، سنحاول البحث عن مخطط مسبق تم تسجيله كـ "بدون" لربطه به مؤقتاً، أو نتركه فارغاً ليقوم المهندس بإجباره
          const existingWithoutPlan = await prisma.riyadhPlan.findFirst({
            where: { isWithout: true },
          });
          if (existingWithoutPlan) autoPlanId = existingWithoutPlan.id;
        } else {
          // مخطط عادي مرقم
          let plan = await prisma.riyadhPlan.findFirst({
            where: { planNumber: planNumStr },
          });
          if (!plan) {
            // 🚀 التصحيح: استخدام طابع زمني ورقم عشوائي لضمان عدم التكرار نهائياً
            const uniqueInternalCode = `PLAN-${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 1000)}`;

            plan = await prisma.riyadhPlan.create({
              data: {
                planNumber: planNumStr,
                internalCode: uniqueInternalCode,
                status: "معتمد",
              },
            });
          }
          autoPlanId = plan.id;
        }
      }

      // -- ربط المكاتب --
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
            city: extractedData.city || "الرياض",
          },
        });
        return newOffice.id;
      };
      autoDesignerId = await linkOffice(finalDesignerOffice);
      autoSupervisorId = await linkOffice(finalSupervisorOffice);
    } catch (autoLinkError) {
      console.error("Auto Linking Warning (Non-Fatal):", autoLinkError.message);
    }

    await updateProgress(95);

    // =========================================================
    // 🚀 التعديل 4: إنشاء القطع الحقيقية (Master Plots) والربط
    // =========================================================
    const validPlots = (extractedData.plots || []).filter((plotVal) => {
      const cleanVal = String(plotVal).trim();
      // استبعاد أي قطعة فارغة أو تحتوي على كلمات تدل على عدم وجودها
      return (
        cleanVal !== "" &&
        cleanVal !== "0" &&
        cleanVal.toLowerCase() !== "null" &&
        !cleanVal.includes("بدون") &&
        !cleanVal.includes("لا يوجد") &&
        !cleanVal.includes("غير محدد")
      );
    });

    let projectPlotsData = undefined;

    // إذا كان لدينا مخطط معتمد، وقطع حقيقية صالحة
    if (autoPlanId && validPlots.length > 0 && !isWithoutPlan) {
      const plotIdsToConnect = [];

      for (const plotNum of validPlots) {
        const cleanPlotNum = String(plotNum).trim();

        // 1. نبحث: هل القطعة موجودة مسبقاً في هذا المخطط؟
        let plotRecord = await prisma.riyadhPlanPlot.findUnique({
          where: {
            plotNumber_planId: { plotNumber: cleanPlotNum, planId: autoPlanId },
          },
        });

        // 2. إذا لم تكن موجودة: ننشئها ونعطيها كوداً مميزاً
        if (!plotRecord) {
          const autoCode = `PLT-${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 1000)}`;
          plotRecord = await prisma.riyadhPlanPlot.create({
            data: {
              plotNumber: cleanPlotNum,
              plotCode: autoCode,
              planId: autoPlanId,
            },
          });
        }

        // 3. نجهز ID القطعة الحقيقي لربطه بالمعاملة
        plotIdsToConnect.push({ plotId: plotRecord.id });
      }

      // 4. بناء هيكل الربط لقاعدة البيانات
      projectPlotsData = {
        deleteMany: {},
        create: plotIdsToConnect,
      };
    }

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
        plots: extractedData.plots || [], // نحتفظ بالنص كنسخة بسيطة دائماً
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
        archiveNotes: finalArchiveNotes, // 👈 هنا سيظهر التحذير الصارخ
        aiConfidence: extractedData.aiConfidence || 0,

        // 🚀 التعديل 5: تغيير الحالة إلى "معلق" (Pending) بدلاً من مكتمل إذا كان المخطط بدون لنجبر المستخدم على مراجعته
        aiStatus: isWithoutPlan ? "pending_review" : "completed",

        clientId: autoClientId || undefined,
        districtId: autoDistrictId || undefined,
        planId: autoPlanId || undefined,
        designerOfficeId: autoDesignerId || undefined,
        supervisorOfficeId: autoSupervisorId || undefined,

        projectPlots: projectPlotsData,
      },
    });

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

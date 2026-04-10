const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const aiService = require("../services/contractAiService");

// --------------------------------------------------------
// 1. عمليات البيانات (CRUD Operations)
// --------------------------------------------------------

exports.saveContract = async (req, res) => {
  try {
    const data = req.body;

    // 💡 حل مشكلة تكرار الـ Code
    let contractCode = data.code;
    if (contractCode) {
      const exists = await prisma.advancedContract.findUnique({
        where: { code: contractCode },
      });
      if (exists) {
        // توليد كود جديد إذا كان مكرراً
        contractCode = `ADV-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 100)}`;
      }
    } else {
      contractCode = `ADV-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 100)}`;
    }

    const savedContract = await prisma.advancedContract.create({
      data: {
        code: contractCode,
        name: data.name || "عقد غير مسمى",
        type: data.type || "عام",
        status: data.status || "مسودة",
        date: data.date ? new Date(data.date) : new Date(),

        partyA: data.partyA || "",
        partyB: data.partyB || "",
        partyADetails: data.partyADetails || {},
        partyBDetails: data.partyBDetails || {},

        projectDetails: data.projectDetails || {},
        terms: data.terms || "",
        activePresets: data.activePresets || [],

        financials: data.financials || {},
        contractValue: parseFloat(data.contractValue) || 0,
        paymentTerms: data.paymentTerms || "",
        paymentSchedule: data.paymentSchedule || [],

        introduction: data.introduction || "",
        obligationsList: data.obligationsList || [],
        generalConditions: data.generalConditions || "",
        governingLaw: data.governingLaw || "",
        witnesses: data.witnesses || [],

        coverSummary: data.coverSummary || "",
        aiSummary: data.aiSummary || "",
        aiRiskAssessment: data.aiRiskAssessment || "",
        isOnePageSummary: data.isOnePageSummary || false,

        frameSettings: data.frameSettings || {},
        spacingSettings: data.spacingSettings || {},
        typographySettings: data.typographySettings || {},
        coverSettings: data.coverSettings || {},
        verificationSettings: data.verificationSettings || {},
        qrSettings: data.qrSettings || {},
        approvalMethod: data.approvalMethod || "platform",
      },
    });

    res.status(201).json({ success: true, data: savedContract });
  } catch (error) {
    console.error("Save Contract Error:", error);
    res.status(500).json({ success: false, error: "حدث خطأ أثناء حفظ العقد" });
  }
};

exports.updateContract = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updatedContract = await prisma.advancedContract.update({
      where: { id: id },
      data: {
        name: data.name,
        type: data.type,
        status: data.status,
        date: data.date ? new Date(data.date) : undefined,

        partyA: data.partyA,
        partyB: data.partyB,
        partyADetails: data.partyADetails,
        partyBDetails: data.partyBDetails,

        projectDetails: data.projectDetails,
        terms: data.terms,
        activePresets: data.activePresets,

        financials: data.financials,
        contractValue: parseFloat(data.contractValue) || 0,
        paymentTerms: data.paymentTerms,
        paymentSchedule: data.paymentSchedule,

        introduction: data.introduction,
        obligationsList: data.obligationsList,
        generalConditions: data.generalConditions,
        governingLaw: data.governingLaw,
        witnesses: data.witnesses,

        coverSummary: data.coverSummary,
        aiSummary: data.aiSummary,
        aiRiskAssessment: data.aiRiskAssessment,
        isOnePageSummary: data.isOnePageSummary,

        frameSettings: data.frameSettings,
        spacingSettings: data.spacingSettings,
        typographySettings: data.typographySettings,
        coverSettings: data.coverSettings,
        verificationSettings: data.verificationSettings,
        qrSettings: data.qrSettings,
        approvalMethod: data.approvalMethod,
      },
    });

    res.status(200).json({ success: true, data: updatedContract });
  } catch (error) {
    console.error("Update Contract Error:", error);
    res
      .status(500)
      .json({ success: false, error: "حدث خطأ أثناء تحديث العقد" });
  }
};

exports.getAllContracts = async (req, res) => {
  try {
    const contracts = await prisma.advancedContract.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ success: true, data: contracts });
  } catch (error) {
    console.error("Get All Contracts Error:", error);
    res.status(500).json({ success: false, error: "حدث خطأ أثناء جلب العقود" });
  }
};

exports.getContractById = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await prisma.advancedContract.findUnique({
      where: { id: id },
    });
    if (!contract)
      return res.status(404).json({ success: false, error: "العقد غير موجود" });
    res.status(200).json({ success: true, data: contract });
  } catch (error) {
    res.status(500).json({ success: false, error: "حدث خطأ أثناء الجلب" });
  }
};

exports.deleteContract = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.advancedContract.delete({ where: { id: id } });
    res.status(200).json({ success: true, message: "تم الحذف" });
  } catch (error) {
    res.status(500).json({ success: false, error: "حدث خطأ أثناء الحذف" });
  }
};

// --------------------------------------------------------
// 2. عمليات الذكاء الاصطناعي (AI Operations)
// --------------------------------------------------------
exports.rephraseText = async (req, res) => {
  try {
    const { text, formality, length } = req.body;
    const rephrased = await aiService.rephraseText(text, formality, length);
    res.json({ success: true, rephrased });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.assessRisks = async (req, res) => {
  try {
    const { contractData } = req.body;
    const assessment = await aiService.assessRisks(contractData);
    res.json({ success: true, assessment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.generateSummary = async (req, res) => {
  try {
    const data = req.body;
    const summaryData = await aiService.generateSummary(data);
    res.json({ success: true, ...summaryData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

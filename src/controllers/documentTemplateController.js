const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// دالة مساعدة لتوليد كود فريد للمستند
const generateUniqueCode = async (category) => {
  const prefix = category === 'report' ? 'REP' : category === 'template' ? 'TPL' : 'DOC';
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `${prefix}-${dateStr}-${randomStr}`;
};

// دالة لتنظيف وتأمين البيانات القادمة من الفرونت اند
const sanitizeData = async (data, isNew = false) => {
  let code = data.code;
  if (isNew && (!code || code === '')) {
    code = await generateUniqueCode(data.category);
  }

  return {
    title: data.title || "مستند بدون عنوان",
    code: code,
    internalCode: data.internalCode || null,
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    pageSize: data.pageSize || "A4",
    orientation: data.orientation || "portrait",
    showPageNumber: Boolean(data.showPageNumber),
    showDate: Boolean(data.showDate),
    hideTableHeader: Boolean(data.hideTableHeader),
    sourceType: data.sourceType || "system",
    category: data.category || "document",
    securityLevel: data.securityLevel || "public",
    requiresApproval: Boolean(data.requiresApproval),
    preventPrintUnapproved: Boolean(data.preventPrintUnapproved),
    maxFileSize: parseInt(data.maxFileSize) || 10,
    allowMultiplePages: Boolean(data.allowMultiplePages),
    allowedSizes: Array.isArray(data.allowedSizes) ? data.allowedSizes : ["A4"],
    allowedOrientations: Array.isArray(data.allowedOrientations) ? data.allowedOrientations : ["portrait"],
    allowedExtensions: Array.isArray(data.allowedExtensions) ? data.allowedExtensions : [".pdf"],
    aiEnabled: Boolean(data.aiEnabled),
    readinessLevel: data.readinessLevel || "مكتمل",
    status: data.status || "نشطة",
    slaStages: Array.isArray(data.slaStages) ? data.slaStages : [],
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
    rules: Array.isArray(data.rules) ? data.rules : [],
    obligations: Array.isArray(data.obligations) ? data.obligations : [],
    notes: Array.isArray(data.notes) ? data.notes : [],
    exceptions: Array.isArray(data.exceptions) ? data.exceptions : [],
    price: parseFloat(data.price) || 0,
    duration: parseInt(data.duration) || 0,
    internalNotes: data.internalNotes || null
  };
};

exports.createTemplate = async (req, res) => {
  try {
    const validatedData = await sanitizeData(req.body, true);
    const newTemplate = await prisma.documentTemplate.create({
      data: validatedData
    });
    res.status(201).json(newTemplate);
  } catch (error) {
    console.error("Create Template Error:", error);
    res.status(400).json({ error: "فشل إنشاء المستند، قد يكون الرمز مكرراً.", details: error.message });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const validatedData = await sanitizeData(req.body, false);
    const updatedTemplate = await prisma.documentTemplate.update({
      where: { id: req.params.id },
      data: validatedData
    });
    res.status(200).json(updatedTemplate);
  } catch (error) {
    console.error("Update Template Error:", error);
    res.status(400).json({ error: "فشل تحديث المستند.", details: error.message });
  }
};

exports.getAllTemplates = async (req, res) => {
  try {
    const templates = await prisma.documentTemplate.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json(templates);
  } catch (error) {
    res.status(500).json({ error: "خطأ في جلب البيانات" });
  }
};

exports.getTemplateById = async (req, res) => {
  try {
    const template = await prisma.documentTemplate.findUnique({
      where: { id: req.params.id }
    });
    if (!template) return res.status(404).json({ error: "المستند غير موجود" });
    res.status(200).json(template);
  } catch (error) {
    res.status(500).json({ error: "خطأ في جلب بيانات المستند" });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    await prisma.documentTemplate.delete({
      where: { id: req.params.id }
    });
    res.status(200).json({ message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ error: "فشل الحذف" });
  }
};
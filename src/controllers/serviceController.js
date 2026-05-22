const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ==========================================
// إدارة الخدمات (Services) - الكود الكامل
// ==========================================

exports.getAllServices = async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      include: {
        stages: { orderBy: { order: "asc" } },
        checklists: true,
        requiredDocs: { include: { documentTemplate: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json(services);
  } catch (error) {
    res.status(500).json({ error: "فشل في جلب الخدمات" });
  }
};

exports.getServiceById = async (req, res) => {
  try {
    const service = await prisma.service.findUnique({
      where: { id: req.params.id },
      include: {
        stages: { orderBy: { order: "asc" } },
        checklists: true,
        requiredDocs: { include: { documentTemplate: true } },
      },
    });
    if (!service) return res.status(404).json({ error: "الخدمة غير موجودة" });
    res.status(200).json(service);
  } catch (error) {
    res.status(500).json({ error: "فشل في جلب تفاصيل الخدمة" });
  }
};

exports.createService = async (req, res) => {
  try {
    const data = req.body;
    const docIds = data.requiredDocs || [];

    // 1. التحقق من وجود المستندات فعلياً في قاعدة البيانات قبل الربط
    const existingDocs = await prisma.documentTemplate.findMany({
      where: { id: { in: docIds } },
      select: { id: true }
    });
    const validDocIds = existingDocs.map(d => d.id);

    // 2. إنشاء الخدمة
    const newService = await prisma.service.create({
      data: {
        name: data.name,
        code: data.code,
        pricingModel: data.pricingModel || "fixed",
        price: parseFloat(data.price) || 0,
        duration: parseInt(data.duration) || 0,
        mainCategory: data.mainCategory,
        subCategory: data.subCategory,
        description: data.description,
        inclusions: data.inclusions || [],
        exclusions: data.exclusions || [],
        deliverables: data.deliverables || [],
        tags: data.tags || [],
        targetAudience: data.targetAudience || {},
        isActive: data.isActive ?? true,
        visibility: data.visibility || "public",
        slaHours: parseInt(data.slaHours) || 24,
        internalNotes: data.internalNotes,

        requiredDocs: {
          create: validDocIds.map((docId) => ({
            documentTemplate: { connect: { id: docId } },
          })),
        },
        stages: {
          create: (data.stages || []).map((stage, index) => ({
            name: stage,
            order: index + 1,
          })),
        },
        checklists: {
          create: (data.checklists || []).map((item) => ({
            task: item,
            isMandatory: true,
          })),
        },
      },
    });

    res.status(201).json({ message: "تم إنشاء الخدمة بنجاح", service: newService });
  } catch (error) {
    console.error("Error creating service:", error);
    res.status(500).json({ error: "فشل في إنشاء الخدمة: " + error.message });
  }
};

exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const docIds = data.requiredDocs || [];

    const existingDocs = await prisma.documentTemplate.findMany({
      where: { id: { in: docIds } },
      select: { id: true }
    });
    const validDocIds = existingDocs.map(d => d.id);

    const updatedService = await prisma.$transaction(async (tx) => {
      await tx.serviceDocRequirement.deleteMany({ where: { serviceId: id } });
      await tx.serviceStage.deleteMany({ where: { serviceId: id } });
      await tx.serviceChecklist.deleteMany({ where: { serviceId: id } });

      return await tx.service.update({
        where: { id },
        data: {
          name: data.name,
          code: data.code,
          pricingModel: data.pricingModel,
          price: parseFloat(data.price) || 0,
          duration: parseInt(data.duration) || 0,
          mainCategory: data.mainCategory,
          subCategory: data.subCategory,
          description: data.description,
          inclusions: data.inclusions || [],
          exclusions: data.exclusions || [],
          deliverables: data.deliverables || [],
          tags: data.tags || [],
          targetAudience: data.targetAudience || {},
          isActive: data.isActive,
          visibility: data.visibility,
          slaHours: parseInt(data.slaHours) || 24,
          internalNotes: data.internalNotes,

          requiredDocs: {
            create: validDocIds.map((docId) => ({
              documentTemplate: { connect: { id: docId } },
            })),
          },
          stages: {
            create: (data.stages || []).map((stage, index) => ({
              name: stage,
              order: index + 1,
            })),
          },
          checklists: {
            create: (data.checklists || []).map((item) => ({
              task: item,
              isMandatory: true,
            })),
          },
        },
      });
    });

    res.status(200).json({ message: "تم تحديث الخدمة بنجاح", service: updatedService });
  } catch (error) {
    console.error("Error updating service:", error);
    res.status(500).json({ error: "فشل في تحديث الخدمة: " + error.message });
  }
};

exports.deleteService = async (req, res) => {
  try {
    await prisma.service.delete({ where: { id: req.params.id } });
    res.status(200).json({ message: "تم الحذف بنجاح" });
  } catch (error) {
    res.status(500).json({ error: "فشل في حذف الخدمة." });
  }
};
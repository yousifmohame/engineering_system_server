const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const saveTechnicalReport = async (req, res) => {
  try {
    const { id, transactionId, clientId, ownershipId, reportData, components, setbacks, compliance, settings, technicalNotes, status } = req.body;

    const payload = {
      transactionId: transactionId || null,
      clientId: clientId || null,
      ownershipId: ownershipId || null,
      reportData: reportData || {},
      components: components || [],
      setbacks: setbacks || [],
      compliance: compliance || {},
      settings: settings || {},
      technicalNotes: technicalNotes || "",
      status: status || "DRAFT"
    };

    let report;
    if (id) {
      report = await prisma.technicalReport.update({
        where: { id },
        data: payload
      });
    } else {
      const count = await prisma.technicalReport.count();
      const serialNumber = `REP-TECH-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
      
      report = await prisma.technicalReport.create({
        data: { ...payload, serialNumber }
      });
    }

    res.status(200).json(report);
  } catch (error) {
    console.error("Save Report Error:", error);
    res.status(500).json({ message: "فشل حفظ التقرير الفني" });
  }
};

// جلب جميع التقارير (لعرضها في القائمة)
const getAllTechnicalReports = async (req, res) => {
  try {
    const reports = await prisma.technicalReport.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        transaction: { select: { transactionCode: true } },
        client: { select: { name: true, officialNameAr: true } }
      }
    });
    res.status(200).json({ data: reports });
  } catch (error) {
    console.error("Get All Reports Error:", error);
    res.status(500).json({ message: "فشل جلب التقارير الفنية" });
  }
};

// جلب تقرير واحد بالتفصيل
const getTechnicalReportById = async (req, res) => {
  try {
    const { id } = req.params;
    const report = await prisma.technicalReport.findUnique({
      where: { id },
      include: {
        client: true,
        transaction: true,
        ownership: true
      }
    });

    if (!report) {
      return res.status(404).json({ message: "التقرير غير موجود" });
    }

    res.status(200).json({ data: report });
  } catch (error) {
    console.error("Get Report By ID Error:", error);
    res.status(500).json({ message: "فشل جلب التقرير" });
  }
};

// حذف تقرير
const deleteTechnicalReport = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.technicalReport.delete({ where: { id } });
    res.status(200).json({ message: "تم حذف التقرير بنجاح" });
  } catch (error) {
    res.status(500).json({ message: "فشل حذف التقرير" });
  }
};



module.exports = {
  saveTechnicalReport,
  getAllTechnicalReports,
  getTechnicalReportById,
  deleteTechnicalReport
};
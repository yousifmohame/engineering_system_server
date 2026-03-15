const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const getQuickEntries = async (req, res) => {
  try {
    const entries = await prisma.quickEntry.findMany({
      orderBy: [{ date: "desc" }, { time: "desc" }],
      include: { comments: true }, // 💡 تم تبسيط الاستعلام
    });
    res.json({ success: true, data: entries });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createQuickEntry = async (req, res) => {
  try {
    const { type, description, amount, relatedPerson, priority, recordedBy } =
      req.body;

    const count = await prisma.quickEntry.count();
    const entryCode = `QE-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

    const attachments = req.files
      ? req.files.map((f) => `/uploads/quick_entries/${f.filename}`)
      : [];

    const newEntry = await prisma.quickEntry.create({
      data: {
        entryCode,
        date: new Date(),
        time: new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        type,
        description,
        amount: amount ? parseFloat(amount) : null,
        relatedPerson,
        priority: priority || "normal",
        recordedBy: recordedBy || "موظف النظام", // 💡 حفظ الاسم
        attachments,
      },
    });
    res.status(201).json({ success: true, data: newEntry });
  } catch (error) {
    console.error("Create Quick Entry Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const processEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, processedBy, details } = req.body;

    const parsedDetails = JSON.parse(details);
    const newAttachments = req.files
      ? req.files.map((f) => `/uploads/quick_entries/${f.filename}`)
      : [];

    const updated = await prisma.quickEntry.update({
      where: { id },
      data: {
        status: "processed",
        processedBy: processedBy || "موظف النظام", // 💡 حفظ الاسم
        processedAt: new Date(),
        processedDetails: { ...parsedDetails, attachments: newAttachments },
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, author } = req.body;
    const comment = await prisma.quickEntryComment.create({
      data: {
        text,
        author: author || "مستخدم", // 💡 حفظ الاسم
        entryId: id,
      },
    });
    res.json({ success: true, data: comment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const undoProcessEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await prisma.quickEntry.update({
      where: { id },
      data: {
        status: "pending",
        processedBy: null,
        processedAt: null,
        processedDetails: null,
      },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteEntry = async (req, res) => {
  try {
    await prisma.quickEntry.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
};

module.exports = {
  getQuickEntries,
  createQuickEntry,
  processEntry,
  deleteEntry,
  addComment,
  undoProcessEntry,
};

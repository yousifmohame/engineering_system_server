// controllers/appointmentController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. إنشاء موعد جديد
// POST /api/appointments
const createAppointment = async (req, res) => {
  try {
    const { title, date, type, notes, status, transactionId } = req.body;

    const appointment = await prisma.appointment.create({
      data: {
        title,
        date: new Date(date), // تأكد من تحويل النص إلى تاريخ
        type,
        notes,
        status: status || 'scheduled',
        transaction: {
          connect: { id: transactionId }
        }
      }
    });

    res.status(201).json(appointment);
  } catch (error) {
    console.error("Error creating appointment:", error);
    res.status(500).json({ message: "فشل إنشاء الموعد", error: error.message });
  }
};

// 2. جلب مواعيد معاملة معينة
// GET /api/appointments/transaction/:transactionId
const getAppointmentsByTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const appointments = await prisma.appointment.findMany({
      where: { transactionId },
      orderBy: { date: 'asc' } // ترتيب تصاعدي حسب التاريخ
    });
    res.json(appointments);
  } catch (error) {
    console.error("Error fetching appointments:", error);
    res.status(500).json({ message: "فشل جلب المواعيد" });
  }
};

// 3. تحديث موعد
// PUT /api/appointments/:id
const updateAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, date, type, notes, status } = req.body;

    const updatedAppointment = await prisma.appointment.update({
      where: { id },
      data: {
        title,
        date: date ? new Date(date) : undefined,
        type,
        notes,
        status
      }
    });

    res.json(updatedAppointment);
  } catch (error) {
    console.error("Error updating appointment:", error);
    res.status(500).json({ message: "فشل تحديث الموعد" });
  }
};

// 4. حذف موعد
// DELETE /api/appointments/:id
const deleteAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.appointment.delete({
      where: { id }
    });
    res.json({ message: "تم حذف الموعد بنجاح" });
  } catch (error) {
    console.error("Error deleting appointment:", error);
    res.status(500).json({ message: "فشل حذف الموعد" });
  }
};

module.exports = {
  createAppointment,
  getAppointmentsByTransaction,
  updateAppointment,
  deleteAppointment
};
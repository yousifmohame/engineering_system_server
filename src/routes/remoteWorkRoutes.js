const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/transfers/" });

const {
  getRemoteWorkers,
  addRemoteWorker,
  editRemoteWorker,
  deleteRemoteWorker,
  assignTasks,
  addTransfer,
  getExchangeRates,
  updateExchangeRate,
  deleteTask, // 👈 استيراد دالة الحذف
  payTask,    // 👈 استيراد دالة الدفع
} = require("../controllers/remoteWorkController");

router.use(protect);

// مسارات المهام الجديدة (يجب وضعها قبل المسارات التي تحتوي على /:id)
router.post("/tasks/pay", payTask);            // 👈 مسار الدفع الجديد
router.delete("/tasks/:taskId", deleteTask);   // 👈 مسار الحذف الجديد
router.post("/assign-tasks", assignTasks);

// المسارات الأخرى
router.get("/exchange-rates", getExchangeRates);
router.put("/exchange-rates", updateExchangeRate);
router.post("/transfer", upload.single("file"), addTransfer);

router.get("/", getRemoteWorkers);
router.post("/", addRemoteWorker);
router.put("/:id", editRemoteWorker);    
router.delete("/:id", deleteRemoteWorker);

module.exports = router;
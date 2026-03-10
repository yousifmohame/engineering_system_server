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
} = require("../controllers/remoteWorkController");

router.use(protect);
router.get("/exchange-rates", getExchangeRates);
router.put("/exchange-rates", updateExchangeRate);
router.post("/assign-tasks", assignTasks);
router.post("/transfer", upload.single("file"), addTransfer);
router.get("/", getRemoteWorkers);
router.post("/", addRemoteWorker);
router.put("/:id", editRemoteWorker);    
router.delete("/:id", deleteRemoteWorker);

module.exports = router;

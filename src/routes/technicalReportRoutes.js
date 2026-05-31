const express = require("express");
const router = express.Router();
const {
  saveTechnicalReport,
  getAllTechnicalReports,
  deleteTechnicalReport,
  getTechnicalReportById,
} = require("../controllers/technicalReportController");

router.get("/", getAllTechnicalReports);
router.post("/", saveTechnicalReport);
router.delete("/:id", deleteTechnicalReport);
router.get("/:id", getTechnicalReportById);

module.exports = router;

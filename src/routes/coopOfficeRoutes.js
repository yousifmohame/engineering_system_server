const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/settlements/" });

const {
  getOffices,
  createOffice,
  updateOffice,
  deleteOffice
} = require("../controllers/coopOfficeController");

router.use(protect);
router.get("/", getOffices);
router.post("/", createOffice);
router.put("/:id", updateOffice);
router.delete("/:id", deleteOffice);

module.exports = router;

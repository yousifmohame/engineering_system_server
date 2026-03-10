const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/persons/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

const {
  getPersons,
  createPerson,
  updatePerson,
  deletePerson,
  removePersonAttachment, // 👈 استدعاء الدالة الجديدة
} = require("../controllers/personController");

router.use(protect);
router.get("/", getPersons);
router.post("/", upload.array("files", 5), createPerson);
router.put("/:id", upload.array("files", 5), updatePerson);
router.delete("/:id", deletePerson);

// 💡 مسار جديد لحذف المرفقات
router.put("/:id/attachments/remove", removePersonAttachment);

module.exports = router;

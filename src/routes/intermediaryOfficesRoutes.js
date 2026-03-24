const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const uploadAssets = multer({ dest: "uploads/assets/" }); // 👈 مجلد رفع الأصول

const {
  getOffices,
  createOffice,
  updateOffice,
  deleteOffice,
  toggleFreeze,
  addContact,
  deleteContact,
  addAsset,
  deleteAsset,
  addIntermediaryLink, deleteIntermediaryLink 
} = require("../controllers/intermediaryOfficesController");

router.use(protect);

router.get("/", getOffices);
router.post("/", createOffice);
router.put("/:id", updateOffice);
router.delete("/:id", deleteOffice);
router.patch("/:id/toggle-freeze", toggleFreeze);

// 💡 المسارات الجديدة لجهات الاتصال والمكونات:
router.post("/:id/contacts", addContact);
router.delete("/contacts/:contactId", deleteContact);

router.post("/:id/assets", uploadAssets.single("file"), addAsset);
router.delete("/assets/:assetId", deleteAsset);

router.post("/:id/intermediaries", addIntermediaryLink);
router.delete("/intermediaries/:linkId", deleteIntermediaryLink);

module.exports = router;

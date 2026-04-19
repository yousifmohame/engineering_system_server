const express = require("express");
const router = express.Router();
const fileRequestController = require("../controllers/fileRequestController");

// المسارات الحالية
router.get("/", fileRequestController.getRequests);
router.post("/", fileRequestController.createRequest);
router.post("/upload/:shortLink", fileRequestController.uploadClientFile);
router.get("/verify/:shortLink", fileRequestController.verifyLink);
// 💡 المسارات الجديدة للتعديل والحذف
router.put("/:id", fileRequestController.updateRequest);
router.delete("/:id", fileRequestController.deleteRequest);

module.exports = router;
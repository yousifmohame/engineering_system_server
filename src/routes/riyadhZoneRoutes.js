const express = require("express");
const router = express.Router();
const {
  getRiyadhZones,
  addDistrict,
  deleteDistrict,
} = require("../controllers/riyadhZoneController");
// يجب إضافة Middleware هنا للتأكد أن المستخدم Admin فقط!
router.get("/", getRiyadhZones);
router.post("/districts", addDistrict);
router.delete("/districts/:id", deleteDistrict);
module.exports = router;

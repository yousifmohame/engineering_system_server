const express = require("express");
const router = express.Router();
const {
  getRiyadhZones,
  addDistrict,
} = require("../controllers/riyadhZoneController");
// يجب إضافة Middleware هنا للتأكد أن المستخدم Admin فقط!
router.get("/", getRiyadhZones);
router.post("/districts", addDistrict);
module.exports = router;

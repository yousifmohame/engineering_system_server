const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { getSources, addSource, deleteSource } = require("../controllers/transactionSourceController");

router.get("/", protect, getSources);
router.post("/", protect, addSource);
router.delete("/:id", protect, deleteSource);

module.exports = router;
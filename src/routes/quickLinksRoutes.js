const express = require("express");
const router = express.Router();
const {
  getCategories,
  createCategory,
  deleteCategory,
  getAllLinks,
  createLink, // 👈 تمت إضافة دالة التعليقات
  updateLink,
  deleteLink,
  incrementUsage, // 👈 تمت إضافة دالة التراجع
} = require("../controllers/quickLinksController");
// Categories
router.get("/categories", getCategories);
router.post("/categories", createCategory);
router.delete("/categories/:id", deleteCategory);

// Links
router.get("/", getAllLinks);
router.post("/", createLink);
router.put("/:id", updateLink);
router.delete("/:id", deleteLink);
router.post("/:id/increment", incrementUsage);

module.exports = router;

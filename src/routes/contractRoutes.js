// routes/contractRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// استيراد الوظائف من الـ Controller
const {
  createContract,
  getAllContracts,
  getContractById,
  updateContract,
  deleteContract,
} = require('../controllers/contractController');

// حماية جميع مسارات العقود
router.use(protect);

// GET /api/contracts  -> جلب كل العقود
// POST /api/contracts -> إنشاء عقد جديد
router.route('/')
  .get(getAllContracts)
  .post(createContract);

// GET /api/contracts/:id    -> جلب عقد واحد
// PUT /api/contracts/:id    -> تحديث عقد
// DELETE /api/contracts/:id -> حذف عقد
router.route('/:id')
  .get(getContractById)
  .put(updateContract)
  .delete(deleteContract);

module.exports = router;
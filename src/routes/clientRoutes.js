// routes/clientRoutes.js
const express = require('express');
const router = express.Router();

// استيراد الوظائف الجديدة
const {
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient,
  getSimpleClients, // ✅ 1. استيراد الدالة الجديدة
} = require('../controllers/clientController');


router.route('/')
  .get(getAllClients)
  .post(createClient);

// ✅ 2. إضافة المسار المبسط الجديد هنا (قبل :id)
router.route('/simple')
  .get(getSimpleClients);

router.route('/:id')
  .get(getClientById)
  .put(updateClient)
  .delete(deleteClient); 

module.exports = router;
const express = require('express');
const router = express.Router();
const payrollController = require('../controllers/payrollController');

router.post('/generate', payrollController.generatePayroll);
router.get('/', payrollController.getPayrolls);
router.put('/:id', payrollController.updatePayroll);

module.exports = router;
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.get('/cash', protect, paymentController.getCashPayments);
router.get('/transaction/:transactionId', protect, paymentController.getPaymentsByTransaction);
router.post('/cash', protect, upload.single('receiptImage'), paymentController.createCashPayment);

module.exports = router;
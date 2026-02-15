// routes/transactionRoutes.js
const express = require('express');
const router = express.Router();

// --- 1. استيراد جميع الدوال ---
const {
  createTransaction,
  getAllTransactions,
  getTransactionById,
  updateTransaction,
  deleteTransaction,
  getTransactionTypes,
  createTransactionType,
  updateTransactionType,
  deleteTransactionType,
  getSimpleTransactionTypes,
  getFullTransactionTypes,
  getTemplateFees,
  updateTransactionTasks,
  updateTransactionStaff
} = require('../controllers/transactionController');



router.route('/')
  .get(getAllTransactions)
  .post(createTransaction);

router.route('/types/simple')
  .get(getSimpleTransactionTypes);

router.route('/types/full')
  .get(getFullTransactionTypes);

router.route('/types')
  .get(getTransactionTypes)
  .post(createTransactionType);

router.get('/template-fees/:typeId', getTemplateFees);

router.route('/types/:id')
  .put(updateTransactionType)
  .delete(deleteTransactionType);

router.route('/:id')
  .get(getTransactionById)
  .put(updateTransaction)
  .delete(deleteTransaction);

router.put('/:id/tasks', updateTransactionTasks);

router.put('/:id/staff', updateTransactionStaff);

module.exports = router;
// server/src/routes/quotationLibraryRoutes.js
const express = require('express');
const router = express.Router();
const libController = require('../controllers/quotationLibraryController');

// Items Routes
router.get('/items', libController.getItems);
router.post('/items', libController.saveItem);
router.patch('/items/:id/toggle', libController.toggleItemStatus);

// Bundles Routes
router.get('/bundles', libController.getBundles);
router.post('/bundles', libController.saveBundle);

module.exports = router;
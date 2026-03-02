const express = require('express');
const router = express.Router();
const controller = require('../controllers/riyadhStreetsController');

// const { protect } = require('../middleware/authMiddleware'); // فعل هذا السطر إذا كان لديك حماية

// ==========================================
// 1. الإحصائيات والبيانات العامة (Static Routes)
// ==========================================
router.get('/tree', controller.getDivisionTree);
router.get('/lookups', controller.getLookups);
router.get('/stats', controller.getStatistics);
router.get('/dashboard-stats', controller.getDashboardStats);

// ==========================================
// 2. إدارة القطاعات (Sectors)
// ==========================================
router.get('/sectors', controller.getSectorsList);
router.post('/sectors', controller.createSector);
router.put('/sectors/:id', controller.updateSector);
router.delete('/sectors/:id', controller.deleteSector);

// ==========================================
// 3. إدارة الأحياء (Districts)
// ==========================================
router.get('/districts', controller.getDistrictsList);
router.post('/districts', controller.createDistrict);
router.put('/districts/:id', controller.updateDistrict);
router.delete('/districts/:id', controller.deleteDistrict);

// ==========================================
// 4. إدارة المخططات (Plans)
// ==========================================
router.get('/plans', controller.getPlans);
router.post('/plans', controller.createPlan);
router.put('/plans/:id', controller.updatePlan);
router.delete('/plans/:id', controller.deletePlan);

// ==========================================
// 5. إدارة الشوارع (Streets)
// ==========================================
router.get('/', controller.getAllStreets);
router.post('/', controller.createStreet);
router.post('/quick-street', controller.createStreetQuick);
// ⚠️ المسارات الديناميكية الجذرية (Root Dynamic Params) دائماً توضع في نهاية الملف
router.put('/:id', controller.updateStreet); 
router.delete('/:id', controller.deleteStreet); 

module.exports = router;
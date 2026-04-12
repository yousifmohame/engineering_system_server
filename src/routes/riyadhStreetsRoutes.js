const express = require('express');
const router = express.Router();
const controller = require('../controllers/riyadhStreetsController');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// ==========================================
// ⚙️ إعدادات الرفع (Multer Configuration)
// ==========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/streets'; // المجلد الذي ستحفظ فيه الملفات
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true }); // إنشاء المجلد إن لم يكن موجوداً
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // إعادة تسمية الملف لمنع التكرار (إضافة طابع زمني)
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

// تعريف المتغير upload الذي كان يسبب الخطأ
const upload = multer({ storage });


// const { protect } = require('../middleware/authMiddleware'); // فعل هذا السطر إذا كان لديك حماية

// ==========================================
// 1. الإحصائيات والبيانات العامة (Static Routes)
// ==========================================
router.get('/tree', controller.getDivisionTree);
router.get('/lookups', controller.getLookups);
router.get('/stats', controller.getStatistics);
router.get('/dashboard-stats', controller.getDashboardStats);

// 🚀 مسار رفع الملفات (Media Upload) 🚀
router.post('/upload', upload.single('files'), controller.uploadMedia);

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
// 5. التابات التفصيلية (Drill-down Details)
// ==========================================
router.get('/details/:type/:id/:tab', controller.getNodeDetails);
router.post('/details/:type/:id/:tab', controller.addNodeDetail);

// ==========================================
// 6. إدارة الشوارع (Streets)
// ==========================================
router.get('/', controller.getAllStreets);
router.post('/', controller.createStreet);
router.post('/quick-street', controller.createStreetQuick);

// ⚠️ المسارات الديناميكية الجذرية (Root Dynamic Params) دائماً توضع في نهاية الملف
router.put('/:id', controller.updateStreet); 
router.delete('/:id', controller.deleteStreet); 

router.get('/plans/stats/overview', controller.getPlanStats);

module.exports = router;
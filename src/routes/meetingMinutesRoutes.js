const express = require("express");
const router = express.Router();
const minutesController = require("../controllers/meetingMinutesController");

// ==========================================
// 📄 مسارات إدارة محاضر الاجتماعات (CRUD)
// ==========================================

// جلب كل المحاضر
router.get("/", minutesController.getAllMinutes);

// جلب محضر محدد
router.get("/:id", minutesController.getMinuteById);

// إضافة محضر جديد
router.post("/", minutesController.createMinute);

// تحديث محضر (يستخدم للحفظ التلقائي والنهائي)
router.put("/:id", minutesController.updateMinute);

// حذف محضر
router.delete("/:id", minutesController.deleteMinute);


// ==========================================
// 🤖 مسار الذكاء الاصطناعي (المساعد الذكي للمحاضر)
// ==========================================
// ملاحظة: يمكنك نقل هذا المسار إلى ملف منفصل خاص بالذكاء الاصطناعي إذا أردت
router.post("/ai/generate", minutesController.generateAiContent);
// مسار التحقق العام للعملاء
router.get("/verify/:token", minutesController.verifyMinuteByToken);
module.exports = router;
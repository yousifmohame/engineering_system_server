const express = require("express");
const router = express.Router();
const emailController = require("../controllers/emailController");

// ==========================================
// 💡 مسارات حسابات البريد (Email Accounts)
// ==========================================

// جلب جميع حسابات البريد المربوطة
router.get("/accounts", emailController.getAccounts);

// إضافة حساب بريد جديد (Hostinger)
router.post("/accounts", emailController.addAccount);

router.delete('/accounts/:id', emailController.deleteAccount);

router.put('/accounts/:id', emailController.updateAccount);
// ==========================================
// 💡 مسارات رسائل البريد (Email Messages)
// ==========================================

// جلب جميع الرسائل (الواردة والصادرة)
router.get("/messages", emailController.getMessages);

// تحديث حالة رسالة معينة (مقروءة، مفضلة، مؤرشفة، سلة المهملات)
router.put("/messages/:id", emailController.updateMessageStatus);

// ==========================================
// 💡 مسارات إرسال البريد (Send Email)
// ==========================================

// إرسال رسالة جديدة عبر SMTP
router.post("/send", emailController.sendMessage);

router.get("/sync", emailController.syncHostingerEmails);

// إضافة هذا السطر لمسارات البريد
router.get('/analyze-inbox', emailController.analyzeInboxWithAI);

router.post('/messages/:id/analyze', emailController.analyzeEmail);
router.get('/messages/search', emailController.searchMessages);

module.exports = router;

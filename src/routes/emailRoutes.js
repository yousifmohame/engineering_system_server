const express = require("express");
const router = express.Router();
const emailController = require("../controllers/emailController");

// ==========================================
// 💡 مسارات حسابات البريد (Email Accounts)
// ==========================================
router.get("/accounts", emailController.getAccounts);
router.post("/accounts", emailController.addAccount);
router.delete('/accounts/:id', emailController.deleteAccount);
router.put('/accounts/:id', emailController.updateAccount);

// ==========================================
// 💡 مسارات العمليات المتنوعة والذكاء الاصطناعي
// ==========================================
router.post("/send", emailController.sendMessage);
router.get("/sync", emailController.syncHostingerEmails);
router.post("/search-ai", emailController.aiSmartSearch);
router.get('/analyze-inbox', emailController.analyzeInboxWithAI);
router.get('/messages/search', emailController.searchMessages); // 👈 يجب أن يكون قبل /:id
router.post("/ai-compose", emailController.aiComposeEmail);
router.post("/translate", emailController.translateWithAI);
router.get("/contacts", emailController.getAutoContacts);
router.post("/messages/draft", emailController.saveDraft);

// ==========================================
// 💡 مسارات رسائل البريد الأساسية (Email Messages)
// ==========================================
router.get("/messages", emailController.getMessages);
router.get("/messages/:id", emailController.getMessageDetails); // 👈 هذا هو المسار الذي كان مفقوداً (Lazy Loading)!

router.put("/messages/:id/status", emailController.updateMessageStatus);
router.put("/messages/:id", emailController.updateMessageStatus);
router.post('/messages/:id/analyze', emailController.analyzeEmail);
router.delete("/messages/:id/permanent", emailController.deleteMessagePermanently);

module.exports = router;
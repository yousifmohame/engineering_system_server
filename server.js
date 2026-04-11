require("dotenv").config();
const app = require("./src/app");
const prisma = require("./src/utils/prisma");
const fs = require("fs"); // ✅ استيراد نظام الملفات
const path = require("path");

const PORT = process.env.PORT || 5001;

// ✅ دالة لضمان وجود مجلدات الرفع قبل بدء السيرفر
function ensureUploadsDirectory() {
  // تعريف مسارات المجلدات
  const expenseDir = path.join(__dirname, "uploads", "expenses");
  const settlementDir = path.join(__dirname, "uploads", "settlements");
  const treasuryDir = path.join(__dirname, "uploads", "treasury");
  const disbursementsDir = path.join(__dirname, "uploads", "disbursements");
  const personsDir = path.join(__dirname, "uploads", "persons");
  const financeDir = path.join(__dirname, "uploads", "finance");
  const transfersDir = path.join(__dirname, "uploads", "transfers");
  const quick_entriesDir = path.join(__dirname, "uploads", "quick_entries");
  const assetsDir = path.join(__dirname, "uploads", "assets");
  const permitsDir = path.join(__dirname, "uploads", "permits");
  const tasksDir = path.join(__dirname, "uploads", "tasks");

  // مصفوفة تحتوي على كل المجلدات للتأكد من إنشائها
  const directories = [
    expenseDir,
    settlementDir,
    treasuryDir,
    disbursementsDir,
    personsDir,
    financeDir,
    transfersDir,
    quick_entriesDir,
    assetsDir,
    permitsDir,
    tasksDir
  ];

  directories.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }
  });
}

async function startServer() {
  try {
    // 1. التأكد من المجلدات
    ensureUploadsDirectory();

    // 2. التأكد من الاتصال بقاعدة البيانات
    await prisma.$connect();
    console.log("✅ Connected to Database Successfully");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to connect to database:", error);
    process.exit(1);
  }
}

startServer();

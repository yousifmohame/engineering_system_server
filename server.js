require("dotenv").config();
const app = require("./src/app");
const prisma = require("./src/utils/prisma");
const fs = require("fs"); // ✅ استيراد نظام الملفات
const path = require("path");

const PORT = process.env.PORT || 5001;

// ✅ دالة لضمان وجود مجلدات الرفع قبل بدء السيرفر
function ensureUploadsDirectory() {
  const uploadDir = path.join(__dirname, "uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('📁 Created "uploads" directory for AI Analysis');
  }
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

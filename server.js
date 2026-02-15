require('dotenv').config();
const app = require('./src/app');
const prisma = require('./src/utils/prisma');

const PORT = process.env.PORT || 5000;

async function startServer() {
    try {
        // التأكد من الاتصال بقاعدة البيانات
        await prisma.$connect();
        console.log('✅ Connected to Database Successfully');
        
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('❌ Failed to connect to database:', error);
        process.exit(1);
    }
}

startServer();
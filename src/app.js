// src/app.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");

const app = express();

// ==================================================
// 💡 إعدادات الأمان (Helmet)
// تم تعطيل frameguard للسماح بفتح الـ PDF داخل iframe في النظام
// ==================================================
app.use(
  helmet({
    crossOriginResourcePolicy: false, // 👈 مهم جداً ليعمل الـ iframe
    contentSecurityPolicy: false,
    frameguard: false, // 👈 تعطيل X-Frame-Options
  }),
);

app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// ==================================================
// 💡 نظام خدمة الملفات الاحترافي (Dynamic Streaming)
// ==================================================
const serveDynamicFile = (req, res, next) => {
  try {
    const decodedPath = decodeURIComponent(req.path);
    // تأكد أن المسار صحيح ويشير لمجلد uploads في الروت (خارج src)
    const filePath = path.join(__dirname, "../uploads", decodedPath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).send("الملف غير موجود");
    }

    // تحديد نوع الملف (MIME Type)
    let mimeType = "application/octet-stream";
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".pdf") mimeType = "application/pdf";
    else if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
    else if (ext === ".png") mimeType = "image/png";
    else if (ext === ".webp") mimeType = "image/webp";

    // 💡 1. إرسال الهيدرز الأمنية الصحيحة أولاً (تسمح بـ iframe)
    res.removeHeader("X-Frame-Options"); // تأكيد الإزالة
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", "inline"); // inline = عرض وليس تحميل

    // 💡 2. إرسال الملف (Streaming)
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (error) {
    console.error("File Server Error:", error);
    res.status(500).send("خطأ في السيرفر أثناء قراءة الملف");
  }
};

// 💡 ربط المسارات بدالة خدمة الملفات
app.use("/uploads", serveDynamicFile);
app.use("/api/uploads", serveDynamicFile); // المسار الذي يطلبه الفرونت إند غالباً

// ==================================================
// مسارات الـ API
// ==================================================
const authRoutes = require("./routes/authRoutes");
app.use("/api/auth", authRoutes);

const transactionRoutes = require("./routes/transactionRoutes");
app.use("/api/transactions", transactionRoutes);

const privateTransactionRoutes = require("./routes/privateTransactionRoutes");
app.use("/api/private-transactions", privateTransactionRoutes);

const privateSettlementRoutes = require("./routes/privateSettlementRoutes");
app.use("/api/private-settlements", privateSettlementRoutes);

const coopOfficeRoutes = require("./routes/coopOfficeRoutes");
app.use("/api/coop-offices", coopOfficeRoutes);

const coopOfficeFeeRoutes = require("./routes/coopOfficeFeeRoutes");
app.use("/api/coop-office-fees", coopOfficeFeeRoutes);

const officeExpenseRoutes = require("./routes/officeExpenseRoutes");
app.use("/api/office-expenses", officeExpenseRoutes);

const treasuryRoutes = require("./routes/treasuryRoutes");
app.use("/api/treasury", treasuryRoutes);

const bankAccountRoutes = require("./routes/bankAccountRoutes");
app.use("/api/bank-accounts", bankAccountRoutes);

const disbursementRoutes = require("./routes/disbursementRoutes");
app.use("/api/disbursements", disbursementRoutes);

const personRoutes = require("./routes/personRoutes");
app.use("/api/persons", personRoutes);

const financeRoutes = require("./routes/financeRoutes");
app.use("/api/finance", financeRoutes);

const financialDashboardRoutes = require("./routes/financialDashboardRoutes");
app.use("/api/financial-dashboard", financialDashboardRoutes);

const remoteWorkRoutes = require("./routes/remoteWorkRoutes");
app.use("/api/remote-workers", remoteWorkRoutes);

const quickEntryRoutes = require("./routes/quickEntryRoutes");
app.use("/api/quick-entries", quickEntryRoutes);

const intermediaryOfficesRoutes = require("./routes/intermediaryOfficesRoutes");
app.use("/api/intermediary-offices", intermediaryOfficesRoutes);

const permitRoutes = require("./routes/permitRoutes");
app.use("/api/permits", permitRoutes);

const clientRoutes = require("./routes/clientRoutes");
app.use("/api/clients", clientRoutes);

const settingsRoutes = require("./routes/settingsRoutes");
app.use("/api/settings", settingsRoutes);

const employeesRoutes = require("./routes/employeeRoutes");
app.use("/api/employees", employeesRoutes);

const projectRoutes = require("./routes/projectRoutes");
app.use("/api/projects", projectRoutes);

const roleRoutes = require("./routes/roleRoutes");
app.use("/api/roles", roleRoutes);

const permissionRoutes = require("./routes/permissionRoutes");
app.use("/api/permissions", permissionRoutes);

const permissionGroupRoutes = require("./routes/permissionGroupRoutes");
app.use("/api/permission-groups", permissionGroupRoutes);

const classificationRoutes = require("./routes/classificationRoutes");
app.use("/api/classifications", classificationRoutes);

const taskRoutes = require("./routes/taskRoutes");
app.use("/api/tasks", taskRoutes);

const contractRoutes = require("./routes/contractRoutes");
app.use("/api/contracts", contractRoutes);

const quotationRoutes = require("./routes/quotationRoutes");
app.use("/api/quotations", quotationRoutes);

const templateRoutes = require("./routes/quotationTemplateRoutes");
app.use("/api/quotation-templates", templateRoutes);

const quotationLibraryRoutes = require("./routes/quotationLibraryRoutes");
app.use("/api/quotation-library", quotationLibraryRoutes);

const appointmentRoutes = require("./routes/appointmentRoutes");
app.use("/api/appointments", appointmentRoutes);

const attachmentRoutes = require("./routes/attachmentRoutes");
app.use("/api/attachments", attachmentRoutes);

const documentRoutes = require("./routes/documentRoutes");
app.use("/api/documents", documentRoutes);

const documentTypeRoutes = require("./routes/documentTypeRoutes");
app.use("/api/document-types", documentTypeRoutes);

const docClassificationRoutes = require("./routes/docClassificationRoutes");
app.use("/api/document-classifications", docClassificationRoutes);

const dashboardRoutes = require("./routes/dashboardRoutes");
app.use("/api/dashboard", dashboardRoutes);

const paymentRoutes = require("./routes/paymentRoutes");
app.use("/api/payments", paymentRoutes);

const followUpRoutes = require("./routes/followUpRoutes");
app.use("/api/followup", followUpRoutes);

const riyadhStreetsRoutes = require("./routes/riyadhStreetsRoutes");
app.use("/api/riyadh-streets", riyadhStreetsRoutes);

const riyadhZoneRoutes = require("./routes/riyadhZoneRoutes");
app.use("/api/riyadh-zones", riyadhZoneRoutes);

const propertyRoutes = require("./routes/propertyRoutes");
app.use("/api/properties", propertyRoutes);

const serverRoutes = require("./routes/serverRoutes");
app.use("/api/server", serverRoutes);

// استيراد مسار الملفات
const fileManagerRoutes = require("./routes/fileManagerRoutes");
app.use("/api/files", fileManagerRoutes);

const formTemplateRoutes = require("./routes/formTemplateRoutes");
app.use("/api/forms", formTemplateRoutes);

const systemFilesRoutes = require("./routes/FileExplorerRoutes");
app.use("/api/system-files", systemFilesRoutes);

// 1. استدعاء ملف المسارات
const emailRoutes = require("./routes/emailRoutes");
app.use("/api/email", emailRoutes); // تأكد أن الـ Prefix يطابق ما طلبناه في الـ Frontend

const tailscaleRoutes = require("./routes/tailscaleRoutes");
app.use("/api/settings/tailscale", tailscaleRoutes);

const transactionSourceRoutes = require("./routes/transactionSourceRoutes");
app.use("/api/transaction-sources", transactionSourceRoutes);

const quickLinksRoutes = require("./routes/quickLinksRoutes");
app.use("/api/quick-links", quickLinksRoutes);

const referenceRoutes = require("./routes/referenceRoutes");
app.use("/api/references", referenceRoutes);

const contractsManagementRoutes = require("./routes/contractsManagementRoutes");
app.use("/api/contracts-management", contractsManagementRoutes);

const officeTasksRoutes = require("./routes/officeTasksRoutes");
app.use("/api/office-tasks", officeTasksRoutes);

const deviceRoutes = require("./routes/deviceRoutes");
app.use('/api/devices', deviceRoutes)
// فحص صحة السيرفر
app.get("/", (req, res) => {
  res.json({ status: "Online", message: "Engineering System API v1" });
});

module.exports = app;

// src/app.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");

const app = express();

// تعطيل سياسات الأمان التي تمنع عرض الـ PDF في المتصفح
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  }),
);

app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// ==================================================
// 💡 نظام خدمة الملفات الاحترافي (Dynamic Streaming)
// يكتشف نوع الملف من الداخل حتى لو لم يكن له امتداد
// ==================================================
const serveDynamicFile = (req, res, next) => {
  try {
    const decodedPath = decodeURIComponent(req.path);
    const filePath = path.join(__dirname, "../uploads", decodedPath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).send("الملف غير موجود");
    }

    // قراءة أول 4 بايت من الملف (Magic Bytes)
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);

    const hex = buffer.toString("hex").toUpperCase();
    let mimeType = "application/octet-stream";

    if (hex.startsWith("25504446")) mimeType = "application/pdf";
    else if (hex.startsWith("FFD8FF")) mimeType = "image/jpeg";
    else if (hex.startsWith("89504E47")) mimeType = "image/png";
    else {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".pdf") mimeType = "application/pdf";
      else if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
      else if (ext === ".png") mimeType = "image/png";
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", "inline"); // inline = عرض في المتصفح (لا تقم بالتحميل)

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (error) {
    console.error("File Server Error:", error);
    res.status(500).send("خطأ في السيرفر");
  }
};

// توجيه كل طلبات الملفات إلى الدالة الذكية
app.use("/uploads", serveDynamicFile);
app.use("/api/uploads", serveDynamicFile); // 👈 هذا هو المسار الذي سيطلبه الفرونت إند

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

// فحص صحة السيرفر
app.get("/", (req, res) => {
  res.json({ status: "Online", message: "Engineering System API v1" });
});

module.exports = app;

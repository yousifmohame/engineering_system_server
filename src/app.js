// src/app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');


const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);
const transactionRoutes = require('./routes/transactionRoutes');
app.use('/api/transactions', transactionRoutes);
const clientRoutes = require('./routes/clientRoutes');
app.use('/api/clients', clientRoutes);
const settingsRoutes = require('./routes/settingsRoutes');
app.use('/api/settings', settingsRoutes);
const employeesRoutes = require('./routes/employeeRoutes');
app.use('/api/employees', employeesRoutes);
const projectRoutes = require('./routes/projectRoutes');
app.use('/api/projects', projectRoutes);
const roleRoutes = require('./routes/roleRoutes');
app.use('/api/roles', roleRoutes);
const permissionRoutes = require('./routes/permissionRoutes');
app.use('/api/permissions', permissionRoutes);
const permissionGroupRoutes = require('./routes/permissionGroupRoutes');
app.use('/api/permission-groups', permissionGroupRoutes);
const classificationRoutes = require('./routes/classificationRoutes');
app.use('/api/classifications', classificationRoutes);
const taskRoutes = require('./routes/taskRoutes');
app.use('/api/tasks', taskRoutes);

const contractRoutes = require('./routes/contractRoutes');
app.use('/api/contracts', contractRoutes);

const quotationRoutes = require('./routes/quotationRoutes');
app.use('/api/quotations', quotationRoutes);

const appointmentRoutes = require('./routes/appointmentRoutes');
app.use('/api/appointments', appointmentRoutes);

const attachmentRoutes = require('./routes/attachmentRoutes');
app.use('/api/attachments', attachmentRoutes);

const documentRoutes = require('./routes/documentRoutes');
app.use('/api/documents', documentRoutes);

const docClassificationRoutes = require('./routes/docClassificationRoutes');
app.use('/api/document-classifications', docClassificationRoutes);

const dashboardRoutes = require('./routes/dashboardRoutes');
app.use('/api/dashboard', dashboardRoutes);

const paymentRoutes = require('./routes/paymentRoutes');
app.use('/api/payments', paymentRoutes);

const followUpRoutes = require('./routes/followUpRoutes');
app.use('/api/followup', followUpRoutes);

const riyadhStreetsRoutes = require('./routes/riyadhStreetsRoutes');
app.use('/api/riyadh-streets', riyadhStreetsRoutes);

const propertyRoutes = require('./routes/propertyRoutes');
app.use('/api/properties', propertyRoutes);


// فحص صحة السيرفر
app.get('/', (req, res) => {
  res.json({ status: 'Online', message: 'Engineering System API v1' });
});

module.exports = app;
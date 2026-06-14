// controllers/jobOfferController.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");
const axios = require("axios"); // 👈 أضف هذا
const FormData = require("form-data"); // 👈 أضف هذا
// ===============================================
// 1. إنشاء عرض وظيفي جديد
// POST /api/hr/job-offers
// ===============================================
const createJobOffer = async (req, res) => {
  try {
    const {
      jobTitle,
      candidateName,
      candidateEmail,
      candidatePhone,
      introduction,
      basicSalary,
      allowances,
      conditions,
      status
    } = req.body;

    const createdById = req.user?.id || req.employee?.id;

    if (!createdById) {
      return res.status(401).json({ message: "غير مصرح لك بالقيام بهذه العملية" });
    }

    // تجهيز مسارات الملفات المرفوعة إن وجدت (غلاف أمامي، خلفي، سيرة ذاتية)
    const files = req.files || {};
    const frontCoverPath = files.frontCover ? `/uploads/hr/offers/${files.frontCover[0].filename}` : null;
    const backCoverPath = files.backCover ? `/uploads/hr/offers/${files.backCover[0].filename}` : null;
    const cvFilePath = files.cvFile ? `/uploads/hr/offers/${files.cvFile[0].filename}` : null;

    const newOffer = await prisma.jobOffer.create({
      data: {
        jobTitle,
        candidateName,
        candidateEmail,
        candidatePhone,
        introduction,
        basicSalary: parseFloat(basicSalary),
        allowances: allowances ? JSON.parse(allowances) : null,
        conditions,
        status: status || "DRAFT",
        frontCoverPath,
        backCoverPath,
        cvFilePath,
        createdBy: { connect: { id: createdById } }
      },
    });

    res.status(201).json({ message: "تم إنشاء العرض الوظيفي بنجاح", data: newOffer });
  } catch (error) {
    console.error("Error creating job offer:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إنشاء العرض الوظيفي" });
  }
};

// ===============================================
// 2. جلب جميع العروض الوظيفية
// GET /api/hr/job-offers
// ===============================================
const getAllJobOffers = async (req, res) => {
  try {
    const offers = await prisma.jobOffer.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { name: true, employeeCode: true } },
        employee: { select: { id: true, name: true } } // لجلب الموظف إذا تم ربطه
      }
    });
    res.status(200).json(offers);
  } catch (error) {
    console.error("Error fetching job offers:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب العروض الوظيفية" });
  }
};

// ===============================================
// 3. جلب تفاصيل عرض وظيفي واحد
// GET /api/hr/job-offers/:id
// ===============================================
const getJobOfferById = async (req, res) => {
  try {
    const { id } = req.params;
    const offer = await prisma.jobOffer.findUnique({
      where: { id },
      include: {
        createdBy: { select: { name: true } },
        employee: { select: { id: true, name: true, employeeCode: true } }
      }
    });

    if (!offer) return res.status(404).json({ message: "العرض الوظيفي غير موجود" });

    res.status(200).json(offer);
  } catch (error) {
    console.error("Error fetching job offer details:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب تفاصيل العرض" });
  }
};

// ===============================================
// 4. تسجيل قبول الموظف (رفع العرض الموقع)
// POST /api/hr/job-offers/:id/accept
// ===============================================
const acceptJobOffer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: "يجب إرفاق ملف العرض الوظيفي الموقع" });
    }

    const offer = await prisma.jobOffer.findUnique({ where: { id } });
    if (!offer) {
      fs.unlinkSync(req.file.path); // مسح الملف المرفوع إذا العرض غير موجود
      return res.status(404).json({ message: "العرض الوظيفي غير موجود" });
    }

    const signedOfferPath = `/uploads/hr/offers/${req.file.filename}`;

    const updatedOffer = await prisma.jobOffer.update({
      where: { id },
      data: {
        status: "ACCEPTED",
        signedOfferPath
      }
    });

    // إرجاع البيانات حتى نتمكن في الواجهة الأمامية من توجيه المستخدم 
    // لصفحة "إضافة موظف جديد" وتعبئة البيانات تلقائياً
    res.status(200).json({ 
      message: "تم تسجيل القبول ورفع الملف بنجاح، يرجى استكمال بيانات الموظف", 
      data: updatedOffer 
    });
  } catch (error) {
    console.error("Error accepting job offer:", error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: "حدث خطأ أثناء تسجيل قبول الموظف" });
  }
};

// ===============================================
// 5. توليد PDF احترافي للعرض الوظيفي عبر Gotenberg
// POST /api/hr/job-offers/generate-pdf
// ===============================================
const generateJobOfferPdf = async (req, res) => {
  try {
    const data = req.body;

    const {
      candidateName,
      jobTitle,
      basicSalary,
      housingAllowance,
      transportAllowance,
      introduction,
      conditions,
      issueDate
    } = data;

    // حساب الإجمالي
    const totalSalary = Number(basicSalary || 0) + Number(housingAllowance || 0) + Number(transportAllowance || 0);
    const displayIssueDate = issueDate || new Date().toLocaleDateString("ar-SA", { year: "numeric", month: "2-digit", day: "2-digit" });

    // الروابط المطلقة للصور (تأكد من تعديل الدومين ليتوافق مع سيرفرك)
    const logoUrl = "https://details-worksystem1.com/logo.jpeg";
    const bgUrl = "https://details-worksystem1.com/safe_background/1.webp";

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
        <style>
          @page { size: A4; margin: 0; }
          body { 
            font-family: 'Tajawal', sans-serif; 
            margin: 0; padding: 0; color: #123f59; 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important;
            background-color: #e8edf0;
          }
          .page-container {
            width: 794px; min-height: 1123px; padding: 60px 70px;
            box-sizing: border-box; background-color: #ffffff;
            position: relative; page-break-after: always;
            overflow: hidden;
          }
          .bg-layer {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0;
            background-image: url('${bgUrl}');
            background-size: 794px 1123px; background-repeat: repeat-y;
            z-index: 0; opacity: 0.05;
          }
          .content { position: relative; z-index: 1; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
          th, td { border: 1px solid #123f59; padding: 12px; text-align: center; }
          th { background-color: #123f59; color: #fff; font-weight: 900; }
          .text-right { text-align: right; }
          .bg-slate-50 { background-color: #f8fafc; }
          .text-slate-500 { color: #64748b; }
          .font-bold { font-weight: bold; }
          .font-black { font-weight: 900; }
          .font-mono { font-family: monospace; }
        </style>
      </head>
      <body>
        
        <div class="page-container" style="display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 80px;">
          <div class="bg-layer"></div>
          <div class="content" style="width: 100%;">
            <div style="width: 250px; margin: 0 auto 60px auto;">
              <img src="${logoUrl}" alt="Logo" style="max-width: 100%; mix-blend-mode: multiply;" />
            </div>

            <div style="width: 80%; margin: 0 auto; border-top: 5px solid #123f59; border-bottom: 5px solid #123f59; padding: 40px 0; margin-bottom: 50px;">
              <h1 style="font-size: 46px; font-weight: 900; color: #123f59; margin: 0 0 16px 0;">عرض وظيفي</h1>
              <h2 style="font-size: 24px; font-weight: bold; color: #475569; margin: 0; letter-spacing: 2px;">Job Offer</h2>
            </div>

            <div style="width: 100%; text-align: right; background-color: rgba(255,255,255,0.8); padding: 30px; border-radius: 24px; border: 1px solid rgba(216,180,106,0.3); box-sizing: border-box;">
              <p style="font-size: 18px; font-weight: 900; color: #64748b; margin-top: 0; margin-bottom: 12px;">مقدم إلى المرشح:</p>
              <p style="font-size: 36px; font-weight: 900; color: #123f59; margin-top: 0; margin-bottom: 32px;">${candidateName || "........................"}</p>

              <table style="border: none; font-size: 16px; font-weight: bold; color: #334155; margin-bottom: 0;">
                <tr>
                  <td style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 8px 0; width: 50%;"><span style="color: #64748b;">المسمى الوظيفي:</span> <span style="color: #123f59; font-weight: 900;">${jobTitle || "---"}</span></td>
                  <td style="border: none; text-align: right; border-bottom: 1px dashed #cbd5e1; padding: 8px 0; width: 50%;"><span style="color: #64748b;">التاريخ:</span> <span style="color: #123f59;" class="font-mono">${displayIssueDate}</span></td>
                </tr>
              </table>
            </div>
          </div>
        </div>

        <div class="page-container" style="padding: 0;">
          <div class="bg-layer"></div>
          
          <table style="width: 100%; border: none; margin: 0; position: relative; z-index: 1;">
            <thead style="display: table-header-group;">
              <tr>
                <td style="border: none; padding: 60px 70px 20px 70px;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #123f59; padding-bottom: 16px;">
                    <img src="${logoUrl}" alt="Logo" style="height: 64px; mix-blend-mode: multiply;" />
                    <div style="text-align: right; font-size: 11px; font-weight: bold; color: #64748b;">
                      <p style="margin: 0 0 4px 0;">نوع المستند: <span style="color: #123f59; font-weight: 900; font-size: 13px;">عرض وظيفي رسمي</span></p>
                      <p style="margin: 0;">التاريخ: <span style="color: #123f59; font-weight: 900;" class="font-mono">${displayIssueDate}</span></p>
                    </div>
                  </div>
                </td>
              </tr>
            </thead>

            <tbody style="display: table-row-group;">
              <tr>
                <td style="border: none; padding: 10px 70px 20px 70px;">
                  
                  <div style="text-align: right; font-weight: bold; color: #475569; font-size: 13px; line-height: 2; white-space: pre-wrap; margin-bottom: 32px;">${introduction}</div>

                  <h4 style="color: #123f59; font-size: 14px; font-weight: 900; margin-bottom: 12px; text-align: right;">أولاً: التفاصيل المالية والمزايا</h4>
                  <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 13px; margin-bottom: 32px;">
                    <thead>
                      <tr>
                        <th>البيان</th>
                        <th>القيمة (ر.س)</th>
                        <th>دورة الصرف</th>
                      </tr>
                    </thead>
                    <tbody class="font-bold text-[#123f59]">
                      <tr class="bg-slate-50">
                        <td class="text-right" style="padding-right: 16px;">الراتب الأساسي</td>
                        <td class="font-mono">${basicSalary || 0}</td>
                        <td>شهرياً</td>
                      </tr>
                      <tr>
                        <td class="text-right" style="padding-right: 16px;">بدل السكن</td>
                        <td class="font-mono">${housingAllowance || 0}</td>
                        <td>شهرياً</td>
                      </tr>
                      <tr class="bg-slate-50">
                        <td class="text-right" style="padding-right: 16px;">بدل النقل</td>
                        <td class="font-mono">${transportAllowance || 0}</td>
                        <td>شهرياً</td>
                      </tr>
                      <tr style="background-color: #ecfdf5; color: #065f46; font-size: 14px;">
                        <td class="text-right font-black" style="padding-right: 16px;">إجمالي الراتب الشهري</td>
                        <td colspan="2" class="font-mono font-black">${totalSalary} ر.س</td>
                      </tr>
                    </tbody>
                  </table>

                  <div style="page-break-inside: avoid;">
                    <h4 style="color: #123f59; font-size: 14px; font-weight: 900; margin-bottom: 12px; text-align: right;">ثانياً: الشروط والأحكام العامة</h4>
                    <div style="background-color: #f8fafc; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0; text-align: right; font-weight: bold; color: #475569; font-size: 12.5px; line-height: 2; white-space: pre-wrap; margin-bottom: 40px;">${conditions}</div>
                  </div>

                  <div style="page-break-inside: avoid;">
                    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 12px; border: 2px solid #123f59;">
                      <thead>
                        <tr>
                          <th style="width: 50%; border-left: 1px solid #123f5944;">الطرف الأول (الشركة)</th>
                          <th style="width: 50%;">الطرف الثاني (المرشح)</th>
                        </tr>
                      </thead>
                      <tbody class="font-bold text-[#123f59]">
                        <tr>
                          <td style="padding: 16px; vertical-align: top; text-align: right; border-left: 1px solid #123f5944; border-bottom: none;">
                            <p style="margin: 0 0 8px 0; color: #64748b;">اسم الشركة: <span style="color: #123f59; font-weight: 900;">شركة ديتيلز كونسولتس</span></p>
                            <p style="margin: 0 0 24px 0; color: #64748b;">الختم والتوقيع:</p>
                            <div style="height: 64px; text-align: center; color: #cbd5e1;">مساحة الختم</div>
                          </td>
                          <td style="padding: 16px; vertical-align: top; text-align: right; border-bottom: none;">
                            <p style="margin: 0 0 8px 0; color: #64748b;">الاسم: <span style="color: #123f59; font-weight: 900;">${candidateName || "........................"}</span></p>
                            <p style="margin: 0 0 24px 0; color: #64748b;">توقيع القبول:</p>
                            <div style="height: 64px; text-align: center; color: #cbd5e1;">........................</div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </body>
      </html>
    `;

    const form = new FormData();
    form.append("files", Buffer.from(htmlContent, "utf-8"), {
      filename: "index.html",
      contentType: "text/html",
    });
    form.append("paperWidth", "8.27");
    form.append("paperHeight", "11.69");
    form.append("marginTop", "0");
    form.append("marginBottom", "0");
    form.append("marginLeft", "0");
    form.append("marginRight", "0");
    form.append("printBackground", "true");
    form.append("waitDelay", "1.5s");

    // طلب التحويل من سيرفر Gotenberg
    const response = await axios.post(
      "http://127.0.0.1:3000/forms/chromium/convert/html",
      form,
      {
        headers: { ...form.getHeaders() },
        responseType: "arraybuffer",
      },
    );

    const pdfBuffer = Buffer.from(response.data);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": pdfBuffer.length,
      "Content-Disposition": `attachment; filename="JobOffer-${Date.now()}.pdf"`,
    });

    res.send(pdfBuffer);
  } catch (error) {
    console.error(
      "Error generating Job Offer PDF with Gotenberg:",
      error?.response?.data?.toString() || error.message,
    );
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء توليد ملف الـ PDF عبر Gotenberg",
    });
  }
};

module.exports = {
  createJobOffer,
  getAllJobOffers,
  getJobOfferById,
  acceptJobOffer,
  generateJobOfferPdf
};
const fs = require('fs');
const { GoogleGenAI } = require("@google/genai");

// تهيئة العميل
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 1. بناء الهيكلية الشاملة (JSON Schema) المدعومة من Gemini
const ContractSchema = {
  type: "OBJECT",
  properties: {
    // 1. بيانات العقد
    contractNumber: { type: "STRING", description: "رقم العقد المذكور في المستند" },
    contractType: { type: "STRING", description: "نوع العقد (مثال: عقد محدد المدة، غير محدد، أجير)" },
    source: { type: "STRING", description: "المصدر/المنصة (مثال: منصة قوى QIWA، منصة أجير)" },
    executionDate: { type: "STRING", description: "تاريخ إبرام العقد بصيغة YYYY-MM-DD" },
    startDate: { type: "STRING", description: "تاريخ بداية العقد (المباشرة) بصيغة YYYY-MM-DD" },
    endDate: { type: "STRING", description: "تاريخ نهاية العقد بصيغة YYYY-MM-DD (إن وجد)" },
    isActive: { type: "BOOLEAN", description: "هل العقد ساري المفعول حالياً؟" },
    isRenewable: { type: "BOOLEAN", description: "هل ينص العقد على أنه قابل للتجديد؟" },
    autoRenew: { type: "BOOLEAN", description: "هل يتجدد تلقائياً؟" },
    
    // 2. بيانات الطرف الأول
    firstPartyName: { type: "STRING", description: "اسم المنشأة / الطرف الأول" },
    unifiedNationalNo: { type: "STRING", description: "الرقم الوطني الموحد للمنشأة" },
    firstPartyEmail: { type: "STRING", description: "البريد الإلكتروني للمنشأة" },
    firstPartyRep: { type: "STRING", description: "اسم ممثل المنشأة (المفوض)" },
    firstPartyRepId: { type: "STRING", description: "رقم هوية ممثل المنشأة" },

    // 3. بيانات الطرف الثاني
    secondPartyName: { type: "STRING", description: "اسم الموظف / الطرف الثاني" },
    secondPartyNationality: { type: "STRING", description: "جنسية الموظف" },
    secondPartyIdNumber: { type: "STRING", description: "رقم هوية الموظف أو إقامته" },
    secondPartyDegree: { type: "STRING", description: "التخصص أو المؤهل العلمي للموظف" },
    secondPartyPhone: { type: "STRING", description: "رقم جوال الموظف" },
    secondPartyEmail: { type: "STRING", description: "البريد الإلكتروني للموظف" },

    // 4. تفاصيل الوظيفة
    jobTitle: { type: "STRING", description: "المسمى الوظيفي" },
    workLocation: { type: "STRING", description: "مقر أو مكان العمل" },
    probationDays: { type: "NUMBER", description: "فترة التجربة بالأيام (رقم فقط)" },
    workingHours: { type: "STRING", description: "أيام وساعات العمل (مثال: 5 أيام 48 ساعة)" },
    annualLeave: { type: "STRING", description: "الإجازة السنوية (مثال: 21 يوما)" },
    
    // 5. التفاصيل المالية
    basicSalary: { type: "NUMBER", description: "الأجر الأساسي (رقم فقط)" },
    housingAllowance: { type: "NUMBER", description: "بدل السكن (رقم فقط، 0 إذا لا يوجد)" },
    transportAllowance: { type: "NUMBER", description: "بدل النقل (رقم فقط، 0 إذا لا يوجد)" },
    totalSalary: { type: "NUMBER", description: "إجمالي الأجر الشهري (رقم فقط)" },
    salaryDueDate: { type: "STRING", description: "تاريخ الاستحقاق (نزول الراتب)" },

    // 6. بيانات البنك
    bankName: { type: "STRING", description: "اسم البنك" },
    iban: { type: "STRING", description: "رقم الآيبان (IBAN) كاملاً" }
  },
  required: [
    "contractType", "source", "startDate", "isActive", 
    "firstPartyName", "secondPartyName", "jobTitle", 
    "basicSalary", "totalSalary"
  ]
};

const analyzeEmploymentContract = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "يرجى إرفاق ملف العقد PDF" });

    // 2. قراءة الملف وتحويله إلى Base64
    const fileBytes = fs.readFileSync(req.file.path).toString("base64");

    // 3. إعداد الـ Prompt مع توجيهات دقيقة
    const promptInstruction = `
      أنت مساعد موارد بشرية خبير في أنظمة العمل في المملكة العربية السعودية.
      قم بتحليل ملف عقد العمل المرفق (قد يكون من منصة قوى، أجير، أو غيرها).
      استخرج جميع البيانات المطلوبة بدقة شديدة وقم بملء الهيكلية المحددة (Schema).
      
      ملاحظات هامة:
      1. تأكد من استخراج رقم الآيبان (IBAN) كاملاً إذا كان موجوداً.
      2. تأكد من استخراج البدلات بدقة، وإذا لم تكن موجودة اجعل قيمتها 0.
      3. جميع المبالغ المالية وفترة التجربة يجب أن تكون أرقاماً (Numbers) فقط بدون أي نصوص إضافية مثل "ريال" أو "يوم".
      4. حدد "المصدر" (source) بذكاء من شكل العقد (مثلاً إذا احتوى على شعار أو نصوص منصة قوى QIWA اكتب "منصة قوى").
    `;

    // 4. إرسال الطلب إلى Gemini
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", // يمكنك استخدام gemini-1.5-pro إذا احتجت لدقة أعلى في العقود المعقدة جداً
      contents: [{
        role: "user",
        parts: [
          { inlineData: { data: fileBytes, mimeType: "application/pdf" } },
          { text: promptInstruction },
        ],
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: ContractSchema, 
        temperature: 0.0, // تم تقليل العشوائية إلى 0 لضمان استخراج البيانات الحرفية فقط
      }
    });

    // 5. استقبال وتجهيز البيانات
    const extractedData = JSON.parse(response.text);

    res.status(200).json({
      success: true,
      fileUrl: `/uploads/employees/${req.file.filename}`,
      extractedData
    });

  } catch (error) {
    console.error("AI Analysis Error:", error.message || error);
    res.status(500).json({ message: "فشل في تحليل العقد بالذكاء الاصطناعي. الرجاء المحاولة مرة أخرى." });
  }
};

module.exports = { analyzeEmploymentContract };
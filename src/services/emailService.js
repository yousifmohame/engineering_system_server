// services/emailService.js
const { Resend } = require('resend');

// تهيئة Resend باستخدام المفتاح من ملف .env
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * وظيفة لإرسال إيميل
 * @param {string} to - البريد المستلم
 * @param {string} subject - عنوان الرسالة
 * @param {string} html - محتوى الرسالة (HTML)
 */
const sendEmail = async (to, subject, html) => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Engineering System <onboarding@bravocode.shop>', // ملاحظة: يجب أن يكون الدومين مُفعّل في Resend للإنتاج
      to: [to],
      subject: subject,
      html: html,
    });

    if (error) {
      console.error('Error sending email:', error);
      return { success: false, error };
    }

    console.log('Email sent successfully:', data);
    return { success: true, data };

  } catch (error) {
    console.error('Exception in sendEmail:', error);
    return { success: false, error };
  }
};

module.exports = { sendEmail };
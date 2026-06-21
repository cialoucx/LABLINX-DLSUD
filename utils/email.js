const sgMail = require("@sendgrid/mail");

let isInitialized = false;

const initEmail = () => {
  if (isInitialized) return;
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error("❌ SENDGRID_API_KEY is not set in environment variables.");
  } else {
    sgMail.setApiKey(apiKey);
    isInitialized = true;
  }
};

const sendEmail = async (to, subject, htmlContent) => {
  initEmail();
  const SENDGRID_FROM = process.env.SENDGRID_FROM;
  const apiKey = process.env.SENDGRID_API_KEY;

  const isPlaceholderKey = !apiKey || apiKey.startsWith("SG.placeholder_");

  if (!isInitialized || isPlaceholderKey || !SENDGRID_FROM) {
    console.log("-----------------------------------------");
    console.log(`📧 [DEMO MODE / NO EMAIL API KEY]`);
    console.log(`From: LabLinx DLSU-D System <${SENDGRID_FROM || "no-reply@dlsud.edu.ph"}>`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Content Outline: ${htmlContent.replace(/<[^>]*>/g, " ").substring(0, 150)}...`);
    console.log("-----------------------------------------");
    return;
  }

  try {
    const [response] = await sgMail.send({
      from: `LabLinx DLSU-D System <${SENDGRID_FROM}>`,
      to,
      subject,
      html: htmlContent,
    });

    if (response.statusCode >= 400) {
      console.error(
        `❌ Error sending email to ${to}: SendGrid responded with status ${response.statusCode}`,
      );
      return;
    }

    console.log(`📧 Email sent to ${to}: ${subject}`);
  } catch (error) {
    console.error("❌ Unexpected error while sending email:", error);
  }
};

module.exports = { sendEmail };

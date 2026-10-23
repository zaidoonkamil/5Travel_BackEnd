const axios = require("axios");
const { normalizePhone } = require("./phoneUtils");

// Same integration as wasalni: verification codes are delivered on WhatsApp through OTPIQ.
const OTPIQ_BASE_URL = (process.env.OTPIQ_BASE_URL || "https://api.otpiq.com/api").replace(/\/+$/, "");
const OTPIQ_PROVIDER = process.env.OTPIQ_PROVIDER || "whatsapp";
const OTPIQ_TIMEOUT_MS = Number(process.env.OTPIQ_TIMEOUT_MS || 15000);

function optionalPayloadFields() {
  const fields = {};
  if (process.env.OTPIQ_SENDER_ID) fields.senderId = process.env.OTPIQ_SENDER_ID;
  if (process.env.OTPIQ_WHATSAPP_ACCOUNT_ID) fields.whatsappAccountId = process.env.OTPIQ_WHATSAPP_ACCOUNT_ID;
  if (process.env.OTPIQ_WHATSAPP_PHONE_ID) fields.whatsappPhoneId = process.env.OTPIQ_WHATSAPP_PHONE_ID;
  if (process.env.OTPIQ_TEMPLATE_NAME) fields.templateName = process.env.OTPIQ_TEMPLATE_NAME;
  return fields;
}

function getOtpiqApiKey() {
  return String(process.env.OTPIQ_API_KEY || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function isOtpiqConfigured() {
  return Boolean(getOtpiqApiKey());
}

async function getOtpiqProjectInfo() {
  const response = await axios.get(`${OTPIQ_BASE_URL}/info`, {
    timeout: OTPIQ_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${getOtpiqApiKey()}` },
  });
  return {
    projectName: response.data?.projectName || null,
    credit: response.data?.credit ?? null,
  };
}

async function sendOtpiqVerificationCode(phone, code) {
  const phoneNumber = normalizePhone(phone);
  if (!phoneNumber) {
    throw Object.assign(new Error("رقم الهاتف غير صالح"), { statusCode: 400 });
  }

  if (!isOtpiqConfigured()) {
    // Development without an OTPIQ key: print the code instead of sending it.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[otp] ${phoneNumber} → ${code} (OTPIQ_API_KEY not set, code not sent)`);
      return { phone: phoneNumber, simulated: true };
    }
    throw new Error("OTPIQ_API_KEY is missing in environment variables");
  }

  try {
    const response = await axios.post(
      `${OTPIQ_BASE_URL}/sms`,
      {
        phoneNumber,
        smsType: "verification",
        provider: OTPIQ_PROVIDER,
        verificationCode: String(code),
        ...optionalPayloadFields(),
      },
      {
        timeout: OTPIQ_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${getOtpiqApiKey()}`,
          "Content-Type": "application/json",
        },
      }
    );
    return {
      phone: phoneNumber,
      smsId: response.data?.smsId || null,
      remainingCredit: response.data?.remainingCredit ?? null,
    };
  } catch (error) {
    const reason = error.response?.data?.error || error.response?.data?.message || error.message;
    console.error("[otpiq] send failed:", error.response?.status, reason);
    throw Object.assign(new Error("تعذر إرسال رمز التحقق عبر واتساب، حاول مرة أخرى"), { statusCode: 502 });
  }
}

module.exports = {
  getOtpiqProjectInfo,
  isOtpiqConfigured,
  sendOtpiqVerificationCode,
};

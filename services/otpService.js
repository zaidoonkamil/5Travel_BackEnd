const crypto = require("crypto");
const { Op } = require("sequelize");
const { OtpCode } = require("../models");
const { normalizePhone, toLatinDigits } = require("./phoneUtils");
const { sendOtpiqVerificationCode } = require("./otpiqService");
const { HttpError } = require("./httpError");

const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 5 * 60 * 1000);
const OTP_RESEND_MS = Number(process.env.OTP_RESEND_MS || 60 * 1000);
const OTP_ATTEMPTS = Number(process.env.OTP_ATTEMPTS || 5);

const OTP_PURPOSES = {
  verifyAccount: "verify_account",
  passwordReset: "password_reset",
};

function hashOtp(code) {
  return crypto.createHash("sha256").update(toLatinDigits(String(code)).trim()).digest("hex");
}

function sameHash(a, b) {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Creates a fresh code (invalidating older ones) and sends it on WhatsApp.
async function sendOtp(phone, purpose) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new HttpError(400, "رقم الهاتف غير صالح");

  const now = new Date();
  const latest = await OtpCode.findOne({
    where: { phone: normalizedPhone, purpose, consumedAt: null, expiresAt: { [Op.gt]: now } },
    order: [["createdAt", "DESC"]],
  });
  if (latest) {
    const waitMs = latest.createdAt.getTime() + OTP_RESEND_MS - Date.now();
    if (waitMs > 0) {
      const waitSeconds = Math.ceil(waitMs / 1000);
      throw new HttpError(429, `يرجى الانتظار ${waitSeconds} ثانية قبل إعادة الإرسال`, {
        code: "otp_cooldown",
        retryAfterSeconds: waitSeconds,
      });
    }
  }

  await OtpCode.update({ consumedAt: now }, { where: { phone: normalizedPhone, purpose, consumedAt: null } });

  const code = String(crypto.randomInt(100000, 1000000));
  const row = await OtpCode.create({
    phone: normalizedPhone,
    purpose,
    codeHash: hashOtp(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    attemptsLeft: OTP_ATTEMPTS,
  });

  try {
    await sendOtpiqVerificationCode(normalizedPhone, code);
  } catch (error) {
    // Not delivered: drop it so the user can retry immediately.
    await row.destroy().catch(() => {});
    throw error;
  }

  return {
    phone: normalizedPhone,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    retryAfterSeconds: Math.floor(OTP_RESEND_MS / 1000),
  };
}

async function verifyOtp(phone, code, purpose) {
  const normalizedPhone = normalizePhone(phone);
  const cleanCode = toLatinDigits(String(code || "")).trim();
  if (!normalizedPhone || !/^\d{6}$/.test(cleanCode)) {
    throw new HttpError(400, "رمز التحقق غير صحيح");
  }

  const row = await OtpCode.findOne({
    where: { phone: normalizedPhone, purpose, consumedAt: null },
    order: [["createdAt", "DESC"]],
  });
  if (!row) throw new HttpError(400, "لا يوجد رمز فعال، اطلب رمزاً جديداً", { code: "otp_missing" });
  if (new Date() > new Date(row.expiresAt)) {
    throw new HttpError(400, "انتهت صلاحية الرمز، اطلب رمزاً جديداً", { code: "otp_expired" });
  }
  if (row.attemptsLeft <= 0) {
    throw new HttpError(400, "تم تجاوز عدد المحاولات، اطلب رمزاً جديداً", { code: "otp_locked" });
  }

  if (!sameHash(hashOtp(cleanCode), row.codeHash)) {
    row.attemptsLeft -= 1;
    await row.save();
    throw new HttpError(400, "رمز التحقق غير صحيح", { code: "otp_invalid", attemptsLeft: row.attemptsLeft });
  }

  row.consumedAt = new Date();
  await row.save();
  return { phone: normalizedPhone };
}

module.exports = { OTP_PURPOSES, sendOtp, verifyOtp };

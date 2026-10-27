const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const { User } = require("../models");
const { authenticateTokenUser } = require("../middlewares/auth");
const { rateLimit } = require("../middlewares/requestRateLimiter");
const { HttpError, badRequest } = require("../services/httpError");
const { requireText, requireEmail } = require("../services/validators");
const { normalizePhone, phoneVariants } = require("../services/phoneUtils");
const { OTP_PURPOSES, sendOtp, verifyOtp } = require("../services/otpService");

const router = express.Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: "محاولات كثيرة، حاول بعد قليل" });
const MIN_PASSWORD_LENGTH = 8;
const NOT_VERIFIED_MESSAGE = "الحساب غير موثق. يرجى إدخال رمز التحقق المرسل على واتساب.";

// WhatsApp verification of new accounts. Off for now (accounts are active right after sign-up);
// set REQUIRE_PHONE_VERIFICATION=true in .env to turn the OTP step back on.
const requirePhoneVerification = () => process.env.REQUIRE_PHONE_VERIFICATION === "true";

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: user.role === "admin" ? "12h" : "30d" }
  );
}

function serializeUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isPartner: Boolean(user.isPartner),
    createdAt: user.createdAt,
  };
}

function requirePassword(value, field = "كلمة المرور") {
  const password = String(value || "");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`${field} يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`, { param: "password" });
  }
  return password;
}

function requireIraqiPhone(value) {
  const phone = normalizePhone(value);
  if (!phone) throw badRequest("رقم الهاتف غير صالح، اكتبه بصيغة 07XXXXXXXXX", { param: "phone" });
  return phone;
}

// Matches phones saved in any older format (07…, +964…, 964…).
function findByPhone(phone, scope = "defaultScope") {
  return User.scope(scope).findOne({ where: { phone: { [Op.in]: phoneVariants(phone) } } });
}

async function findByIdentifier(identifier) {
  const value = String(identifier || "").trim();
  if (!value) return null;
  if (value.includes("@")) return User.scope("withPassword").findOne({ where: { email: value.toLowerCase() } });
  const phone = normalizePhone(value);
  return phone ? findByPhone(phone, "withPassword") : null;
}

function assertNotBanned(user) {
  if (user.isActive === false) throw new HttpError(403, "تم حظر حسابك");
}

async function login(req, res, { adminOnly }) {
  const user = await findByIdentifier(req.body?.identifier ?? req.body?.email ?? req.body?.phone);
  const valid = user && (await bcrypt.compare(String(req.body?.password || ""), user.password));
  if (!valid) throw new HttpError(401, "رقم الهاتف أو كلمة المرور غير صحيحة");
  assertNotBanned(user);
  if (adminOnly && user.role !== "admin") throw new HttpError(403, "هذا الحساب ليس حساب أدمن");
  if (user.status === "pending") {
    if (requirePhoneVerification()) {
      throw new HttpError(403, NOT_VERIFIED_MESSAGE, { code: "account_not_verified", phone: user.phone });
    }
    // Verification is off: accounts left pending from before are activated on login.
    user.status = "active";
  }

  user.lastLoginAt = new Date();
  await user.save();
  return res.json({ token: signToken(user), user: serializeUser(user) });
}

// ---------------- Register + WhatsApp verification ----------------

router.post("/auth/register", authLimiter, async (req, res) => {
  const body = req.body || {};
  const fullName = requireText(body.fullName, "الاسم", 120);
  const phone = requireIraqiPhone(body.phone);
  const email = body.email ? requireEmail(body.email) : null;
  const password = requirePassword(body.password);

  let user = await findByPhone(phone);
  if (user && user.status === "active") {
    throw new HttpError(409, "رقم الهاتف مسجل مسبقاً، سجل الدخول", { code: "phone_taken" });
  }
  if (email) {
    const emailOwner = await User.findOne({ where: { email } });
    if (emailOwner && (!user || emailOwner.id !== user.id)) {
      throw new HttpError(409, "البريد الإلكتروني مستخدم من حساب آخر");
    }
  }

  const hash = await bcrypt.hash(password, 12);
  // The status is decided here, never taken from the client.
  const status = requirePhoneVerification() ? "pending" : "active";
  if (user) {
    // Unverified account registered again: refresh its details instead of failing.
    await user.update({ fullName, email, password: hash, phone, status });
  } else {
    user = await User.create({ fullName, phone, email, password: hash, role: "user", status });
  }

  if (status === "active") {
    // No verification step: logged in straight away.
    user.lastLoginAt = new Date();
    await user.save();
    return res.status(201).json({
      requiresVerification: false,
      token: signToken(user),
      user: serializeUser(user),
      message: "تم إنشاء الحساب بنجاح",
    });
  }

  const otp = await sendOtp(phone, OTP_PURPOSES.verifyAccount).catch((error) => {
    // Account saved; the app can still ask for a new code from the verify screen.
    if (error.statusCode === 429) return { phone, retryAfterSeconds: error.retryAfterSeconds };
    throw error;
  });

  return res.status(201).json({
    requiresVerification: true,
    phone: otp.phone,
    retryAfterSeconds: otp.retryAfterSeconds,
    message: "تم إرسال رمز التحقق إلى واتساب",
  });
});

router.post("/auth/resend-otp", otpLimiter, async (req, res) => {
  const phone = requireIraqiPhone(req.body?.phone);
  const user = await findByPhone(phone);
  if (!user) throw new HttpError(404, "لا يوجد حساب بهذا الرقم");
  assertNotBanned(user);
  if (user.status === "active") throw new HttpError(400, "الحساب موثق مسبقاً، سجل الدخول", { code: "already_verified" });

  const otp = await sendOtp(phone, OTP_PURPOSES.verifyAccount);
  return res.json({ phone: otp.phone, retryAfterSeconds: otp.retryAfterSeconds, message: "تم إعادة إرسال رمز التحقق عبر واتساب" });
});

router.post("/auth/verify-otp", otpLimiter, async (req, res) => {
  const phone = requireIraqiPhone(req.body?.phone);
  const user = await findByPhone(phone);
  if (!user) throw new HttpError(404, "لا يوجد حساب بهذا الرقم");
  assertNotBanned(user);

  await verifyOtp(phone, req.body?.code, OTP_PURPOSES.verifyAccount);

  user.status = "active";
  user.phone = phone;
  user.lastLoginAt = new Date();
  await user.save();
  return res.json({ token: signToken(user), user: serializeUser(user), message: "تم توثيق الحساب بنجاح" });
});

// ---------------- Login ----------------

router.post("/auth/login", authLimiter, (req, res) => login(req, res, { adminOnly: false }));
router.post("/admin/login", authLimiter, (req, res) => login(req, res, { adminOnly: true }));

// ---------------- Forgot / reset password ----------------

router.post("/auth/forgot-password", otpLimiter, async (req, res) => {
  const phone = requireIraqiPhone(req.body?.phone);
  const user = await findByPhone(phone);
  if (!user) throw new HttpError(404, "لا يوجد حساب بهذا الرقم");
  assertNotBanned(user);

  const otp = await sendOtp(phone, OTP_PURPOSES.passwordReset);
  return res.json({
    phone: otp.phone,
    retryAfterSeconds: otp.retryAfterSeconds,
    message: "تم إرسال رمز إعادة تعيين كلمة المرور عبر واتساب",
  });
});

router.post("/auth/reset-password", otpLimiter, async (req, res) => {
  const phone = requireIraqiPhone(req.body?.phone);
  const newPassword = requirePassword(req.body?.newPassword, "كلمة المرور الجديدة");
  const user = await findByPhone(phone);
  if (!user) throw new HttpError(404, "لا يوجد حساب بهذا الرقم");
  assertNotBanned(user);

  await verifyOtp(phone, req.body?.code, OTP_PURPOSES.passwordReset);

  // The code proves phone ownership, so a pending account becomes verified too.
  user.password = await bcrypt.hash(newPassword, 12);
  user.tokenVersion += 1;
  user.status = "active";
  user.lastLoginAt = new Date();
  await user.save();
  return res.json({ token: signToken(user), user: serializeUser(user), message: "تم تغيير كلمة المرور بنجاح" });
});

// ---------------- Profile ----------------

router.get("/auth/me", authenticateTokenUser, async (req, res) => {
  const user = await User.findByPk(req.user.id);
  return res.json({ user: serializeUser(user) });
});

router.put("/auth/me", authenticateTokenUser, async (req, res) => {
  const user = await User.findByPk(req.user.id);
  const body = req.body || {};

  if (body.fullName !== undefined) user.fullName = requireText(body.fullName, "الاسم", 120);
  if (body.email !== undefined) user.email = body.email ? requireEmail(body.email) : null;

  try {
    await user.save();
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      throw new HttpError(409, "البريد الإلكتروني مستخدم من حساب آخر");
    }
    throw error;
  }
  return res.json({ user: serializeUser(user) });
});

router.post("/auth/change-password", authenticateTokenUser, authLimiter, async (req, res) => {
  const user = await User.scope("withPassword").findByPk(req.user.id);
  const valid = await bcrypt.compare(String(req.body?.currentPassword || ""), user.password);
  if (!valid) throw new HttpError(400, "كلمة المرور الحالية غير صحيحة");

  user.password = await bcrypt.hash(requirePassword(req.body?.newPassword), 12);
  user.tokenVersion += 1;
  await user.save();
  return res.json({ token: signToken(user), message: "تم تغيير كلمة المرور" });
});

module.exports = router;

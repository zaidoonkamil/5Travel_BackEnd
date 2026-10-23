const { badRequest } = require("./httpError");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value, max = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function requireText(value, field, max = 200) {
  const text = cleanText(value, max);
  if (!text) throw badRequest(`${field} مطلوب`, { param: field });
  return text;
}

function requireDate(value, field) {
  const text = String(value || "").trim();
  if (!DATE_RE.test(text) || Number.isNaN(Date.parse(text))) {
    throw badRequest(`${field} يجب أن يكون بصيغة YYYY-MM-DD`, { param: field });
  }
  return text;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  return requireDate(value, field);
}

function intInRange(value, field, { min = 0, max = 99, fallback } = {}) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw badRequest(`${field} يجب أن يكون بين ${min} و ${max}`, { param: field });
  }
  return n;
}

function decimal(value, field, { min = 0, max = 1e9, allowNull = false } = {}) {
  if ((value === undefined || value === null || value === "") && allowNull) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw badRequest(`${field} غير صالح`, { param: field });
  }
  return Math.round(n * 100) / 100;
}

function requireEmail(value, field = "البريد الإلكتروني") {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw badRequest(`${field} غير صالح`, { param: "email" });
  return email;
}

function requirePhone(value, field = "رقم الهاتف") {
  const phone = String(value || "").replace(/[\s-]/g, "");
  if (!/^\+?\d{7,15}$/.test(phone)) throw badRequest(`${field} غير صالح`, { param: "phone" });
  return phone;
}

function toBool(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function parseJsonArray(value, field) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.map((v) => cleanText(v, 200)).filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((v) => cleanText(v, 200)).filter(Boolean);
  } catch (_) {
    // Fall back to comma separated text.
  }
  return String(value)
    .split(/[,\n،]/)
    .map((v) => cleanText(v, 200))
    .filter(Boolean)
    .slice(0, 50);
}

module.exports = {
  cleanText,
  requireText,
  requireDate,
  optionalDate,
  intInRange,
  decimal,
  requireEmail,
  requirePhone,
  toBool,
  parseJsonArray,
};

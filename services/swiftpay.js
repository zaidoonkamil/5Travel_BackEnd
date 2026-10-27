const crypto = require("crypto");
const axios = require("axios");
const { HttpError } = require("./httpError");

// SwiftPayIQ (https://swiftpayiq.com/docs): card payments in IQD through hosted payment links.
// Test or live is decided by the key itself (spi_test_… / spi_live_…).
const DEFAULT_BASE_URL = "https://api.swiftpayiq.com/api/v1";

function config() {
  return {
    apiKey: String(process.env.SWIFTPAY_API_KEY || "").trim(),
    baseUrl: String(process.env.SWIFTPAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    webhookSecret: String(process.env.SWIFTPAY_WEBHOOK_SECRET || "").trim(),
  };
}

function isConfigured() {
  return Boolean(config().apiKey);
}

async function call(method, path, data) {
  const { apiKey, baseUrl } = config();
  if (!apiKey) throw new HttpError(503, "الدفع الإلكتروني غير مفعّل حالياً، تواصل مع الدعم");
  try {
    const res = await axios({
      method,
      url: `${baseUrl}${path}`,
      data,
      timeout: 20000,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    return res.data;
  } catch (error) {
    const status = error.response?.status;
    console.error("[swiftpay]", method, path, status || error.code, JSON.stringify(error.response?.data || error.message));
    throw new HttpError(502, "تعذر الاتصال ببوابة الدفع، حاول بعد قليل");
  }
}

// "9647…" → "+9647…" (SwiftPay wants E.164); anything else is left out.
function e164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return /^9647\d{9}$/.test(digits) ? `+${digits}` : undefined;
}

// Single-use link for an exact IQD amount. Returns { id, payPageUrl, status, … }.
function createPaymentLink({ title, amount, customerName, customerPhone, expiresAt }) {
  return call("post", "/payment-links", {
    title: String(title).slice(0, 120),
    amount: String(Math.round(amount)),
    isReusable: false,
    customerName: customerName ? String(customerName).slice(0, 120) : undefined,
    customerPhone: e164(customerPhone),
    expiresAt,
  });
}

function getPaymentLink(id) {
  return call("get", `/payment-links/${encodeURIComponent(id)}`);
}

function disablePaymentLink(id) {
  return call("post", `/payment-links/${encodeURIComponent(id)}/disable`).catch(() => null);
}

// X-SwiftPay-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "{t}.{rawBody}">, at most 5 minutes old.
function verifyWebhookSignature(rawBody, header) {
  const { webhookSecret } = config();
  if (!webhookSecret || !rawBody || !header) return false;
  const parts = Object.fromEntries(
    String(header)
      .split(",")
      .map((p) => p.trim().split("="))
      .filter((p) => p.length === 2)
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300 || !/^[0-9a-f]+$/i.test(parts.v1 || "")) return false;
  const expected = crypto.createHmac("sha256", webhookSecret).update(`${parts.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  isConfigured,
  createPaymentLink,
  getPaymentLink,
  disablePaymentLink,
  verifyWebhookSignature,
};

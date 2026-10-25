const multer = require("multer");
const { HermesError } = require("./hermesClient");

const isProduction = process.env.NODE_ENV === "production";

// Supplier error codes the customer can act on.
const HERMES_MESSAGES = {
  offer_expired: "انتهت صلاحية العرض، يرجى البحث مرة أخرى",
  offer_not_found: "العرض غير موجود، يرجى البحث مرة أخرى",
  offer_not_revalidated: "يرجى تحديث العرض والمحاولة مرة أخرى",
  rate_expired: "انتهت صلاحية سعر الغرفة، يرجى البحث مرة أخرى",
  rate_not_found: "الغرفة غير موجودة، يرجى البحث مرة أخرى",
  rate_not_revalidated: "يرجى تحديث السعر والمحاولة مرة أخرى",
  duplicate_booking: "يوجد حجز فعال لهذا العرض مسبقاً",
  order_ticketed: "التذكرة صادرة، استخدم الاسترداد بدلاً من الإلغاء",
  not_found: "غير موجود لدى المزود",
};

function hermesToResponse(err) {
  const base = { code: err.code || "supplier_error" };

  // Our own supplier credentials / balance problems must not leak to customers.
  if (err.status === 401 || err.status === 403 || err.code === "hermes_not_configured") {
    return { status: 502, body: { ...base, code: "supplier_unavailable", error: "خدمة الحجز غير متاحة حالياً" } };
  }
  if (err.status === 402) {
    return { status: 503, body: { ...base, code: "booking_unavailable", error: "لا يمكن إتمام الحجز حالياً، تواصل مع الدعم" } };
  }
  if (err.status === 429) {
    return { status: 503, body: { ...base, error: "الخدمة مشغولة، حاول بعد قليل" } };
  }
  if (err.status === 400 || err.status === 422) {
    return { status: 422, body: { ...base, error: err.message || "بيانات غير صالحة", param: err.param } };
  }
  if (err.status === 404 || err.status === 409) {
    return { status: err.status, body: { ...base, error: HERMES_MESSAGES[err.code] || err.message } };
  }
  return { status: 502, body: { ...base, error: "تعذر الاتصال بمزود الخدمة، حاول مرة أخرى" } };
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof HermesError) {
    const { status, body } = hermesToResponse(err);
    console.error("[hermes]", req.method, req.path, err.status, err.code, err.message, err.requestId || "");
    return res.status(status).json(body);
  }

  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "حجم الصورة كبير (الحد 5MB)" : "خطأ في رفع الملفات";
    return res.status(400).json({ error: message });
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON غير صالح" });
  }

  const statusCode = err.statusCode || err.status;
  // 4xx, and 502/503 raised on purpose (e.g. WhatsApp code not delivered), carry a user-facing message.
  if (statusCode && ((statusCode >= 400 && statusCode < 500) || statusCode === 502 || statusCode === 503)) {
    const { statusCode: _s, status: _st, message, stack, ...extra } = err;
    return res.status(statusCode).json({ error: message, ...extra });
  }

  console.error("Global Error Caught:", req.method, req.path, err);
  return res.status(500).json({
    error: "حدث خطأ داخلي في السيرفر",
    ...(isProduction ? {} : { message: err.message }),
  });
}

module.exports = { errorHandler, hermesToResponse };

const express = require("express");
const { Op } = require("sequelize");
const { Booking, CustomActivity } = require("../models");
const { authenticateTokenUser } = require("../middlewares/auth");
const { hermes, newIdempotencyKey } = require("../services/hermesClient");
const { getPricer } = require("../services/pricing");
const { isArabic, englishSearch, arabicCity } = require("../services/arabicPlaces");
const {
  priceActivityList,
  priceActivityProduct,
  priceActivityAvailability,
} = require("../services/priceMappers");
const { generateReference, serializeBooking, mapProviderStatus } = require("../services/bookings");
const { serializeCustomActivity } = require("../services/customSerializers");
const { HttpError, badRequest } = require("../services/httpError");
const {
  cleanText,
  requireText,
  requireDate,
  intInRange,
  requireEmail,
  requirePhone,
} = require("../services/validators");

const router = express.Router();

const LANGUAGE_RE = /^[A-Za-z]{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function languageParam(value) {
  return LANGUAGE_RE.test(String(value || "")) ? String(value).toUpperCase() : undefined;
}

// Booking-option answers are forwarded as given; the supplier validates them.
function sanitizeOptionAnswers(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).map((answer) => ({
    id: cleanText(answer?.id, 80),
    value: typeof answer?.value === "string" ? answer.value.slice(0, 500) : answer?.value,
  }));
}

// The supplier has no Arabic city names; fill in the ones we know.
function withArabicCity(item) {
  const ar = (!item.city_translated || item.city_translated === item.city) && arabicCity(item.city);
  return ar ? { ...item, city_translated: ar } : item;
}

router.get("/activities/products", async (req, res) => {
  const params = {
    page: intInRange(req.query.page, "page", { min: 1, max: 1000, fallback: 1 }),
    per_page: intInRange(req.query.per_page, "per_page", { min: 1, max: 100, fallback: 20 }),
  };
  for (const key of ["query", "city", "country", "category", "sort"]) {
    const value = cleanText(req.query[key], 100);
    if (value) params[key] = value;
  }
  const language = languageParam(req.query.language);
  if (language) params.language = language;
  const pricer = await getPricer("activities");
  // The app filters by selling price; the supplier filters by its own cost.
  for (const key of ["min_price", "max_price"]) {
    const n = Number(req.query[key]);
    if (Number.isFinite(n) && n >= 0) params[key] = Math.round((n / (1 + pricer.rule.percent / 100)) * 100) / 100;
  }

  // The supplier matches English only; our own activities are searched with the original text.
  const typed = params.query;
  const supplierParams = { ...params };
  const english = typed && isArabic(typed) ? englishSearch(typed) : null;
  if (english) {
    // A city alone searches better as text: the supplier's city filter wants its exact spelling.
    supplierParams.query = english.query || english.city;
    if (english.query && english.city && !params.city) supplierParams.city = english.city;
  }
  const list = await hermes.listActivities(supplierParams);
  const result = priceActivityList(list, pricer);
  if (params.language === "AR") result.data = (result.data || []).map(withArabicCity);

  if (params.page === 1) {
    const where = { isActive: true };
    if (params.city) where.city = { [Op.like]: `%${params.city}%` };
    if (params.country) where.country = { [Op.like]: `%${params.country}%` };
    if (params.query) {
      where[Op.or] = [
        { title: { [Op.like]: `%${params.query}%` } },
        { city: { [Op.like]: `%${params.query}%` } },
      ];
    }
    const custom = await CustomActivity.findAll({ where, order: [["sortOrder", "ASC"], ["id", "DESC"]], limit: 50 });
    result.custom_activities = custom.map((a) => serializeCustomActivity(a, req));
  }
  return res.json(result);
});

router.get("/activities/products/:id", async (req, res) => {
  const language = languageParam(req.query.language);
  const [product, pricer] = await Promise.all([
    hermes.getActivity(req.params.id, language ? { language } : undefined),
    getPricer("activities"),
  ]);
  const priced = priceActivityProduct(product, pricer);
  return res.json(language === "AR" && priced ? withArabicCity(priced) : priced);
});

router.get("/activities/product-types/:id/availability", async (req, res) => {
  const params = {};
  if (req.query.date) params.date = requireDate(req.query.date, "التاريخ");
  const language = languageParam(req.query.language);
  if (language) params.language = language;

  const [availability, pricer] = await Promise.all([
    hermes.getActivityAvailability(req.params.id, params),
    getPricer("activities"),
  ]);
  return res.json(priceActivityAvailability(availability, pricer));
});

router.post("/activities/book", authenticateTokenUser, async (req, res) => {
  const body = req.body || {};
  const productTypeId = requireText(body.product_type_id, "product_type_id", 100);
  const date = requireDate(body.date, "التاريخ");
  const travelers = {
    adults: intInRange(body.travelers?.adults, "عدد البالغين", { min: 1, max: 30 }),
  };
  const children = intInRange(body.travelers?.children, "عدد الأطفال", { min: 0, max: 30, fallback: 0 });
  const seniors = intInRange(body.travelers?.seniors, "عدد كبار السن", { min: 0, max: 30, fallback: 0 });
  if (children) travelers.children = children;
  if (seniors) travelers.seniors = seniors;

  const customer = {
    given_name: requireText(body.customer?.given_name, "الاسم الأول", 60),
    family_name: requireText(body.customer?.family_name, "اسم العائلة", 60),
    email: requireEmail(body.customer?.email),
  };
  if (body.customer?.phone) customer.phone = requirePhone(body.customer.phone);

  const reference = await generateReference();
  const payload = { product_type_id: productTypeId, date, travelers, customer, client_reference: reference };
  if (body.timeslot) {
    if (!TIME_RE.test(String(body.timeslot))) throw badRequest("وقت النشاط غير صالح");
    payload.timeslot = String(body.timeslot);
  }
  if (body.options && typeof body.options === "object") {
    payload.options = {
      per_booking: sanitizeOptionAnswers(body.options.per_booking),
      per_pax: Array.isArray(body.options.per_pax)
        ? body.options.per_pax.slice(0, 90).map(sanitizeOptionAnswers)
        : [],
    };
  }

  const pricer = await getPricer("activities");
  const idempotencyKey = newIdempotencyKey();

  // Activities are priced by the supplier when the hold is created.
  const supplierBooking = await hermes.createActivityBooking(payload, idempotencyKey);
  const price = pricer.breakdown(supplierBooking.total.amount);

  const expected = Number(body.expected_total);
  if (Number.isFinite(expected) && Math.abs(expected - price.sellAmount) > Math.max(0.5, expected * 0.01)) {
    // Release the hold, the customer has not agreed to the new price.
    await hermes.cancelActivityBooking(supplierBooking.id, newIdempotencyKey()).catch((error) => {
      console.error("Failed to release activity hold after price change:", supplierBooking.id, error.code);
    });
    throw new HttpError(409, "تغير سعر النشاط، يرجى مراجعة السعر الجديد", {
      code: "price_changed",
      total: { amount: price.sellAmount.toFixed(2), currency: "USD" },
    });
  }

  const booking = await Booking.create({
    reference,
    userId: req.user.id,
    service: "activity",
    status: mapProviderStatus("activity", supplierBooking.status) || "pending",
    title: supplierBooking.title || "نشاط سياحي",
    travelDate: date,
    providerRef: supplierBooking.id,
    providerStatus: supplierBooking.status,
    idempotencyKey,
    currency: supplierBooking.total.currency || "USD",
    ...price,
    contact: customer,
    details: {
      product_type_id: productTypeId,
      date,
      timeslot: payload.timeslot || null,
      travelers,
      providerSnapshot: supplierBooking,
    },
  });

  return res.status(201).json({ booking: serializeBooking(booking) });
});

// ---------------- Admin custom activities (public side) ----------------

router.get("/custom-activities", async (req, res) => {
  const where = { isActive: true };
  const city = cleanText(req.query.city, 120);
  const query = cleanText(req.query.query, 120);
  if (city) where.city = { [Op.like]: `%${city}%` };
  if (query) where[Op.or] = [{ title: { [Op.like]: `%${query}%` } }, { city: { [Op.like]: `%${query}%` } }];

  const items = await CustomActivity.findAll({ where, order: [["sortOrder", "ASC"], ["id", "DESC"]], limit: 100 });
  return res.json({ data: items.map((a) => serializeCustomActivity(a, req)) });
});

router.get("/custom-activities/:id", async (req, res) => {
  const activity = await CustomActivity.findOne({ where: { id: req.params.id, isActive: true } });
  if (!activity) throw new HttpError(404, "النشاط غير موجود");
  return res.json({ activity: serializeCustomActivity(activity, req) });
});

router.post("/custom-activities/:id/book", authenticateTokenUser, async (req, res) => {
  const activity = await CustomActivity.findOne({ where: { id: req.params.id, isActive: true } });
  if (!activity) throw new HttpError(404, "النشاط غير موجود");

  const body = req.body || {};
  const date = requireDate(body.date, "التاريخ");
  if (Date.parse(date) < Date.now() - 86400000) throw badRequest("التاريخ في الماضي");
  const adults = intInRange(body.adults, "عدد البالغين", { min: 1, max: 50, fallback: 1 });
  const children = intInRange(body.children, "عدد الأطفال", { min: 0, max: 50, fallback: 0 });
  const contact = {
    name: requireText(body.contact?.name, "اسم صاحب الحجز", 120),
    email: body.contact?.email ? requireEmail(body.contact.email) : null,
    phone: requirePhone(body.contact?.phone),
  };

  const childPrice = activity.priceChild === null ? Number(activity.priceAdult) : Number(activity.priceChild);
  const total = Math.round((Number(activity.priceAdult) * adults + childPrice * children) * 100) / 100;

  const booking = await Booking.create({
    reference: await generateReference(),
    userId: req.user.id,
    service: "custom_activity",
    status: "pending",
    title: activity.title,
    travelDate: date,
    customItemId: activity.id,
    currency: "USD",
    costAmount: 0,
    markupAmount: 0,
    sellAmount: total,
    contact,
    details: {
      activity: { id: activity.id, title: activity.title, city: activity.city, images: (activity.images || []).slice(0, 3) },
      date,
      adults,
      children,
      priceAdult: Number(activity.priceAdult),
      priceChild: childPrice,
      note: cleanText(body.note, 500) || null,
    },
  });

  return res.status(201).json({ booking: serializeBooking(booking) });
});

module.exports = router;

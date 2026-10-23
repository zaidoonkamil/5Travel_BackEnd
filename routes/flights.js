const express = require("express");
const { Booking } = require("../models");
const { authenticateTokenUser } = require("../middlewares/auth");
const { hermes, newIdempotencyKey } = require("../services/hermesClient");
const { getPricer } = require("../services/pricing");
const { priceFlightOffer, priceFlightSearch } = require("../services/priceMappers");
const { generateReference, serializeBooking, mapProviderStatus } = require("../services/bookings");
const { HttpError, badRequest } = require("../services/httpError");
const {
  cleanText,
  requireText,
  requireDate,
  optionalDate,
  intInRange,
  requireEmail,
  requirePhone,
} = require("../services/validators");

const router = express.Router();

const CABIN_CLASSES = new Set(["economy", "premium_economy", "business", "first"]);
const PASSENGER_TYPES = new Set(["adult", "child", "infant"]);
const IATA_RE = /^[A-Z]{3}$/;

function parseSearchBody(body = {}) {
  if (!Array.isArray(body.slices) || body.slices.length === 0 || body.slices.length > 6) {
    throw badRequest("يجب تحديد رحلة واحدة على الأقل", { param: "slices" });
  }
  const slices = body.slices.map((slice, i) => {
    const origin = String(slice?.origin || "").trim().toUpperCase();
    const destination = String(slice?.destination || "").trim().toUpperCase();
    if (!IATA_RE.test(origin)) throw badRequest("مدينة المغادرة غير صالحة", { param: `slices[${i}].origin` });
    if (!IATA_RE.test(destination)) throw badRequest("مدينة الوصول غير صالحة", { param: `slices[${i}].destination` });
    if (origin === destination) throw badRequest("مدينة المغادرة والوصول متطابقتان");
    return { origin, destination, departure_date: requireDate(slice?.departure_date, "تاريخ المغادرة") };
  });

  const passengers = {
    adults: intInRange(body.passengers?.adults, "عدد البالغين", { min: 1, max: 9, fallback: 1 }),
    children: intInRange(body.passengers?.children, "عدد الأطفال", { min: 0, max: 8, fallback: 0 }),
    infants: intInRange(body.passengers?.infants, "عدد الرضع", { min: 0, max: 4, fallback: 0 }),
  };
  if (passengers.infants > passengers.adults) throw badRequest("عدد الرضع لا يتجاوز عدد البالغين");

  const payload = { slices, passengers };
  if (body.cabin_class) {
    if (!CABIN_CLASSES.has(body.cabin_class)) throw badRequest("درجة السفر غير صالحة", { param: "cabin_class" });
    payload.cabin_class = body.cabin_class;
  }
  if (body.max_offers) payload.max_offers = intInRange(body.max_offers, "max_offers", { min: 1, max: 500 });
  return payload;
}

function parsePassengers(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > 13) {
    throw badRequest("بيانات المسافرين مطلوبة", { param: "passengers" });
  }
  return list.map((p, i) => {
    const label = `المسافر ${i + 1}`;
    const type = String(p?.type || "adult");
    if (!PASSENGER_TYPES.has(type)) throw badRequest(`${label}: نوع المسافر غير صالح`);
    const gender = String(p?.gender || "");
    if (gender !== "male" && gender !== "female") throw badRequest(`${label}: الجنس مطلوب`);

    const passenger = {
      type,
      given_name: requireText(p?.given_name, `${label}: الاسم الأول`, 60),
      family_name: requireText(p?.family_name, `${label}: اسم العائلة`, 60),
      date_of_birth: requireDate(p?.date_of_birth, `${label}: تاريخ الميلاد`),
      gender,
    };
    if (p?.nationality) passenger.nationality = cleanText(p.nationality, 3).toUpperCase();
    if (p?.document?.number) {
      passenger.document = {
        number: requireText(p.document.number, `${label}: رقم الجواز`, 30),
        expires_on: requireDate(p.document.expires_on, `${label}: تاريخ انتهاء الجواز`),
        country_code: cleanText(p.document.country_code, 3).toUpperCase() || undefined,
        issued_on: optionalDate(p.document.issued_on, `${label}: تاريخ إصدار الجواز`),
      };
    }
    return passenger;
  });
}

function flightTitle(offer) {
  const slices = Array.isArray(offer?.slices) ? offer.slices : [];
  if (slices.length === 0) return "حجز طيران";
  const route = [slices[0].origin, ...slices.map((s) => s.destination)].join(" → ");
  return offer.airline_name ? `${route} · ${offer.airline_name}` : route;
}

function firstDepartureDate(offer) {
  const departing = offer?.slices?.[0]?.segments?.[0]?.departing_at;
  return departing ? String(departing).slice(0, 10) : null;
}

router.get("/flights/places", async (req, res) => {
  const query = cleanText(req.query.query, 60);
  if (query.length < 2) return res.json({ data: [] });
  const result = await hermes.flightPlaces({ query, limit: intInRange(req.query.limit, "limit", { min: 1, max: 20, fallback: 10 }) });
  return res.json({ data: result.data || [] });
});

router.post("/flights/search", async (req, res) => {
  const payload = parseSearchBody(req.body);
  const [search, pricer] = await Promise.all([hermes.searchFlights(payload), getPricer("flights")]);
  return res.json(priceFlightSearch(search, pricer));
});

// Revalidates the offer with the supplier and returns the confirmed selling price.
router.get("/flights/offers/:id", async (req, res) => {
  const [offer, pricer] = await Promise.all([hermes.getFlightOffer(req.params.id), getPricer("flights")]);
  return res.json(priceFlightOffer(offer, pricer));
});

router.get("/flights/offers/:id/conditions", async (req, res) => {
  const conditions = await hermes.getFlightConditions(req.params.id);
  return res.json(conditions);
});

router.post("/flights/book", authenticateTokenUser, async (req, res) => {
  const body = req.body || {};
  const offerId = requireText(body.offer_id, "offer_id", 300);
  const passengers = parsePassengers(body.passengers);
  const contact = {
    email: requireEmail(body.contact?.email),
    phone: requirePhone(body.contact?.phone),
  };

  // The price is always taken from the supplier at booking time, never from the app.
  const [offer, pricer] = await Promise.all([hermes.getFlightOffer(offerId), getPricer("flights")]);
  const price = pricer.breakdown(offer.total.amount);

  const expected = Number(body.expected_total);
  if (Number.isFinite(expected) && Math.abs(expected - price.sellAmount) > 0.009) {
    throw new HttpError(409, "تغير سعر الرحلة، يرجى مراجعة السعر الجديد", {
      code: "price_changed",
      offer: priceFlightOffer(offer, pricer),
    });
  }

  const reference = await generateReference();
  const idempotencyKey = newIdempotencyKey();
  const booking = await Booking.create({
    reference,
    userId: req.user.id,
    service: "flight",
    status: "pending",
    title: flightTitle(offer),
    travelDate: firstDepartureDate(offer),
    providerStatus: "creating",
    idempotencyKey,
    currency: offer.total.currency || "USD",
    ...price,
    contact,
    details: { offer: priceFlightOffer(offer, pricer), passengers },
  });

  let order;
  try {
    order = await hermes.createFlightOrder(
      { offer_id: offerId, passengers, contact, client_reference: reference },
      idempotencyKey
    );
  } catch (error) {
    await booking.update({ status: "failed", providerStatus: error.code || "error" });
    throw error;
  }

  await booking.update({
    providerRef: order.id,
    providerStatus: order.status,
    status: mapProviderStatus("flight", order.status) || "pending",
    providerDeadline: order.ticketing_deadline || null,
    details: { ...booking.details, providerSnapshot: order },
  });

  return res.status(201).json({ booking: serializeBooking(booking) });
});

module.exports = router;

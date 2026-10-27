const express = require("express");
const { Op } = require("sequelize");
const { Booking, CustomHotel } = require("../models");
const { authenticateTokenUser } = require("../middlewares/auth");
const { hermes, newIdempotencyKey } = require("../services/hermesClient");
const { getPricer } = require("../services/pricing");
const { priceHotelSearch, priceHotelRate } = require("../services/priceMappers");
const { generateReference, serializeBooking, mapProviderStatus } = require("../services/bookings");
const { serializeCustomHotel } = require("../services/customSerializers");
const { notifyPartnerOfBooking } = require("../services/partners");
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

const PLACE_TYPES = new Set(["city", "region", "country", "hotel", "landmark", "district"]);
const GUEST_TITLES = new Set(["mr", "mrs", "ms", "miss"]);

function parseOccupancies(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > 8) {
    throw badRequest("يجب تحديد غرفة واحدة على الأقل", { param: "occupancies" });
  }
  return list.map((room, i) => {
    const occupancy = { adults: intInRange(room?.adults, `عدد البالغين في الغرفة ${i + 1}`, { min: 1, max: 8 }) };
    if (Array.isArray(room?.children) && room.children.length > 0) {
      occupancy.children = room.children
        .slice(0, 6)
        .map((age) => intInRange(age, "عمر الطفل", { min: 0, max: 17 }));
    }
    return occupancy;
  });
}

function parseSearchBody(body = {}) {
  const checkIn = requireDate(body.check_in, "تاريخ الدخول");
  const checkOut = requireDate(body.check_out, "تاريخ الخروج");
  if (Date.parse(checkOut) <= Date.parse(checkIn)) throw badRequest("تاريخ الخروج يجب أن يكون بعد تاريخ الدخول");

  const payload = { check_in: checkIn, check_out: checkOut, occupancies: parseOccupancies(body.occupancies) };

  const cityId = body.city_id !== undefined && body.city_id !== null && body.city_id !== "" ? String(body.city_id) : null;
  const hotelId = body.hotel_id !== undefined && body.hotel_id !== null && body.hotel_id !== "" ? String(body.hotel_id) : null;
  if (!!cityId === !!hotelId) throw badRequest("حدد مدينة أو فندق واحد");
  if (!/^\d+$/.test(cityId || hotelId)) throw badRequest("معرف المدينة أو الفندق غير صالح");

  // HAPI expects integers; ids exceed 2^31 but stay well inside Number.MAX_SAFE_INTEGER.
  if (cityId) {
    payload.city_id = Number(cityId);
    if (body.sort) payload.sort = cleanText(body.sort, 30);
    if (body.filters && typeof body.filters === "object" && !Array.isArray(body.filters)) {
      payload.filters = body.filters;
    }
  } else {
    payload.hotel_id = Number(hotelId);
  }
  if (body.page) payload.page = intInRange(body.page, "page", { min: 1, max: 1000 });
  if (body.page_size) payload.page_size = intInRange(body.page_size, "page_size", { min: 1, max: 200 });
  return payload;
}

function parseRooms(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > 8) {
    throw badRequest("بيانات النزلاء مطلوبة", { param: "rooms" });
  }
  return list.map((room, i) => {
    if (!Array.isArray(room?.guests) || room.guests.length === 0) {
      throw badRequest(`الغرفة ${i + 1}: أضف نزيلاً واحداً على الأقل`);
    }
    return {
      guests: room.guests.slice(0, 10).map((g, j) => {
        const label = `الغرفة ${i + 1} - النزيل ${j + 1}`;
        const guest = {
          given_name: requireText(g?.given_name, `${label}: الاسم الأول`, 60),
          family_name: requireText(g?.family_name, `${label}: اسم العائلة`, 60),
          type: g?.type === "child" ? "child" : "adult",
        };
        if (g?.title && GUEST_TITLES.has(g.title)) guest.title = g.title;
        return guest;
      }),
    };
  });
}

router.get("/hotels/places", async (req, res) => {
  const query = cleanText(req.query.query, 60);
  if (query.length < 2) return res.json({ data: [] });
  const params = { query, limit: intInRange(req.query.limit, "limit", { min: 1, max: 50, fallback: 15 }) };
  if (req.query.type && PLACE_TYPES.has(req.query.type)) params.type = req.query.type;
  const result = await hermes.hotelPlaces(params);
  return res.json({ data: result.data || [] });
});

router.post("/hotels/search", async (req, res) => {
  const payload = parseSearchBody(req.body);
  const [search, pricer] = await Promise.all([hermes.searchHotels(payload), getPricer("hotels")]);
  const result = priceHotelSearch(search, pricer);

  // Admin hotels linked to this city are shown on the first page.
  if (payload.city_id && (!payload.page || payload.page === 1)) {
    const custom = await CustomHotel.findAll({
      // Chalets and farms have their own tabs; the supplier search mixes in hotels only.
      where: { isActive: true, hermesCityId: String(payload.city_id), category: "hotel" },
      order: [["sortOrder", "ASC"], ["id", "DESC"]],
    });
    result.custom_hotels = custom.map((h) => serializeCustomHotel(h, req));
  }
  return res.json(result);
});

// Confirms the rate with the supplier and returns the confirmed selling price.
router.get("/hotels/rates/:id", async (req, res) => {
  const [rate, pricer] = await Promise.all([hermes.getHotelRate(req.params.id), getPricer("hotels")]);
  return res.json(priceHotelRate(rate, pricer));
});

router.post("/hotels/book", authenticateTokenUser, async (req, res) => {
  const body = req.body || {};
  const rateId = requireText(body.rate_id, "rate_id", 500);
  const rooms = parseRooms(body.rooms);
  const contact = {
    email: requireEmail(body.contact?.email),
    phone: requirePhone(body.contact?.phone),
  };

  const [rate, pricer] = await Promise.all([hermes.getHotelRate(rateId), getPricer("hotels")]);
  const price = pricer.breakdown(rate.total.amount);

  const expected = Number(body.expected_total);
  if (Number.isFinite(expected) && Math.abs(expected - price.sellAmount) > 0.009) {
    throw new HttpError(409, "تغير سعر الغرفة، يرجى مراجعة السعر الجديد", {
      code: "price_changed",
      rate: priceHotelRate(rate, pricer),
    });
  }

  const reference = await generateReference();
  const idempotencyKey = newIdempotencyKey();
  const hotelName = rate.hotel?.name || "حجز فندق";
  const booking = await Booking.create({
    reference,
    userId: req.user.id,
    service: "hotel",
    status: "pending",
    title: `${hotelName}${rate.nights ? ` · ${rate.nights} ليالي` : ""}`,
    travelDate: rate.check_in || null,
    providerStatus: "creating",
    idempotencyKey,
    currency: rate.total.currency || "USD",
    ...price,
    contact,
    details: {
      hotel: rate.hotel ? { id: rate.hotel.id, name: rate.hotel.name, address: rate.hotel.address, images: rate.hotel.images?.slice(0, 3) } : null,
      check_in: rate.check_in,
      check_out: rate.check_out,
      nights: rate.nights,
      board: rate.board,
      rooms_info: rate.rooms,
      cancellation: rate.cancellation,
      guests: rooms,
    },
  });

  const orderBody = { rate_id: rateId, rooms, contact, client_reference: reference };
  if (body.nationality) orderBody.nationality = cleanText(body.nationality, 3).toUpperCase();
  if (body.note) orderBody.note = cleanText(body.note, 500);

  let order;
  try {
    order = await hermes.createHotelOrder(orderBody, idempotencyKey);
  } catch (error) {
    await booking.update({ status: "failed", providerStatus: error.code || "error" });
    throw error;
  }

  await booking.update({
    providerRef: order.id,
    providerStatus: order.status,
    status: mapProviderStatus("hotel", order.status) || "pending",
    providerDeadline: order.payment_deadline || null,
    details: { ...booking.details, providerSnapshot: order },
  });

  return res.status(201).json({ booking: serializeBooking(booking) });
});

// ---------------- Admin custom hotels (public side) ----------------

// ?category=hotel|chalet|farm narrows the list; `cities` lists every city of that category for the filter chips.
router.get("/custom-hotels", async (req, res) => {
  const where = { isActive: true };
  if (["hotel", "chalet", "farm"].includes(req.query.category)) where.category = req.query.category;
  const cities = [...new Set((await CustomHotel.findAll({ where, attributes: ["city"], raw: true })).map((h) => h.city))];

  const city = cleanText(req.query.city, 120);
  const query = cleanText(req.query.query, 120);
  if (city) where.city = { [Op.like]: `%${city}%` };
  if (query) where[Op.or] = [{ name: { [Op.like]: `%${query}%` } }, { city: { [Op.like]: `%${query}%` } }];

  const hotels = await CustomHotel.findAll({ where, order: [["sortOrder", "ASC"], ["id", "DESC"]], limit: 100 });
  return res.json({ data: hotels.map((h) => serializeCustomHotel(h, req)), cities });
});

router.get("/custom-hotels/:id", async (req, res) => {
  const hotel = await CustomHotel.findOne({ where: { id: req.params.id, isActive: true } });
  if (!hotel) throw new HttpError(404, "الفندق غير موجود");
  return res.json({ hotel: serializeCustomHotel(hotel, req) });
});

router.post("/custom-hotels/:id/book", authenticateTokenUser, async (req, res) => {
  const hotel = await CustomHotel.findOne({ where: { id: req.params.id, isActive: true } });
  if (!hotel) throw new HttpError(404, "الفندق غير موجود");

  const body = req.body || {};
  const checkIn = requireDate(body.check_in, "تاريخ الدخول");
  const checkOut = requireDate(body.check_out, "تاريخ الخروج");
  // Priced per night: checkout day not counted. Priced per day (day-use): both days count,
  // so a single day has the same check-in and check-out date.
  const span = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000);
  const nights = hotel.priceUnit === "day" ? span + 1 : span;
  if (span < 0 || nights < 1 || nights > 60) throw badRequest("مدة الإقامة غير صالحة");
  if (Date.parse(checkIn) < Date.now() - 86400000) throw badRequest("تاريخ الدخول في الماضي");

  // Chalets and farms are rented whole: one unit, guests within its capacity.
  const wholePlace = hotel.category === "chalet" || hotel.category === "farm";
  const roomsCount = wholePlace ? 1 : intInRange(body.rooms, "عدد الغرف", { min: 1, max: 10, fallback: 1 });
  const adults = intInRange(body.adults, "عدد البالغين", { min: 1, max: 200, fallback: 1 });
  const children = intInRange(body.children, "عدد الأطفال", { min: 0, max: 100, fallback: 0 });
  if (hotel.capacity && adults + children > hotel.capacity) {
    throw badRequest(`السعة القصوى ${hotel.capacity} أشخاص`);
  }
  const contact = {
    name: requireText(body.contact?.name, "اسم صاحب الحجز", 120),
    email: body.contact?.email ? requireEmail(body.contact.email) : null,
    phone: requirePhone(body.contact?.phone),
  };

  const total = Math.round(Number(hotel.pricePerNight) * nights * roomsCount * 100) / 100;
  const booking = await Booking.create({
    reference: await generateReference(),
    userId: req.user.id,
    service: "custom_hotel",
    status: "pending",
    title: `${hotel.name} · ${nights} ${hotel.priceUnit === "day" ? "أيام" : "ليالي"}`,
    travelDate: checkIn,
    customItemId: hotel.id,
    currency: "USD",
    costAmount: 0,
    markupAmount: 0,
    sellAmount: total,
    contact,
    details: {
      hotel: {
        id: hotel.id,
        name: hotel.name,
        city: hotel.city,
        category: hotel.category,
        images: (hotel.images || []).slice(0, 3),
      },
      check_in: checkIn,
      check_out: checkOut,
      nights,
      rooms: roomsCount,
      adults,
      children,
      pricePerNight: Number(hotel.pricePerNight),
      priceUnit: hotel.priceUnit,
      note: cleanText(body.note, 500) || null,
    },
  });

  notifyPartnerOfBooking(booking);
  return res.status(201).json({ booking: serializeBooking(booking) });
});

module.exports = router;

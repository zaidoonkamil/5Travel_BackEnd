const express = require("express");
const { Op, fn, col } = require("sequelize");
const { Booking, User } = require("../models");
const { authenticateTokenUser } = require("../middlewares/auth");
const { serializeBooking } = require("../services/bookings");
const { issueBooking, cancelBooking } = require("../services/bookingActions");
const { notifyBookingStatus } = require("../services/notifications");
const { LISTING_TYPES, serializeListing, listingsOf, bookingsWhere } = require("../services/partners");
const { HttpError } = require("../services/httpError");
const { intInRange, toBool } = require("../services/validators");

const router = express.Router();

// Logged-in partner accounts only; attaches their listings.
async function requirePartner(req, res, next) {
  const user = await User.findByPk(req.user.id, { attributes: ["id", "isPartner"] });
  if (!user?.isPartner) throw new HttpError(403, "هذا الحساب ليس حساب شريك");
  req.listings = await listingsOf(user.id);
  next();
}

router.use("/partner", authenticateTokenUser, requirePartner);

const today = () => new Date().toISOString().slice(0, 10);

// Which bookings each tab of the partner screen shows.
const FILTERS = {
  pending: () => ({ status: "pending" }),
  upcoming: () => ({ status: "confirmed", travelDate: { [Op.gte]: today() } }),
  past: () => ({ [Op.or]: [{ status: { [Op.in]: ["cancelled", "refunded", "failed"] } }, { status: "confirmed", travelDate: { [Op.lt]: today() } }] }),
  all: () => ({}),
};

// The customer-facing booking plus which of the partner's listings it is for.
function serializePartnerBooking(booking, listings) {
  const type = Object.keys(LISTING_TYPES).find((t) => LISTING_TYPES[t].service === booking.service);
  const listing = listings.find((l) => l.type === type && l.id === booking.customItemId);
  return { ...serializeBooking(booking), listing: listing ? { type, id: listing.id, name: listing.name, category: listing.category } : null };
}

router.get("/partner/summary", async (req, res) => {
  const where = bookingsWhere(req.listings);
  if (!where) return res.json({ listings: req.listings, counts: { pending: 0, upcoming: 0, total: 0 }, perListing: {} });

  const [pending, upcoming, total, grouped] = await Promise.all([
    Booking.count({ where: { ...where, ...FILTERS.pending() } }),
    Booking.count({ where: { [Op.and]: [where, FILTERS.upcoming()] } }),
    Booking.count({ where }),
    Booking.findAll({
      where: { ...where, status: "pending" },
      attributes: ["service", "customItemId", [fn("COUNT", col("id")), "count"]],
      group: ["service", "customItemId"],
      raw: true,
    }),
  ]);
  // "hotel:3" → pending bookings on that listing, for a badge on each place.
  const perListing = {};
  for (const row of grouped) {
    const type = Object.keys(LISTING_TYPES).find((t) => LISTING_TYPES[t].service === row.service);
    perListing[`${type}:${row.customItemId}`] = Number(row.count);
  }
  return res.json({ listings: req.listings, counts: { pending, upcoming, total }, perListing });
});

router.get("/partner/bookings", async (req, res) => {
  const page = intInRange(req.query.page, "page", { min: 1, max: 1000, fallback: 1 });
  const limit = intInRange(req.query.limit, "limit", { min: 1, max: 50, fallback: 20 });
  const filter = FILTERS[req.query.filter] || FILTERS.all;
  const where = bookingsWhere(req.listings);
  if (!where) return res.json({ bookings: [], pagination: { page, limit, total: 0, hasMore: false } });

  const { rows, count } = await Booking.findAndCountAll({
    where: { [Op.and]: [where, filter()] },
    // Soonest stays first while they are ahead; newest first for everything else.
    order: req.query.filter === "upcoming" ? [["travelDate", "ASC"], ["id", "ASC"]] : [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
  });
  return res.json({
    bookings: rows.map((b) => serializePartnerBooking(b, req.listings)),
    pagination: { page, limit, total: count, hasMore: page * limit < count },
  });
});

async function findPartnerBooking(req) {
  const where = bookingsWhere(req.listings);
  const booking = where && (await Booking.findOne({ where: { [Op.and]: [where, { id: req.params.id }] } }));
  if (!booking) throw new HttpError(404, "الحجز غير موجود");
  return booking;
}

router.get("/partner/bookings/:id", async (req, res) => {
  const booking = await findPartnerBooking(req);
  return res.json({ booking: serializePartnerBooking(booking, req.listings) });
});

// Confirm or decline a pending request; the customer gets the usual status notification.
for (const [action, run] of [["confirm", issueBooking], ["cancel", cancelBooking]]) {
  router.post(`/partner/bookings/:id/${action}`, async (req, res) => {
    const booking = await findPartnerBooking(req);
    await run(booking);
    notifyBookingStatus(booking);
    return res.json({ booking: serializePartnerBooking(booking, req.listings) });
  });
}

// Open / close a listing for new bookings (e.g. fully booked, maintenance).
router.patch("/partner/listings/:type/:id", async (req, res) => {
  const listingType = LISTING_TYPES[req.params.type];
  const listing = listingType && (await listingType.model.findOne({ where: { id: req.params.id, ownerId: req.user.id } }));
  if (!listing) throw new HttpError(404, "المكان غير موجود");
  listing.isActive = toBool(req.body?.isActive);
  await listing.save();
  return res.json({ listing: serializeListing(req.params.type, listing) });
});

module.exports = router;

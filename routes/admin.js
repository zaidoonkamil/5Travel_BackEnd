const express = require("express");
const { Op, fn, col } = require("sequelize");
const { User, Booking, PricingRule } = require("../models");
const { requireAdmin } = require("../middlewares/auth");
const { serializeBooking } = require("../services/bookings");
const {
  refreshBooking,
  issueBooking,
  cancelBooking,
  getRefundQuote,
  refundBooking,
} = require("../services/bookingActions");
const { invalidateCache, SERVICES } = require("../services/pricing");
const { hermes } = require("../services/hermesClient");
const { notifyBookingStatus } = require("../services/notifications");
const { HttpError, badRequest } = require("../services/httpError");
const { cleanText, intInRange, decimal, toBool } = require("../services/validators");

const router = express.Router();
router.use("/admin", requireAdmin);

const BOOKING_STATUSES = ["pending", "processing", "confirmed", "cancelled", "refunded", "failed"];
const BOOKING_SERVICES = ["flight", "hotel", "activity", "custom_hotel", "custom_activity"];

// ---------------- Dashboard ----------------

router.get("/admin/dashboard", async (req, res) => {
  const [usersCount, byStatus, byService, confirmedTotals, recent] = await Promise.all([
    User.count({ where: { role: "user" } }),
    Booking.findAll({ attributes: ["status", [fn("COUNT", col("id")), "count"]], group: ["status"], raw: true }),
    Booking.findAll({ attributes: ["service", [fn("COUNT", col("id")), "count"]], group: ["service"], raw: true }),
    Booking.findOne({
      attributes: [
        [fn("COALESCE", fn("SUM", col("sellAmount")), 0), "revenue"],
        [fn("COALESCE", fn("SUM", col("markupAmount")), 0), "profit"],
      ],
      where: { status: "confirmed" },
      raw: true,
    }),
    Booking.findAll({ order: [["id", "DESC"]], limit: 8, include: [{ model: User, as: "user" }] }),
  ]);

  const toMap = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], Number(r.count)]));
  return res.json({
    usersCount,
    bookingsByStatus: toMap(byStatus, "status"),
    bookingsByService: toMap(byService, "service"),
    revenue: Number(confirmedTotals?.revenue || 0),
    profit: Number(confirmedTotals?.profit || 0),
    recentBookings: recent.map((b) => serializeBooking(b, { admin: true })),
  });
});

router.get("/admin/wallet", async (req, res) => {
  const wallet = await hermes.getWallet();
  return res.json(wallet);
});

// ---------------- Pricing (markup) ----------------

router.get("/admin/pricing", async (req, res) => {
  const rules = await PricingRule.findAll({ order: [["id", "ASC"]] });
  return res.json({
    rules: rules.map((r) => ({
      service: r.service,
      percent: Number(r.percent),
      fixedAmount: Number(r.fixedAmount),
      isActive: r.isActive,
      updatedAt: r.updatedAt,
    })),
  });
});

router.put("/admin/pricing/:service", async (req, res) => {
  const service = req.params.service;
  if (!SERVICES.includes(service)) throw badRequest("الخدمة غير صالحة");

  const body = req.body || {};
  const [rule] = await PricingRule.findOrCreate({ where: { service }, defaults: { service } });
  if (body.percent !== undefined) rule.percent = decimal(body.percent, "النسبة", { min: 0, max: 500 });
  if (body.fixedAmount !== undefined) rule.fixedAmount = decimal(body.fixedAmount, "المبلغ الثابت", { min: 0, max: 100000 });
  if (body.isActive !== undefined) rule.isActive = toBool(body.isActive);
  rule.updatedBy = req.user.id;
  await rule.save();
  invalidateCache();

  return res.json({
    rule: {
      service: rule.service,
      percent: Number(rule.percent),
      fixedAmount: Number(rule.fixedAmount),
      isActive: rule.isActive,
      updatedAt: rule.updatedAt,
    },
  });
});

// ---------------- Bookings ----------------

router.get("/admin/bookings", async (req, res) => {
  const page = intInRange(req.query.page, "page", { min: 1, max: 10000, fallback: 1 });
  const limit = intInRange(req.query.limit, "limit", { min: 1, max: 100, fallback: 25 });
  const where = {};
  if (BOOKING_STATUSES.includes(req.query.status)) where.status = req.query.status;
  if (BOOKING_SERVICES.includes(req.query.service)) where.service = req.query.service;
  const search = cleanText(req.query.search, 100);
  if (search) {
    where[Op.or] = [
      { reference: { [Op.like]: `%${search}%` } },
      { title: { [Op.like]: `%${search}%` } },
      { providerRef: { [Op.like]: `%${search}%` } },
    ];
  }

  const { rows, count } = await Booking.findAndCountAll({
    where,
    include: [{ model: User, as: "user" }],
    order: [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
  });
  return res.json({
    bookings: rows.map((b) => serializeBooking(b, { admin: true })),
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
  });
});

// Runs an action on a booking and pushes a notification to the customer if its status changed.
async function withStatusNotification(id, action) {
  const booking = await findBooking(id);
  const before = booking.status;
  const result = await action(booking);
  if (result.status !== before) notifyBookingStatus(result);
  return result;
}

async function findBooking(id) {
  const booking = await Booking.findByPk(id, { include: [{ model: User, as: "user" }] });
  if (!booking) throw new HttpError(404, "الحجز غير موجود");
  return booking;
}

router.get("/admin/bookings/:id", async (req, res) => {
  const booking = await findBooking(req.params.id);
  return res.json({ booking: serializeBooking(booking, { admin: true }) });
});

router.post("/admin/bookings/:id/refresh", async (req, res) => {
  const booking = await withStatusNotification(req.params.id, refreshBooking);
  return res.json({ booking: serializeBooking(booking, { admin: true }) });
});

router.post("/admin/bookings/:id/issue", async (req, res) => {
  const booking = await withStatusNotification(req.params.id, issueBooking);
  return res.json({ booking: serializeBooking(booking, { admin: true }) });
});

router.post("/admin/bookings/:id/cancel", async (req, res) => {
  const booking = await withStatusNotification(req.params.id, cancelBooking);
  return res.json({ booking: serializeBooking(booking, { admin: true }) });
});

router.get("/admin/bookings/:id/refund-quote", async (req, res) => {
  const quote = await getRefundQuote(await findBooking(req.params.id));
  return res.json(quote);
});

router.post("/admin/bookings/:id/refund", async (req, res) => {
  const body = {};
  if (Array.isArray(req.body?.ticket_numbers)) body.ticket_numbers = req.body.ticket_numbers.map(String);
  const booking = await withStatusNotification(req.params.id, (b) => refundBooking(b, body));
  return res.json({ booking: serializeBooking(booking, { admin: true }) });
});

router.patch("/admin/bookings/:id/note", async (req, res) => {
  const booking = await findBooking(req.params.id);
  booking.adminNote = String(req.body?.adminNote || "").slice(0, 2000) || null;
  await booking.save();
  return res.json({ booking: serializeBooking(booking, { admin: true }) });
});

// ---------------- Users ----------------

router.get("/admin/users", async (req, res) => {
  const page = intInRange(req.query.page, "page", { min: 1, max: 10000, fallback: 1 });
  const limit = intInRange(req.query.limit, "limit", { min: 1, max: 100, fallback: 25 });
  const where = {};
  const search = cleanText(req.query.search, 100);
  if (search) {
    where[Op.or] = [
      { fullName: { [Op.like]: `%${search}%` } },
      { email: { [Op.like]: `%${search}%` } },
      { phone: { [Op.like]: `%${search}%` } },
    ];
  }

  const { rows, count } = await User.findAndCountAll({
    where,
    order: [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
  });
  return res.json({
    users: rows.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      role: u.role,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    })),
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
  });
});

router.patch("/admin/users/:id/status", async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) throw new HttpError(404, "المستخدم غير موجود");
  if (user.id === req.user.id) throw badRequest("لا يمكنك تعطيل حسابك");
  user.isActive = toBool(req.body?.isActive);
  await user.save();
  return res.json({ id: user.id, isActive: user.isActive });
});

module.exports = router;

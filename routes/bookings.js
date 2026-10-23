const express = require("express");
const { Booking } = require("../models");
const { authenticateTokenUser } = require("../middlewares/auth");
const { serializeBooking } = require("../services/bookings");
const { cancelBooking, refreshBooking } = require("../services/bookingActions");
const { hermes } = require("../services/hermesClient");
const { HttpError } = require("../services/httpError");
const { intInRange } = require("../services/validators");

const router = express.Router();

async function findOwnBooking(req) {
  const booking = await Booking.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!booking) throw new HttpError(404, "الحجز غير موجود");
  return booking;
}

router.get("/bookings/my", authenticateTokenUser, async (req, res) => {
  const page = intInRange(req.query.page, "page", { min: 1, max: 1000, fallback: 1 });
  const limit = intInRange(req.query.limit, "limit", { min: 1, max: 50, fallback: 20 });
  const where = { userId: req.user.id };
  if (req.query.service) where.service = String(req.query.service);

  const { rows, count } = await Booking.findAndCountAll({
    where,
    order: [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
  });
  return res.json({
    bookings: rows.map((b) => serializeBooking(b)),
    pagination: { page, limit, total: count, hasMore: page * limit < count },
  });
});

router.get("/bookings/:id", authenticateTokenUser, async (req, res) => {
  const booking = await findOwnBooking(req);
  // Keep in-flight supplier bookings fresh while the customer is looking at them.
  if (booking.providerRef && ["pending", "processing"].includes(booking.status)) {
    await refreshBooking(booking).catch((error) => {
      console.error("refreshBooking failed:", booking.reference, error.code || error.message);
    });
  }
  return res.json({ booking: serializeBooking(booking) });
});

router.post("/bookings/:id/cancel", authenticateTokenUser, async (req, res) => {
  const booking = await findOwnBooking(req);
  await cancelBooking(booking);
  return res.json({ booking: serializeBooking(booking) });
});

router.get("/bookings/:id/vouchers", authenticateTokenUser, async (req, res) => {
  const booking = await findOwnBooking(req);
  if (booking.service !== "activity" || booking.status !== "confirmed") {
    return res.json({ data: [] });
  }
  const list = await hermes.listActivityVouchers(booking.providerRef);
  return res.json({
    data: (list.data || []).map((v) => ({ id: v.id, visual_id: v.visual_id, generated_at: v.generated_at })),
  });
});

router.get("/bookings/:id/vouchers/:voucherId/download", authenticateTokenUser, async (req, res) => {
  const booking = await findOwnBooking(req);
  if (booking.service !== "activity" || booking.status !== "confirmed") {
    throw new HttpError(404, "لا توجد قسيمة");
  }
  const pdf = await hermes.downloadActivityVoucher(booking.providerRef, req.params.voucherId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${booking.reference}.pdf"`);
  return res.send(Buffer.from(pdf));
});

module.exports = router;

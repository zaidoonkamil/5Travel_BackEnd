const express = require("express");
const { Booking, Payment, User, WalletTransaction } = require("../models");
const { authenticateTokenUser } = require("../middlewares/auth");
const { serializeBooking } = require("../services/bookings");
const {
  bookingQuote,
  payBookingFromWallet,
  startCardPayment,
  markPaymentPaid,
  syncPayment,
  serializePayment,
  userBalance,
} = require("../services/payments");
const { serializeTransaction } = require("../services/wallet");
const swiftpay = require("../services/swiftpay");
const { HttpError, badRequest } = require("../services/httpError");
const { intInRange } = require("../services/validators");

const router = express.Router();

// Top-up limits in IQD.
const MIN_TOPUP = 5000;
const MAX_TOPUP = 5000000;

// ---------------- Wallet ----------------

router.get("/wallet", authenticateTokenUser, async (req, res) => {
  const page = intInRange(req.query.page, "page", { min: 1, max: 1000, fallback: 1 });
  const limit = intInRange(req.query.limit, "limit", { min: 1, max: 50, fallback: 20 });
  const { rows, count } = await WalletTransaction.findAndCountAll({
    where: { userId: req.user.id },
    order: [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
  });
  return res.json({
    balance: await userBalance(req.user.id),
    currency: "IQD",
    cardPayments: swiftpay.isConfigured(),
    limits: { minTopup: MIN_TOPUP, maxTopup: MAX_TOPUP },
    transactions: rows.map(serializeTransaction),
    pagination: { page, limit, total: count, hasMore: page * limit < count },
  });
});

router.post("/wallet/topup", authenticateTokenUser, async (req, res) => {
  const amount = Math.round(Number(req.body?.amount));
  if (!Number.isSafeInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) {
    throw badRequest(`مبلغ الشحن بين ${MIN_TOPUP.toLocaleString("en-US")} و ${MAX_TOPUP.toLocaleString("en-US")} د.ع`);
  }
  if (amount % 250) throw badRequest("المبلغ يكون من مضاعفات 250 د.ع");
  const user = await User.findByPk(req.user.id);
  const payment = await startCardPayment(user, { purpose: "topup", amount });
  return res.status(201).json({ payment: serializePayment(payment) });
});

// ---------------- Paying a booking ----------------

async function findOwnBooking(req) {
  const booking = await Booking.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!booking) throw new HttpError(404, "الحجز غير موجود");
  return booking;
}

// Amount in dinars and the wallet balance, for the payment screen.
router.get("/bookings/:id/payment", authenticateTokenUser, async (req, res) => {
  const booking = await findOwnBooking(req);
  return res.json({
    ...(await bookingQuote(booking)),
    balance: await userBalance(req.user.id),
    cardPayments: swiftpay.isConfigured(),
  });
});

// method "wallet": paid at once from the balance. method "card": returns a checkout to open.
router.post("/bookings/:id/pay", authenticateTokenUser, async (req, res) => {
  const booking = await findOwnBooking(req);
  const method = req.body?.method;
  if (method === "wallet") {
    await payBookingFromWallet(booking);
    return res.json({ booking: serializeBooking(booking), balance: await userBalance(req.user.id) });
  }
  if (method === "card") {
    const user = await User.findByPk(req.user.id);
    const payment = await startCardPayment(user, { purpose: "booking", booking });
    return res.status(201).json({ payment: serializePayment(payment) });
  }
  throw badRequest("طريقة الدفع غير معروفة");
});

// ---------------- Card payments ----------------

// Polled by the app while the checkout is open; also asks SwiftPay directly in case the
// webhook is late, so a payment never waits on it.
router.get("/payments/:id", authenticateTokenUser, async (req, res) => {
  let payment = await Payment.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!payment) throw new HttpError(404, "الدفعة غير موجودة");
  payment = await syncPayment(payment);
  const booking = payment.bookingId ? await Booking.findByPk(payment.bookingId) : null;
  return res.json({
    payment: serializePayment(payment),
    booking: booking ? serializeBooking(booking) : null,
    balance: await userBalance(req.user.id),
  });
});

// SwiftPay → us. Signed with the webhook secret; any 2xx acknowledges, so unknown links
// are acknowledged too (they are not ours to retry).
router.post("/webhooks/swiftpay", async (req, res) => {
  if (!swiftpay.verifyWebhookSignature(req.rawBody, req.get("X-SwiftPay-Signature"))) {
    return res.status(401).json({ error: "invalid signature" });
  }
  const { event, data } = req.body || {};
  if (["payment_link.paid", "payment.succeeded"].includes(event) && data?.paymentLinkId && data.status === "SUCCEEDED") {
    const payment = await Payment.findOne({ where: { linkId: String(data.paymentLinkId) } });
    if (payment) await markPaymentPaid(payment, { providerPaymentId: data.paymentId, amount: data.amount, isLive: data.isLive });
  }
  return res.json({ received: true });
});

module.exports = router;

const { Booking, Payment, User } = require("../models");
const swiftpay = require("./swiftpay");
const wallet = require("./wallet");
const { currentRates } = require("./currency");
const { issueBooking } = require("./bookingActions");
const { notifyBookingStatus, sendNotificationToUser } = require("./notifications");
const { notifyPartnerOfBooking } = require("./partners");
const { HttpError } = require("./httpError");

const SUPPLIER_SERVICES = new Set(["flight", "hotel", "activity"]);
// Same rounding the app shows prices with.
const IQD_STEP = 250;
const LINK_LIFETIME_MS = 60 * 60 * 1000;

// Prices are kept in USD; the wallet and the gateway work in whole dinars.
async function toIqd(usd) {
  const { rates } = await currentRates();
  const rate = Number(rates.IQD);
  if (!rate) throw new HttpError(503, "سعر صرف الدينار غير متوفر حالياً، حاول بعد قليل");
  return Math.max(IQD_STEP, Math.round((Number(usd) * rate) / IQD_STEP) * IQD_STEP);
}

// Why this booking cannot be paid right now, or null.
function payProblem(booking) {
  if (booking.paymentStatus !== "unpaid") return "الحجز مدفوع مسبقاً";
  if (booking.status !== "pending") return "لا يمكن دفع هذا الحجز";
  if (booking.providerDeadline && new Date(booking.providerDeadline).getTime() < Date.now()) {
    return "انتهت مهلة الحجز، احجز من جديد";
  }
  return null;
}

// What the customer would pay, for the payment screen.
async function bookingQuote(booking) {
  return { amount: await toIqd(booking.sellAmount), currency: "IQD", payable: !payProblem(booking), problem: payProblem(booking) };
}

// Once paid: supplier bookings are issued straight away; the rest (admin / partner places)
// now reach their owner for confirmation.
async function afterBookingPaid(booking) {
  if (!SUPPLIER_SERVICES.has(booking.service)) {
    await notifyPartnerOfBooking(booking);
    return booking;
  }
  const before = booking.status;
  try {
    await issueBooking(booking);
  } catch (error) {
    // The outcome at the supplier is unknown (e.g. a timeout), so the money is not refunded
    // automatically: the booking stays paid and pending for the admin to retry or cancel.
    console.error("[payments] auto-issue failed:", booking.reference, error.code || error.message);
    await booking.update({
      adminNote: [booking.adminNote, `تعذر الإصدار التلقائي بعد الدفع: ${error.message}`].filter(Boolean).join("\n"),
    });
  }
  if (booking.status !== before) notifyBookingStatus(booking);
  return booking;
}

// Pays a booking from the wallet balance.
async function payBookingFromWallet(booking) {
  const problem = payProblem(booking);
  if (problem) throw new HttpError(409, problem);
  const amount = await toIqd(booking.sellAmount);

  await wallet.debit(booking.userId, amount, { type: "booking", bookingId: booking.id, note: booking.reference });
  const [marked] = await Booking.update(
    { paymentStatus: "paid", paidAmount: amount, paidAt: new Date() },
    { where: { id: booking.id, paymentStatus: "unpaid" } }
  );
  if (!marked) {
    // Paid by a parallel request in the meantime: give this charge back.
    await wallet.credit(booking.userId, amount, { type: "refund", bookingId: booking.id, note: `${booking.reference} مدفوع مسبقاً` });
    throw new HttpError(409, "الحجز مدفوع مسبقاً");
  }
  await booking.reload();
  return afterBookingPaid(booking);
}

// Opens a SwiftPay checkout for a wallet top-up or for a booking (paid in full by card).
async function startCardPayment(user, { purpose, amount, booking }) {
  if (purpose === "booking") {
    const problem = payProblem(booking);
    if (problem) throw new HttpError(409, problem);
    amount = await toIqd(booking.sellAmount);
  }
  const payment = await Payment.create({ userId: user.id, purpose, bookingId: booking?.id ?? null, amount });
  const link = await swiftpay
    .createPaymentLink({
      title: purpose === "booking" ? `حجز ${booking.reference} - 5 Travel` : "شحن محفظة 5 Travel",
      amount,
      customerName: user.fullName,
      customerPhone: user.phone,
      expiresAt: new Date(Date.now() + LINK_LIFETIME_MS).toISOString(),
    })
    .catch(async (error) => {
      await payment.update({ status: "failed" });
      throw error;
    });
  await payment.update({ linkId: link.id, payPageUrl: link.payPageUrl });
  return payment;
}

// Live keys only accept live payments (a test payment must never credit real money).
function modeMatches(isLive) {
  const live = String(process.env.SWIFTPAY_API_KEY || "").startsWith("spi_live_");
  return !live || isLive === true;
}

// Applies a successful card payment exactly once: credits the wallet, then pays the booking
// it was for. If the booking can no longer be paid the money simply stays in the wallet.
async function markPaymentPaid(payment, { providerPaymentId, amount, isLive }) {
  if (payment.status !== "pending") return payment;
  if (!modeMatches(isLive)) {
    console.error("[payments] test-mode payment ignored on a live key:", payment.id);
    return payment;
  }
  if (Number(amount) < payment.amount) {
    console.error("[payments] paid amount below the expected one:", payment.id, amount, payment.amount);
    return payment;
  }
  const [flipped] = await Payment.update(
    { status: "paid", paidAt: new Date(), providerPaymentId: providerPaymentId || null },
    { where: { id: payment.id, status: "pending" } }
  );
  if (!flipped) return payment.reload();
  await payment.reload();

  await wallet.credit(payment.userId, payment.amount, {
    type: "topup",
    paymentId: payment.id,
    bookingId: payment.bookingId,
    note: payment.purpose === "booking" ? "دفع بالبطاقة" : "شحن بالبطاقة",
  });

  if (payment.purpose === "booking") {
    const booking = await Booking.findByPk(payment.bookingId);
    try {
      await payBookingFromWallet(booking);
      return payment;
    } catch (error) {
      sendNotificationToUser(
        payment.userId,
        `تم استلام ${payment.amount.toLocaleString("en-US")} د.ع بمحفظتك، بس تعذر إكمال الحجز: ${error.message}`,
        "المبلغ بمحفظتك",
        { type: "wallet" }
      ).catch(() => {});
      return payment;
    }
  }
  sendNotificationToUser(
    payment.userId,
    `تمت إضافة ${payment.amount.toLocaleString("en-US")} د.ع لمحفظتك.`,
    "تم شحن المحفظة ✅",
    { type: "wallet" }
  ).catch(() => {});
  return payment;
}

// Fallback when the webhook has not arrived (or is not set up): asks SwiftPay about the link.
async function syncPayment(payment) {
  if (payment.status !== "pending" || !payment.linkId) return payment;
  const link = await swiftpay.getPaymentLink(payment.linkId).catch(() => null);
  const paid = (link?.payments || []).find((p) => p.status === "SUCCEEDED");
  if (paid) return markPaymentPaid(payment, { providerPaymentId: paid.id, amount: paid.amount, isLive: link.isLive });
  if (link && ["EXPIRED", "DISABLED"].includes(link.status)) await payment.update({ status: "failed" });
  return payment;
}

function serializePayment(payment) {
  return {
    id: payment.id,
    purpose: payment.purpose,
    bookingId: payment.bookingId,
    amount: payment.amount,
    currency: "IQD",
    status: payment.status,
    payPageUrl: payment.status === "pending" ? payment.payPageUrl : null,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
  };
}

async function userBalance(userId) {
  const user = await User.findByPk(userId, { attributes: ["walletBalance"] });
  return user?.walletBalance ?? 0;
}

module.exports = {
  toIqd,
  bookingQuote,
  payBookingFromWallet,
  startCardPayment,
  markPaymentPaid,
  syncPayment,
  serializePayment,
  userBalance,
};

const { hermes, newIdempotencyKey } = require("./hermesClient");
const { mapProviderStatus } = require("./bookings");
const { HttpError } = require("./httpError");
const wallet = require("./wallet");
const { Booking } = require("../models");

const SUPPLIER_SERVICES = new Set(["flight", "hotel", "activity"]);

const fetchers = {
  flight: (ref) => hermes.getFlightOrder(ref),
  hotel: (ref) => hermes.getHotelOrder(ref),
  activity: (ref) => hermes.getActivityBooking(ref),
};

function deadlineOf(service, order) {
  if (service === "flight") return order.ticketing_deadline;
  if (service === "hotel") return order.payment_deadline;
  return null;
}

async function applyProviderState(booking, order) {
  const mapped = mapProviderStatus(booking.service, order.status);
  await booking.update({
    providerStatus: order.status || booking.providerStatus,
    status: mapped || booking.status,
    providerDeadline: deadlineOf(booking.service, order) || booking.providerDeadline,
    details: { ...(booking.details || {}), providerSnapshot: order },
  });
  // The supplier dropped a booking the customer already paid for (e.g. the hold expired).
  if (["cancelled", "failed"].includes(booking.status)) await refundToWallet(booking);
  return booking;
}

function requireSupplierRef(booking) {
  if (!SUPPLIER_SERVICES.has(booking.service)) return false;
  if (!booking.providerRef) {
    throw new HttpError(409, "الحجز غير مرتبط بطلب لدى المزود");
  }
  return true;
}

// Re-reads the order from the supplier and syncs our status.
async function refreshBooking(booking) {
  if (!requireSupplierRef(booking)) return booking;
  const order = await fetchers[booking.service](booking.providerRef);
  return applyProviderState(booking, order);
}

// Puts what the customer paid back in their wallet (cards cannot be refunded through the gateway).
// Safe to call twice: only the call that flips paid → refunded credits the wallet.
async function refundToWallet(booking, note) {
  if (booking.paymentStatus !== "paid" || !booking.paidAmount) return false;
  const [flipped] = await Booking.update(
    { paymentStatus: "refunded" },
    { where: { id: booking.id, paymentStatus: "paid" } }
  );
  if (!flipped) return false;
  booking.paymentStatus = "refunded";
  await wallet.credit(booking.userId, booking.paidAmount, {
    type: "refund",
    bookingId: booking.id,
    note: note || `استرجاع الحجز ${booking.reference}`,
  });
  return true;
}

// Issue the ticket / confirm the hotel / confirm the activity (after the customer paid).
async function issueBooking(booking) {
  if (booking.status !== "pending") {
    throw new HttpError(409, "يمكن تأكيد الحجوزات المعلقة فقط");
  }
  // Payments are online only: nothing is confirmed before the money is in.
  if (booking.paymentStatus !== "paid") {
    throw new HttpError(409, "الحجز غير مدفوع بعد", { code: "booking_unpaid" });
  }
  if (!requireSupplierRef(booking)) {
    await booking.update({ status: "confirmed" });
    return booking;
  }

  const key = newIdempotencyKey();
  if (booking.service === "flight") await hermes.issueFlightTicket(booking.providerRef, key);
  if (booking.service === "hotel") await hermes.confirmHotelOrder(booking.providerRef, key);
  if (booking.service === "activity") await hermes.confirmActivityBooking(booking.providerRef, key);

  await booking.update({ status: "processing" });
  return refreshBooking(booking);
}

// Cancels a held booking and releases the supplier hold.
async function cancelBooking(booking) {
  if (booking.status !== "pending") {
    throw new HttpError(409, "يمكن إلغاء الحجوزات المعلقة فقط");
  }
  if (!requireSupplierRef(booking)) {
    await booking.update({ status: "cancelled" });
    await refundToWallet(booking);
    return booking;
  }

  const key = newIdempotencyKey();
  if (booking.service === "flight") await hermes.cancelFlightOrder(booking.providerRef, key);
  if (booking.service === "hotel") await hermes.cancelHotelOrder(booking.providerRef, key);
  if (booking.service === "activity") await hermes.cancelActivityBooking(booking.providerRef, key);

  await booking.update({ status: "cancelled" });
  await refundToWallet(booking);
  return refreshBooking(booking).catch(() => booking);
}

async function getRefundQuote(booking) {
  if (booking.service === "flight") {
    if (booking.status !== "confirmed") throw new HttpError(409, "الاسترداد متاح للتذاكر المصدرة فقط");
    return hermes.getFlightRefundQuote(booking.providerRef);
  }
  if (booking.service === "hotel") {
    return hermes.getHotelCancellationQuote(booking.providerRef);
  }
  throw new HttpError(400, "لا يوجد عرض استرداد لهذا النوع");
}

// Refunds an issued flight ticket.
async function refundBooking(booking, body = {}) {
  if (booking.service !== "flight" || booking.status !== "confirmed") {
    throw new HttpError(409, "الاسترداد متاح لتذاكر الطيران المصدرة فقط");
  }
  await hermes.refundFlightOrder(booking.providerRef, body, newIdempotencyKey());
  await booking.update({ status: "refunded" });
  return refreshBooking(booking).catch(() => booking);
}

module.exports = {
  refundToWallet,
  refreshBooking,
  issueBooking,
  cancelBooking,
  getRefundQuote,
  refundBooking,
};

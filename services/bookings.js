const crypto = require("crypto");
const { Booking } = require("../models");

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomReference() {
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (const byte of bytes) code += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `FT-${code}`;
}

async function generateReference() {
  for (let i = 0; i < 5; i += 1) {
    const reference = randomReference();
    const exists = await Booking.count({ where: { reference } });
    if (!exists) return reference;
  }
  throw new Error("Could not generate a unique booking reference");
}

// Supplier status → our booking status.
const PROVIDER_STATUS_MAP = {
  flight: { held: "pending", ticketing: "processing", ticketed: "confirmed", cancelled: "cancelled", refunded: "refunded" },
  hotel: { held: "pending", confirming: "processing", confirmed: "confirmed", cancelled: "cancelled" },
  activity: { held: "pending", confirmed: "processing", issued: "confirmed", cancelled: "cancelled" },
};

function mapProviderStatus(service, providerStatus) {
  return PROVIDER_STATUS_MAP[service]?.[providerStatus] || null;
}

function serializeBooking(booking, { admin = false } = {}) {
  const raw = typeof booking?.toJSON === "function" ? booking.toJSON() : booking;
  const result = {
    id: raw.id,
    reference: raw.reference,
    service: raw.service,
    status: raw.status,
    title: raw.title,
    travelDate: raw.travelDate,
    currency: raw.currency,
    total: Number(raw.sellAmount),
    providerDeadline: raw.providerDeadline,
    contact: raw.contact,
    details: publicDetails(raw.details, admin),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };

  if (admin) {
    Object.assign(result, {
      userId: raw.userId,
      user: raw.user ? { id: raw.user.id, fullName: raw.user.fullName, email: raw.user.email, phone: raw.user.phone } : undefined,
      providerRef: raw.providerRef,
      providerStatus: raw.providerStatus,
      customItemId: raw.customItemId,
      costAmount: Number(raw.costAmount),
      markupAmount: Number(raw.markupAmount),
      adminNote: raw.adminNote,
    });
  }
  return result;
}

// The supplier snapshot holds cost prices; customers only get the safe parts.
function publicDetails(details, admin) {
  if (!details || admin) return details;
  const { providerSnapshot, ...rest } = details;
  return rest;
}

module.exports = {
  generateReference,
  mapProviderStatus,
  serializeBooking,
};

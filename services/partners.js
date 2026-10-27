const { Op } = require("sequelize");
const { Booking, CustomHotel, CustomActivity, User } = require("../models");
const { sendNotificationToUser } = require("./notifications");

// Listing types a partner can own, with the booking service each one produces.
const LISTING_TYPES = {
  hotel: { model: CustomHotel, service: "custom_hotel", name: (l) => l.name },
  activity: { model: CustomActivity, service: "custom_activity", name: (l) => l.title },
};

function serializeListing(type, listing) {
  return {
    type,
    id: listing.id,
    name: LISTING_TYPES[type].name(listing),
    // Hotels: hotel / chalet / farm. Activities: always "activity".
    category: type === "hotel" ? listing.category || "hotel" : "activity",
    city: listing.city,
    isActive: listing.isActive,
    ownerId: listing.ownerId ?? null,
  };
}

async function listingsOf(ownerId) {
  const [hotels, activities] = await Promise.all([
    CustomHotel.findAll({ where: { ownerId }, order: [["id", "DESC"]] }),
    CustomActivity.findAll({ where: { ownerId }, order: [["id", "DESC"]] }),
  ]);
  return [
    ...hotels.map((h) => serializeListing("hotel", h)),
    ...activities.map((a) => serializeListing("activity", a)),
  ];
}

// Bookings made on any of the given listings; null when there are none.
function bookingsWhere(listings) {
  const or = Object.entries(LISTING_TYPES)
    .map(([type, { service }]) => {
      const ids = listings.filter((l) => l.type === type).map((l) => l.id);
      return ids.length ? { service, customItemId: { [Op.in]: ids } } : null;
    })
    .filter(Boolean);
  // Unpaid requests are not real yet: the owner only hears about a booking once it is paid.
  return or.length ? { [Op.and]: [{ [Op.or]: or }, { paymentStatus: { [Op.ne]: "unpaid" } }] } : null;
}

// Links exactly these listings to the partner (taking them from any other partner)
// and releases the ones they had before but are no longer in the list.
async function assignListings(ownerId, listings) {
  for (const [type, { model }] of Object.entries(LISTING_TYPES)) {
    const ids = listings.filter((l) => l.type === type).map((l) => l.id);
    await model.update({ ownerId: null }, { where: { ownerId, ...(ids.length ? { id: { [Op.notIn]: ids } } : {}) } });
    if (ids.length) await model.update({ ownerId }, { where: { id: { [Op.in]: ids } } });
  }
}

// Tells the owner of the booked listing (if any) that a new request came in.
async function notifyPartnerOfBooking(booking) {
  const type = Object.keys(LISTING_TYPES).find((t) => LISTING_TYPES[t].service === booking.service);
  if (!type || !booking.customItemId) return;
  try {
    const listing = await LISTING_TYPES[type].model.findByPk(booking.customItemId, { attributes: ["id", "ownerId"] });
    if (!listing?.ownerId) return;
    const owner = await User.findByPk(listing.ownerId, { attributes: ["id", "isPartner", "isActive"] });
    if (!owner?.isPartner || owner.isActive === false) return;
    await sendNotificationToUser(
      owner.id,
      `${booking.title}: حجز جديد بانتظار تأكيدك (${booking.reference}).`,
      "حجز جديد 🛎️",
      { type: "partner_booking", bookingId: String(booking.id) }
    );
  } catch (error) {
    console.error("[partner] new booking notification failed:", error.message);
  }
}

module.exports = { LISTING_TYPES, serializeListing, listingsOf, bookingsWhere, assignListings, notifyPartnerOfBooking };

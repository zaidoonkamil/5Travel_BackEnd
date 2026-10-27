const express = require("express");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const { Booking, CustomHotel, CustomActivity, User } = require("../models");
const { requireAdmin } = require("../middlewares/auth");
const { LISTING_TYPES, serializeListing, listingsOf, bookingsWhere, assignListings } = require("../services/partners");
const { normalizePhone, phoneVariants } = require("../services/phoneUtils");
const { HttpError, badRequest } = require("../services/httpError");
const { requireText, toBool } = require("../services/validators");

const router = express.Router();
const MIN_PASSWORD_LENGTH = 8;

function requirePartnerPhone(value) {
  const phone = normalizePhone(value);
  if (!phone) throw badRequest("رقم الهاتف غير صالح، اكتبه بصيغة 07XXXXXXXXX", { param: "phone" });
  return phone;
}

function optionalPassword(value, required) {
  const password = String(value || "");
  if (!password && !required) return null;
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`, { param: "password" });
  }
  return password;
}

// [{type, id}] limited to listings that exist.
async function requireListings(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const [type, { model }] of Object.entries(LISTING_TYPES)) {
    const ids = [...new Set(value.filter((l) => l?.type === type).map((l) => Number(l.id)).filter(Number.isInteger))];
    if (!ids.length) continue;
    const found = await model.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id"] });
    result.push(...found.map((f) => ({ type, id: f.id })));
  }
  return result;
}

async function serializePartner(user) {
  const listings = await listingsOf(user.id);
  const where = bookingsWhere(listings);
  const [pending, total] = where
    ? await Promise.all([Booking.count({ where: { ...where, status: "pending" } }), Booking.count({ where })])
    : [0, 0];
  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    listings,
    bookings: { pending, total },
  };
}

router.get("/admin/partners", requireAdmin, async (req, res) => {
  const users = await User.findAll({ where: { isPartner: true }, order: [["id", "DESC"]] });
  return res.json({ partners: await Promise.all(users.map(serializePartner)) });
});

// Every listing a partner could be given, with its current owner.
router.get("/admin/partners/listings", requireAdmin, async (req, res) => {
  const [hotels, activities, owners] = await Promise.all([
    CustomHotel.findAll({ order: [["id", "DESC"]] }),
    CustomActivity.findAll({ order: [["id", "DESC"]] }),
    User.findAll({ where: { isPartner: true }, attributes: ["id", "fullName"] }),
  ]);
  const names = Object.fromEntries(owners.map((o) => [o.id, o.fullName]));
  const listings = [
    ...hotels.map((h) => serializeListing("hotel", h)),
    ...activities.map((a) => serializeListing("activity", a)),
  ].map((l) => ({ ...l, ownerName: l.ownerId ? names[l.ownerId] || null : null }));
  return res.json({ listings });
});

// Creates the partner account. A number that already has an app account is turned into
// a partner only when the admin confirms it (attachExisting), keeping its password.
router.post("/admin/partners", requireAdmin, async (req, res) => {
  const body = req.body || {};
  const fullName = requireText(body.fullName, "الاسم", 120);
  const phone = requirePartnerPhone(body.phone);
  const listings = await requireListings(body.listings);

  let user = await User.findOne({ where: { phone: { [Op.in]: phoneVariants(phone) } } });
  if (user) {
    if (user.role === "admin") throw new HttpError(409, "هذا الرقم لحساب أدمن");
    if (user.isPartner) throw new HttpError(409, "هذا الرقم شريك مسبقاً");
    if (!toBool(body.attachExisting)) {
      throw new HttpError(409, `يوجد حساب بهذا الرقم باسم ${user.fullName}`, { code: "phone_taken", fullName: user.fullName });
    }
    const password = optionalPassword(body.password, false);
    user.isPartner = true;
    user.fullName = fullName;
    if (password) {
      user.password = await bcrypt.hash(password, 12);
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }
    await user.save();
  } else {
    const password = optionalPassword(body.password, true);
    user = await User.create({
      fullName,
      phone,
      password: await bcrypt.hash(password, 12),
      role: "user",
      status: "active",
      isPartner: true,
    });
  }

  await assignListings(user.id, listings);
  return res.status(201).json({ partner: await serializePartner(user) });
});

router.put("/admin/partners/:id", requireAdmin, async (req, res) => {
  const user = await User.findOne({ where: { id: req.params.id, isPartner: true } });
  if (!user) throw new HttpError(404, "الشريك غير موجود");
  const body = req.body || {};

  if (body.fullName !== undefined) user.fullName = requireText(body.fullName, "الاسم", 120);
  if (body.phone !== undefined) {
    const phone = requirePartnerPhone(body.phone);
    const other = await User.findOne({ where: { phone: { [Op.in]: phoneVariants(phone) }, id: { [Op.ne]: user.id } } });
    if (other) throw new HttpError(409, "رقم الهاتف مستخدم بحساب آخر");
    user.phone = phone;
  }
  const password = optionalPassword(body.password, false);
  if (password) {
    user.password = await bcrypt.hash(password, 12);
    // Logs the partner out everywhere, so a leaked old password stops working.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
  }
  if (body.isActive !== undefined) user.isActive = toBool(body.isActive);
  await user.save();

  if (body.listings !== undefined) await assignListings(user.id, await requireListings(body.listings));
  return res.json({ partner: await serializePartner(user) });
});

// Back to a normal customer account; their listings go back to the admin alone.
router.delete("/admin/partners/:id", requireAdmin, async (req, res) => {
  const user = await User.findOne({ where: { id: req.params.id, isPartner: true } });
  if (!user) throw new HttpError(404, "الشريك غير موجود");
  await assignListings(user.id, []);
  user.isPartner = false;
  await user.save();
  return res.json({ ok: true });
});

module.exports = router;

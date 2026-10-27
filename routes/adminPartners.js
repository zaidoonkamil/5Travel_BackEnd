const express = require("express");
const { Op } = require("sequelize");
const { CustomHotel, CustomActivity, User } = require("../models");
const { requireAdmin } = require("../middlewares/auth");
const { LISTING_TYPES, serializeListing, listingsOf, assignListings } = require("../services/partners");
const { HttpError } = require("../services/httpError");
const { toBool } = require("../services/validators");

// A partner is a normal app user the admin gave listings to: the app then shows them the
// partner panel next to their usual account.
const router = express.Router();

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

// Every listing a user could be given, with its current owner.
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

async function findCustomer(id) {
  const user = await User.findByPk(id);
  if (!user) throw new HttpError(404, "المستخدم غير موجود");
  if (user.role === "admin") throw new HttpError(400, "حساب الأدمن لا يكون شريكاً");
  return user;
}

router.get("/admin/users/:id/partner", requireAdmin, async (req, res) => {
  const user = await findCustomer(req.params.id);
  return res.json({ isPartner: Boolean(user.isPartner), listings: await listingsOf(user.id) });
});

// Turns the partner panel on (with exactly these listings) or off (listings go back to the admin).
router.put("/admin/users/:id/partner", requireAdmin, async (req, res) => {
  const user = await findCustomer(req.params.id);
  const isPartner = toBool(req.body?.isPartner);
  await assignListings(user.id, isPartner ? await requireListings(req.body?.listings) : []);
  user.isPartner = isPartner;
  await user.save();
  return res.json({ isPartner, listings: await listingsOf(user.id) });
});

module.exports = router;

const express = require("express");
const { CustomHotel, CustomActivity, VisaOffer } = require("../models");
const { serializeCustomHotel, serializeCustomActivity } = require("../services/customSerializers");
const { listActiveAds } = require("./ads");

const router = express.Router();

// Home screen in one request: ad slides + featured admin-added hotels, activities and visas.
router.get("/home", async (req, res) => {
  const [ads, hotels, activities, visas] = await Promise.all([
    listActiveAds(req),
    CustomHotel.findAll({ where: { isActive: true }, order: [["sortOrder", "ASC"], ["id", "DESC"]], limit: 10 }),
    CustomActivity.findAll({ where: { isActive: true }, order: [["sortOrder", "ASC"], ["id", "DESC"]], limit: 10 }),
    VisaOffer.findAll({ where: { isActive: true }, order: [["sortOrder", "ASC"], ["id", "DESC"]], limit: 10 }),
  ]);
  const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
  return res.json({
    ads,
    customHotels: hotels.map((h) => serializeCustomHotel(h, req)),
    customActivities: activities.map((a) => serializeCustomActivity(a, req)),
    // Just enough for the home cards; the visa screen loads the full form.
    visas: visas.map((v) => ({
      id: v.id,
      country: v.country,
      title: v.title,
      image: v.image ? `${base}/${v.image}` : null,
      processingTime: v.processingTime,
      price: v.price === null ? null : Number(v.price),
    })),
  });
});

module.exports = router;

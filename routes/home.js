const express = require("express");
const { CustomHotel, CustomActivity } = require("../models");
const { serializeCustomHotel, serializeCustomActivity } = require("../services/customSerializers");
const { listActiveAds } = require("./ads");

const router = express.Router();

// Home screen in one request: ad slides + featured admin-added hotels and activities.
router.get("/home", async (req, res) => {
  const [ads, hotels, activities] = await Promise.all([
    listActiveAds(req),
    CustomHotel.findAll({ where: { isActive: true }, order: [["sortOrder", "ASC"], ["id", "DESC"]], limit: 10 }),
    CustomActivity.findAll({ where: { isActive: true }, order: [["sortOrder", "ASC"], ["id", "DESC"]], limit: 10 }),
  ]);
  return res.json({
    ads,
    customHotels: hotels.map((h) => serializeCustomHotel(h, req)),
    customActivities: activities.map((a) => serializeCustomActivity(a, req)),
  });
});

module.exports = router;

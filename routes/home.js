const express = require("express");
const { CustomHotel, CustomActivity } = require("../models");
const { serializeCustomHotel, serializeCustomActivity } = require("../services/customSerializers");

const router = express.Router();

// Featured admin-added hotels and activities for the app home screen.
router.get("/home", async (req, res) => {
  const [hotels, activities] = await Promise.all([
    CustomHotel.findAll({ where: { isActive: true }, order: [["sortOrder", "ASC"], ["id", "DESC"]], limit: 10 }),
    CustomActivity.findAll({ where: { isActive: true }, order: [["sortOrder", "ASC"], ["id", "DESC"]], limit: 10 }),
  ]);
  return res.json({
    customHotels: hotels.map((h) => serializeCustomHotel(h, req)),
    customActivities: activities.map((a) => serializeCustomActivity(a, req)),
  });
});

module.exports = router;

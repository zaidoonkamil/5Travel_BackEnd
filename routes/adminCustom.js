const express = require("express");
const fs = require("fs");
const path = require("path");
const { CustomHotel, CustomActivity } = require("../models");
const { requireAdmin } = require("../middlewares/auth");
const upload = require("../middlewares/uploads");
const { serializeCustomHotel, serializeCustomActivity } = require("../services/customSerializers");
const { HttpError } = require("../services/httpError");
const { cleanText, requireText, intInRange, decimal, toBool, parseJsonArray } = require("../services/validators");

const router = express.Router();

const MAX_IMAGES = 10;
const UPLOAD_PREFIX = "uploads/custom/";

function uploadedPaths(req) {
  return (req.files || []).map((file) => `${UPLOAD_PREFIX}${file.filename}`);
}

function removeFiles(paths) {
  for (const p of paths) {
    if (!String(p).startsWith(UPLOAD_PREFIX)) continue;
    const abs = path.join(__dirname, "..", p);
    fs.promises.unlink(abs).catch(() => {});
  }
}

// Images = the existing ones the admin kept (keepImages) + newly uploaded files.
function resolveImages(req, currentImages = []) {
  const uploaded = uploadedPaths(req);
  let kept = currentImages;
  if (req.body.keepImages !== undefined) {
    const requested = parseJsonArray(req.body.keepImages);
    kept = currentImages.filter((img) => requested.includes(img));
  }
  const images = [...kept, ...uploaded];
  if (images.length > MAX_IMAGES) {
    removeFiles(uploaded);
    throw new HttpError(400, `الحد الأقصى ${MAX_IMAGES} صور`);
  }
  return { images, removed: currentImages.filter((img) => !kept.includes(img)) };
}

// Multer errors happen before the handler; clean up on validation errors inside it.
async function withUploadCleanup(req, handler) {
  try {
    return await handler();
  } catch (error) {
    removeFiles(uploadedPaths(req));
    throw error;
  }
}

function parseHotel(body, { partial }) {
  const data = {};
  if (!partial || body.name !== undefined) data.name = requireText(body.name, "اسم الفندق", 200);
  if (!partial || body.city !== undefined) data.city = requireText(body.city, "المدينة", 120);
  if (!partial || body.pricePerNight !== undefined) {
    data.pricePerNight = decimal(body.pricePerNight, "سعر الليلة", { min: 1, max: 1000000 });
  }
  if (body.description !== undefined) data.description = String(body.description || "").trim().slice(0, 5000) || null;
  if (body.country !== undefined) data.country = cleanText(body.country, 120) || null;
  if (body.address !== undefined) data.address = cleanText(body.address, 300) || null;
  if (body.hermesCityId !== undefined) {
    const id = cleanText(body.hermesCityId, 40);
    data.hermesCityId = /^\d+$/.test(id) ? id : null;
  }
  if (body.stars !== undefined) data.stars = intInRange(body.stars, "النجوم", { min: 0, max: 5, fallback: 0 });
  if (body.mealPlan !== undefined) data.mealPlan = cleanText(body.mealPlan, 120) || null;
  if (body.facilities !== undefined) data.facilities = parseJsonArray(body.facilities);
  if (body.sortOrder !== undefined) data.sortOrder = intInRange(body.sortOrder, "الترتيب", { min: 0, max: 100000, fallback: 0 });
  if (body.isActive !== undefined) data.isActive = toBool(body.isActive);
  return data;
}

function parseActivity(body, { partial }) {
  const data = {};
  if (!partial || body.title !== undefined) data.title = requireText(body.title, "اسم النشاط", 200);
  if (!partial || body.city !== undefined) data.city = requireText(body.city, "المدينة", 120);
  if (!partial || body.priceAdult !== undefined) {
    data.priceAdult = decimal(body.priceAdult, "سعر البالغ", { min: 0, max: 1000000 });
  }
  if (body.priceChild !== undefined) {
    data.priceChild = decimal(body.priceChild, "سعر الطفل", { min: 0, max: 1000000, allowNull: true });
  }
  if (body.description !== undefined) data.description = String(body.description || "").trim().slice(0, 5000) || null;
  if (body.category !== undefined) data.category = cleanText(body.category, 120) || null;
  if (body.country !== undefined) data.country = cleanText(body.country, 120) || null;
  if (body.duration !== undefined) data.duration = cleanText(body.duration, 120) || null;
  if (body.includes !== undefined) data.includes = parseJsonArray(body.includes);
  if (body.sortOrder !== undefined) data.sortOrder = intInRange(body.sortOrder, "الترتيب", { min: 0, max: 100000, fallback: 0 });
  if (body.isActive !== undefined) data.isActive = toBool(body.isActive);
  return data;
}

function registerCrud({ basePath, Model, parse, serialize, notFoundMessage, key }) {
  router.get(basePath, requireAdmin, async (req, res) => {
    const items = await Model.findAll({ order: [["sortOrder", "ASC"], ["id", "DESC"]] });
    return res.json({ data: items.map((item) => serialize(item, req, { admin: true })) });
  });

  router.get(`${basePath}/:id`, requireAdmin, async (req, res) => {
    const item = await Model.findByPk(req.params.id);
    if (!item) throw new HttpError(404, notFoundMessage);
    return res.json({ [key]: serialize(item, req, { admin: true }) });
  });

  router.post(basePath, requireAdmin, upload.array("images", MAX_IMAGES), (req, res) =>
    withUploadCleanup(req, async () => {
      const data = parse(req.body || {}, { partial: false });
      data.images = resolveImages(req, []).images;
      const item = await Model.create(data);
      return res.status(201).json({ [key]: serialize(item, req, { admin: true }) });
    })
  );

  router.put(`${basePath}/:id`, requireAdmin, upload.array("images", MAX_IMAGES), (req, res) =>
    withUploadCleanup(req, async () => {
      const item = await Model.findByPk(req.params.id);
      if (!item) throw new HttpError(404, notFoundMessage);
      const data = parse(req.body || {}, { partial: true });
      const { images, removed } = resolveImages(req, item.images || []);
      data.images = images;
      await item.update(data);
      removeFiles(removed);
      return res.json({ [key]: serialize(item, req, { admin: true }) });
    })
  );

  router.delete(`${basePath}/:id`, requireAdmin, async (req, res) => {
    const item = await Model.findByPk(req.params.id);
    if (!item) throw new HttpError(404, notFoundMessage);
    const images = item.images || [];
    await item.destroy();
    removeFiles(images);
    return res.json({ deleted: true });
  });
}

registerCrud({
  basePath: "/admin/custom-hotels",
  Model: CustomHotel,
  parse: parseHotel,
  serialize: serializeCustomHotel,
  notFoundMessage: "الفندق غير موجود",
  key: "hotel",
});

registerCrud({
  basePath: "/admin/custom-activities",
  Model: CustomActivity,
  parse: parseActivity,
  serialize: serializeCustomActivity,
  notFoundMessage: "النشاط غير موجود",
  key: "activity",
});

module.exports = router;

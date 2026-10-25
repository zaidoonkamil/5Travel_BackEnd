const express = require("express");
const fs = require("fs");
const path = require("path");
const { Advertisement, CustomHotel, CustomActivity } = require("../models");
const { requireAdmin } = require("../middlewares/auth");
const upload = require("../middlewares/uploads");
const { absoluteImages } = require("../services/customSerializers");
const { HttpError, badRequest } = require("../services/httpError");
const { cleanText, intInRange, toBool } = require("../services/validators");

const router = express.Router();

const UPLOAD_PREFIX = "uploads/custom/";
const ACTION_TYPES = ["none", "url", "custom_hotel", "custom_activity", "flights", "hotels", "activities"];

function removeFile(p) {
  if (!p || !String(p).startsWith(UPLOAD_PREFIX)) return;
  fs.promises.unlink(path.join(__dirname, "..", p)).catch(() => {});
}

function serializeAd(ad, req, { admin = false } = {}) {
  const json = typeof ad.toJSON === "function" ? ad.toJSON() : ad;
  const result = {
    id: json.id,
    title: json.title,
    description: json.description,
    imageUrl: absoluteImages([json.image], req)[0] || null,
    actionType: json.actionType,
    actionValue: json.actionValue,
  };
  if (admin) {
    Object.assign(result, {
      image: json.image,
      isActive: json.isActive,
      sortOrder: json.sortOrder,
      createdAt: json.createdAt,
      updatedAt: json.updatedAt,
    });
  }
  return result;
}

async function parseAction(body, current = {}) {
  const actionType = body.actionType !== undefined ? String(body.actionType) : current.actionType || "none";
  if (!ACTION_TYPES.includes(actionType)) throw badRequest("نوع الرابط غير صالح");

  let actionValue = body.actionValue !== undefined ? cleanText(body.actionValue, 500) : current.actionValue || "";
  if (actionType === "url") {
    if (!/^https?:\/\/\S+$/i.test(actionValue)) throw badRequest("الرابط يجب أن يبدأ بـ http:// أو https://");
  } else if (actionType === "custom_hotel" || actionType === "custom_activity") {
    const id = Number.parseInt(actionValue, 10);
    const Model = actionType === "custom_hotel" ? CustomHotel : CustomActivity;
    if (!Number.isSafeInteger(id) || !(await Model.findByPk(id))) {
      throw badRequest(actionType === "custom_hotel" ? "اختر فندقاً موجوداً" : "اختر نشاطاً موجوداً");
    }
    actionValue = String(id);
  } else {
    actionValue = null;
  }
  return { actionType, actionValue };
}

/** Active slides for the app (also included in GET /home). */
async function listActiveAds(req) {
  const ads = await Advertisement.findAll({
    where: { isActive: true },
    order: [["sortOrder", "ASC"], ["createdAt", "DESC"]],
  });
  return ads.map((ad) => serializeAd(ad, req));
}

router.get("/ads", async (req, res) => {
  return res.json({ ads: await listActiveAds(req) });
});

router.get("/admin/ads", requireAdmin, async (req, res) => {
  const ads = await Advertisement.findAll({ order: [["sortOrder", "ASC"], ["createdAt", "DESC"]] });
  return res.json({ ads: ads.map((ad) => serializeAd(ad, req, { admin: true })) });
});

router.post("/admin/ads", requireAdmin, upload.single("image"), async (req, res) => {
  const image = req.file ? `${UPLOAD_PREFIX}${req.file.filename}` : null;
  try {
    if (!image) throw badRequest("صورة الإعلان مطلوبة");
    const body = req.body || {};
    const ad = await Advertisement.create({
      title: cleanText(body.title, 120),
      description: cleanText(body.description, 300) || null,
      image,
      ...(await parseAction(body)),
      isActive: body.isActive === undefined ? true : toBool(body.isActive),
      sortOrder: intInRange(body.sortOrder, "الترتيب", { min: 0, max: 100000, fallback: 0 }),
      updatedByAdminId: req.user.id,
    });
    return res.status(201).json({ ad: serializeAd(ad, req, { admin: true }) });
  } catch (error) {
    removeFile(image);
    throw error;
  }
});

router.put("/admin/ads/:id", requireAdmin, upload.single("image"), async (req, res) => {
  const newImage = req.file ? `${UPLOAD_PREFIX}${req.file.filename}` : null;
  try {
    const ad = await Advertisement.findByPk(req.params.id);
    if (!ad) throw new HttpError(404, "الإعلان غير موجود");
    const body = req.body || {};

    if (body.title !== undefined) ad.title = cleanText(body.title, 120);
    if (body.description !== undefined) ad.description = cleanText(body.description, 300) || null;
    if (body.sortOrder !== undefined) ad.sortOrder = intInRange(body.sortOrder, "الترتيب", { min: 0, max: 100000, fallback: 0 });
    if (body.isActive !== undefined) ad.isActive = toBool(body.isActive);
    Object.assign(ad, await parseAction(body, ad));
    const oldImage = newImage ? ad.image : null;
    if (newImage) ad.image = newImage;
    ad.updatedByAdminId = req.user.id;

    await ad.save();
    removeFile(oldImage);
    return res.json({ ad: serializeAd(ad, req, { admin: true }) });
  } catch (error) {
    removeFile(newImage);
    throw error;
  }
});

router.delete("/admin/ads/:id", requireAdmin, async (req, res) => {
  const ad = await Advertisement.findByPk(req.params.id);
  if (!ad) throw new HttpError(404, "الإعلان غير موجود");
  const image = ad.image;
  await ad.destroy();
  removeFile(image);
  return res.json({ deleted: true });
});

module.exports = router;
module.exports.listActiveAds = listActiveAds;

// Admin-added hotels / activities. Images are stored as relative paths
// (uploads/custom/xxx.jpg) and returned as absolute URLs.

function baseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function absoluteImages(images, req) {
  if (!Array.isArray(images)) return [];
  const base = baseUrl(req);
  return images.map((img) => (/^https?:\/\//i.test(img) ? img : `${base}/${String(img).replace(/^\/+/, "")}`));
}

function serializeCustomHotel(hotel, req, { admin = false } = {}) {
  const raw = typeof hotel?.toJSON === "function" ? hotel.toJSON() : hotel;
  const result = {
    id: raw.id,
    source: "custom",
    name: raw.name,
    description: raw.description,
    city: raw.city,
    country: raw.country,
    address: raw.address,
    stars: raw.stars,
    pricePerNight: Number(raw.pricePerNight),
    currency: "USD",
    mealPlan: raw.mealPlan,
    facilities: raw.facilities || [],
    images: absoluteImages(raw.images, req),
  };
  if (admin) {
    Object.assign(result, {
      hermesCityId: raw.hermesCityId,
      imagePaths: raw.images || [],
      sortOrder: raw.sortOrder,
      isActive: raw.isActive,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
  return result;
}

function serializeCustomActivity(activity, req, { admin = false } = {}) {
  const raw = typeof activity?.toJSON === "function" ? activity.toJSON() : activity;
  const result = {
    id: raw.id,
    source: "custom",
    title: raw.title,
    description: raw.description,
    category: raw.category,
    city: raw.city,
    country: raw.country,
    duration: raw.duration,
    includes: raw.includes || [],
    priceAdult: Number(raw.priceAdult),
    priceChild: raw.priceChild === null || raw.priceChild === undefined ? null : Number(raw.priceChild),
    currency: "USD",
    images: absoluteImages(raw.images, req),
  };
  if (admin) {
    Object.assign(result, {
      imagePaths: raw.images || [],
      sortOrder: raw.sortOrder,
      isActive: raw.isActive,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
  return result;
}

module.exports = { serializeCustomHotel, serializeCustomActivity, absoluteImages };

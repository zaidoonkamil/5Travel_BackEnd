const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Op } = require("sequelize");
const { User, VisaOffer, VisaApplication } = require("../models");
const { authenticateTokenUser, requireAdmin } = require("../middlewares/auth");
const { imageUpload } = require("../middlewares/uploads");
const { sendNotificationToUser } = require("../services/notifications");
const { HttpError, badRequest, notFound } = require("../services/httpError");
const { cleanText, requireText, intInRange, decimal, toBool } = require("../services/validators");
const {
  isUpload,
  normalizeFields,
  validateAnswers,
  documentUpload,
  collectFiles,
  fileInfo,
  removeStored,
  signedUrl,
  verifySignature,
  PRIVATE_DIR,
} = require("../services/visaForms");

const router = express.Router();
const imageUploader = imageUpload("visa");

const STATUSES = ["submitted", "reviewing", "needs_info", "processing", "approved", "rejected", "cancelled"];
const CLOSED = new Set(["approved", "rejected", "cancelled"]);

// What the customer is told when the team moves their application.
const STATUS_PUSH = {
  reviewing: "طلب الفيزا قيد المراجعة",
  needs_info: "نحتاج معلومات إضافية لطلب الفيزا",
  processing: "طلب الفيزا قيد المعالجة",
  approved: "تمت الموافقة على الفيزا 🎉",
  rejected: "تم رفض طلب الفيزا",
  cancelled: "تم إلغاء طلب الفيزا",
};

function publicBase(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return configured || `${req.protocol}://${req.get("host")}`;
}

const absolute = (req, p) => (p ? (/^https?:\/\//i.test(p) ? p : `${publicBase(req)}/${String(p).replace(/^\/+/, "")}`) : null);

function serializeOffer(offer, req) {
  const raw = typeof offer.toJSON === "function" ? offer.toJSON() : offer;
  return {
    id: raw.id,
    country: raw.country,
    title: raw.title,
    image: absolute(req, raw.image),
    description: raw.description,
    processingTime: raw.processingTime,
    validity: raw.validity,
    price: raw.price === null || raw.price === undefined ? null : Number(raw.price),
    currency: "USD",
    fields: raw.fields || [],
    isActive: raw.isActive,
    sortOrder: raw.sortOrder,
  };
}

function withUrls(req, applicationId, list) {
  return (list || []).map((f) => ({ ...f, url: signedUrl(req, applicationId, f.file) }));
}

function serializeApplication(app, req, { admin = false, summary = false } = {}) {
  const raw = typeof app.toJSON === "function" ? app.toJSON() : app;
  const visa = { ...raw.visa, image: absolute(req, raw.visa?.image) };
  const base = {
    id: raw.id,
    reference: raw.reference,
    status: raw.status,
    visa,
    userNote: raw.userNote,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
  if (summary && !admin) return base;
  const files = {};
  for (const [key, list] of Object.entries(raw.files || {})) files[key] = withUrls(req, raw.id, list);
  const result = {
    ...base,
    visaId: raw.visaId,
    fields: raw.fields,
    answers: raw.answers,
    files,
    resultFiles: withUrls(req, raw.id, raw.resultFiles),
    timeline: raw.timeline || [],
  };
  if (admin) {
    result.adminNote = raw.adminNote;
    if (raw.user) result.user = { id: raw.user.id, fullName: raw.user.fullName, phone: raw.user.phone, email: raw.user.email };
  }
  return result;
}

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function newReference() {
  for (let i = 0; i < 5; i += 1) {
    let code = "";
    for (const byte of crypto.randomBytes(6)) code += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
    const reference = `VS-${code}`;
    if (!(await VisaApplication.count({ where: { reference } }))) return reference;
  }
  throw new Error("Could not generate a unique visa reference");
}

const entry = (status, by, note) => ({ status, by, note: note || null, at: new Date().toISOString() });

// Runs the handler; on any error the files multer just stored are deleted.
async function cleaningUp(req, handler) {
  try {
    return await handler();
  } catch (error) {
    removeStored(req.files);
    throw error;
  }
}

// ---------------- Catalogue (public) ----------------

router.get("/visas", async (req, res) => {
  const offers = await VisaOffer.findAll({ where: { isActive: true }, order: [["sortOrder", "ASC"], ["id", "DESC"]] });
  return res.json({ visas: offers.map((o) => serializeOffer(o, req)) });
});

router.get("/visas/:id", async (req, res) => {
  const offer = await VisaOffer.findOne({ where: { id: intInRange(req.params.id, "id", { min: 1, max: 2 ** 31 }), isActive: true } });
  if (!offer) throw notFound("الفيزا غير متوفرة");
  return res.json({ visa: serializeOffer(offer, req) });
});

// ---------------- Customer applications ----------------

router.post("/visas/:id/apply", authenticateTokenUser, documentUpload.any(), (req, res) =>
  cleaningUp(req, async () => {
    const offer = await VisaOffer.findOne({ where: { id: intInRange(req.params.id, "id", { min: 1, max: 2 ** 31 }), isActive: true } });
    if (!offer) throw notFound("الفيزا غير متوفرة");
    const fields = offer.fields || [];
    const answers = validateAnswers(fields, req.body.answers);
    const files = collectFiles(fields, req.files);

    const application = await VisaApplication.create({
      reference: await newReference(),
      userId: req.user.id,
      visaId: offer.id,
      visa: {
        country: offer.country,
        title: offer.title,
        image: offer.image,
        price: offer.price === null ? null : Number(offer.price),
        currency: "USD",
        processingTime: offer.processingTime,
        validity: offer.validity,
      },
      fields,
      answers,
      files,
      timeline: [entry("submitted", "user")],
    });
    return res.status(201).json({ application: serializeApplication(application, req) });
  })
);

router.get("/visa/applications", authenticateTokenUser, async (req, res) => {
  const list = await VisaApplication.findAll({ where: { userId: req.user.id }, order: [["id", "DESC"]], limit: 100 });
  return res.json({ applications: list.map((a) => serializeApplication(a, req, { summary: true })) });
});

async function ownApplication(req) {
  const app = await VisaApplication.findOne({
    where: { id: intInRange(req.params.id, "id", { min: 1, max: 2 ** 31 }), userId: req.user.id },
  });
  if (!app) throw notFound("الطلب غير موجود");
  return app;
}

router.get("/visa/applications/:id", authenticateTokenUser, async (req, res) => {
  return res.json({ application: serializeApplication(await ownApplication(req), req) });
});

// The team asked for more: the customer edits answers and files, then it goes back to review.
// keepFiles = { [fieldKey]: [stored file names to keep] }; new files come as "file_<key>".
router.put("/visa/applications/:id", authenticateTokenUser, documentUpload.any(), (req, res) =>
  cleaningUp(req, async () => {
    const app = await ownApplication(req);
    if (app.status !== "needs_info") throw new HttpError(409, "لا يمكن تعديل الطلب في حالته الحالية");

    let keepRequest = {};
    try {
      keepRequest = JSON.parse(req.body.keepFiles || "{}") || {};
    } catch (_) {
      throw badRequest("صيغة الملفات غير صحيحة");
    }
    const current = app.files || {};
    const kept = {};
    const dropped = [];
    for (const [key, list] of Object.entries(current)) {
      const keep = new Set(Array.isArray(keepRequest[key]) ? keepRequest[key] : []);
      kept[key] = list.filter((f) => keep.has(f.file));
      dropped.push(...list.filter((f) => !keep.has(f.file)));
    }

    const answers = validateAnswers(app.fields, req.body.answers);
    const files = collectFiles(app.fields, req.files, kept);
    app.answers = answers;
    app.files = files;
    app.status = "reviewing";
    app.timeline = [...(app.timeline || []), entry("reviewing", "user", "تم تحديث الطلب")];
    await app.save();
    removeStored(dropped);
    return res.json({ application: serializeApplication(app, req) });
  })
);

router.post("/visa/applications/:id/cancel", authenticateTokenUser, async (req, res) => {
  const app = await ownApplication(req);
  if (!["submitted", "needs_info"].includes(app.status)) {
    throw new HttpError(409, "لا يمكن إلغاء الطلب بعد بدء المعالجة، تواصل معنا");
  }
  app.status = "cancelled";
  app.timeline = [...(app.timeline || []), entry("cancelled", "user")];
  await app.save();
  return res.json({ application: serializeApplication(app, req) });
});

// ---------------- Stored documents (signed links) ----------------

router.get("/visa-files/:id/:file", async (req, res) => {
  const id = Number(req.params.id);
  const file = String(req.params.file);
  if (!Number.isSafeInteger(id) || !/^[\w.-]+$/.test(file) || !verifySignature(id, file, req.query.exp, req.query.sig)) {
    throw new HttpError(403, "الرابط منتهي أو غير صالح");
  }
  const app = await VisaApplication.findByPk(id, { attributes: ["id", "files", "resultFiles"] });
  const all = [...Object.values(app?.files || {}).flat(), ...(app?.resultFiles || [])];
  const info = all.find((f) => f.file === file);
  if (!info) throw notFound("الملف غير موجود");

  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type(info.mime);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(info.name)}`);
  return res.sendFile(path.join(PRIVATE_DIR, file), (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: "الملف غير موجود" });
  });
});

// ---------------- Admin: visas ----------------

function parseOffer(body, { partial }) {
  const data = {};
  if (!partial || body.country !== undefined) data.country = requireText(body.country, "الدولة", 120);
  if (body.title !== undefined) data.title = cleanText(body.title, 160) || null;
  if (body.description !== undefined) data.description = String(body.description || "").trim().slice(0, 5000) || null;
  if (body.processingTime !== undefined) data.processingTime = cleanText(body.processingTime, 120) || null;
  if (body.validity !== undefined) data.validity = cleanText(body.validity, 160) || null;
  if (body.price !== undefined) data.price = decimal(body.price, "الرسوم", { min: 0, max: 1000000, allowNull: true });
  if (!partial || body.fields !== undefined) data.fields = normalizeFields(body.fields ?? []);
  if (body.isActive !== undefined) data.isActive = toBool(body.isActive);
  if (body.sortOrder !== undefined) data.sortOrder = intInRange(body.sortOrder, "الترتيب", { min: 0, max: 100000, fallback: 0 });
  return data;
}

const removePublic = (p) => {
  if (p && String(p).startsWith("uploads/visa/")) fs.promises.unlink(path.join(__dirname, "..", p)).catch(() => {});
};

router.get("/admin/visas", requireAdmin, async (req, res) => {
  const offers = await VisaOffer.findAll({ order: [["sortOrder", "ASC"], ["id", "DESC"]] });
  const counts = await VisaApplication.findAll({
    attributes: ["visaId", [VisaApplication.sequelize.fn("COUNT", VisaApplication.sequelize.col("id")), "count"]],
    group: ["visaId"],
    raw: true,
  });
  const countBy = new Map(counts.map((c) => [Number(c.visaId), Number(c.count)]));
  return res.json({ visas: offers.map((o) => ({ ...serializeOffer(o, req), applications: countBy.get(o.id) || 0 })) });
});

router.post("/admin/visas", requireAdmin, imageUploader.single("image"), async (req, res) => {
  const image = req.file ? `uploads/visa/${req.file.filename}` : null;
  try {
    const offer = await VisaOffer.create({ ...parseOffer(req.body, { partial: false }), image });
    return res.status(201).json({ visa: serializeOffer(offer, req) });
  } catch (error) {
    removePublic(image);
    throw error;
  }
});

router.put("/admin/visas/:id", requireAdmin, imageUploader.single("image"), async (req, res) => {
  const image = req.file ? `uploads/visa/${req.file.filename}` : null;
  try {
    const offer = await VisaOffer.findByPk(intInRange(req.params.id, "id", { min: 1, max: 2 ** 31 }));
    if (!offer) throw notFound("الفيزا غير موجودة");
    const data = parseOffer(req.body, { partial: true });
    const old = offer.image;
    if (image) data.image = image;
    else if (toBool(req.body.removeImage)) data.image = null;
    await offer.update(data);
    // Applications keep their own copy of the image path, so only drop files nothing points to.
    if (old && old !== offer.image && !(await VisaApplication.count({ where: { visaId: offer.id } }))) removePublic(old);
    return res.json({ visa: serializeOffer(offer, req) });
  } catch (error) {
    removePublic(image);
    throw error;
  }
});

router.delete("/admin/visas/:id", requireAdmin, async (req, res) => {
  const offer = await VisaOffer.findByPk(intInRange(req.params.id, "id", { min: 1, max: 2 ** 31 }));
  if (!offer) throw notFound("الفيزا غير موجودة");
  const used = await VisaApplication.count({ where: { visaId: offer.id } });
  await offer.destroy();
  if (!used) removePublic(offer.image);
  return res.json({ success: true });
});

// ---------------- Admin: applications ----------------

async function statusCounts() {
  const rows = await VisaApplication.findAll({
    attributes: ["status", [VisaApplication.sequelize.fn("COUNT", VisaApplication.sequelize.col("id")), "count"]],
    group: ["status"],
    raw: true,
  });
  return Object.fromEntries(STATUSES.map((s) => [s, Number(rows.find((r) => r.status === s)?.count || 0)]));
}

router.get("/admin/visa-applications/counts", requireAdmin, async (req, res) => {
  return res.json({ counts: await statusCounts() });
});

router.get("/admin/visa-applications", requireAdmin, async (req, res) => {
  const page = intInRange(req.query.page, "page", { min: 1, max: 10000, fallback: 1 });
  const limit = 20;
  const where = {};
  if (STATUSES.includes(req.query.status)) where.status = req.query.status;
  else if (req.query.status === "open") where.status = { [Op.notIn]: [...CLOSED] };
  if (req.query.visaId) where.visaId = intInRange(req.query.visaId, "visaId", { min: 1, max: 2 ** 31 });
  const q = cleanText(req.query.q, 60);
  if (q) {
    const users = await User.findAll({
      where: { [Op.or]: [{ fullName: { [Op.like]: `%${q}%` } }, { phone: { [Op.like]: `%${q}%` } }] },
      attributes: ["id"],
      limit: 200,
    });
    where[Op.or] = [{ reference: { [Op.like]: `%${q.toUpperCase()}%` } }, { userId: { [Op.in]: users.map((u) => u.id) } }];
  }
  const { rows, count } = await VisaApplication.findAndCountAll({
    where,
    include: [{ model: User, as: "user", attributes: ["id", "fullName", "phone", "email"] }],
    order: [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
  });
  return res.json({
    applications: rows.map((a) => {
      const s = serializeApplication(a, req, { admin: true, summary: true });
      return { ...s, user: a.user && { id: a.user.id, fullName: a.user.fullName, phone: a.user.phone } };
    }),
    counts: await statusCounts(),
    pagination: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) },
  });
});

async function adminApplication(req) {
  const app = await VisaApplication.findByPk(intInRange(req.params.id, "id", { min: 1, max: 2 ** 31 }), {
    include: [{ model: User, as: "user", attributes: ["id", "fullName", "phone", "email"] }],
  });
  if (!app) throw notFound("الطلب غير موجود");
  return app;
}

router.get("/admin/visa-applications/:id", requireAdmin, async (req, res) => {
  return res.json({ application: serializeApplication(await adminApplication(req), req, { admin: true }) });
});

// Status and/or the note to the customer (pushed to them), and the internal note.
router.patch("/admin/visa-applications/:id", requireAdmin, async (req, res) => {
  const app = await adminApplication(req);
  const body = req.body || {};
  const status = body.status !== undefined ? body.status : app.status;
  if (!STATUSES.includes(status)) throw badRequest("حالة غير صحيحة");
  const note = body.userNote !== undefined ? String(body.userNote || "").trim().slice(0, 2000) || null : undefined;
  const statusChanged = status !== app.status;
  const noteChanged = note !== undefined && note !== app.userNote;

  if (body.adminNote !== undefined) app.adminNote = String(body.adminNote || "").trim().slice(0, 5000) || null;
  if (note !== undefined) app.userNote = note;
  if (statusChanged || noteChanged) {
    app.status = status;
    app.timeline = [...(app.timeline || []), entry(status, "admin", noteChanged ? note : null)];
  }
  await app.save();

  if ((statusChanged || noteChanged) && body.notify !== false) {
    const title = statusChanged ? STATUS_PUSH[status] || "تحديث على طلب الفيزا" : "تحديث على طلب الفيزا";
    const place = [app.visa?.country, app.visa?.title].filter(Boolean).join(" · ");
    const message = noteChanged && note ? note.slice(0, 180) : `${place} — ${app.reference}`;
    sendNotificationToUser(app.userId, message, title, { type: "visa", applicationId: String(app.id) }).catch((e) =>
      console.error("[visa] push failed:", e.message)
    );
  }
  return res.json({ application: serializeApplication(app, req, { admin: true }) });
});

// The issued visa or other papers for the customer.
router.post("/admin/visa-applications/:id/result", requireAdmin, documentUpload.array("files", 10), (req, res) =>
  cleaningUp(req, async () => {
    const app = await adminApplication(req);
    if (!req.files?.length) throw badRequest("اختر ملفاً");
    app.resultFiles = [...(app.resultFiles || []), ...req.files.map(fileInfo)];
    await app.save();
    if (toBool(req.body.notify)) {
      sendNotificationToUser(app.userId, `${app.reference} — يمكنك تنزيلها من صفحة الطلب`, "وصلت مستندات الفيزا 📄", {
        type: "visa",
        applicationId: String(app.id),
      }).catch((e) => console.error("[visa] push failed:", e.message));
    }
    return res.status(201).json({ application: serializeApplication(app, req, { admin: true }) });
  })
);

router.delete("/admin/visa-applications/:id/result/:file", requireAdmin, async (req, res) => {
  const app = await adminApplication(req);
  const file = String(req.params.file);
  const target = (app.resultFiles || []).find((f) => f.file === file);
  if (!target) throw notFound("الملف غير موجود");
  app.resultFiles = app.resultFiles.filter((f) => f.file !== file);
  await app.save();
  removeStored([target]);
  return res.json({ application: serializeApplication(app, req, { admin: true }) });
});

module.exports = router;

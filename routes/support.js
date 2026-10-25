const express = require("express");
const { Op, fn, col, literal } = require("sequelize");
const { User, UserDevice, SupportMessage } = require("../models");
const { authenticateTokenUser, requireAdmin } = require("../middlewares/auth");
const { imageUpload } = require("../middlewares/uploads");
const { rateLimit } = require("../middlewares/requestRateLimiter");
const { sendNotificationToDevices } = require("../services/notifications");
const { emitSupportMessage, emitSupportRead } = require("../services/supportSocket");
const { HttpError, badRequest, notFound } = require("../services/httpError");
const { cleanText, intInRange } = require("../services/validators");

const router = express.Router();
const upload = imageUpload("support");
const sendLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "رسائل كثيرة بسرعة، انتظر قليلاً" });

const MAX_TEXT = 2000;
const PAGE_SIZE = 30;

function publicBase(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return configured || `${req.protocol}://${req.get("host")}`;
}

// Keeps line breaks (cleanText would fold them), drops runs of empty lines.
function messageText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
}

function serialize(message, req, { admin = false } = {}) {
  const raw = typeof message.toJSON === "function" ? message.toJSON() : message;
  const result = {
    id: raw.id,
    sender: raw.sender,
    type: raw.type,
    text: raw.text,
    image: raw.image ? `${publicBase(req)}/${raw.image}` : null,
    seen: raw.seen,
    createdAt: raw.createdAt,
  };
  if (admin) {
    result.userId = raw.userId;
    result.adminName = raw.admin?.fullName ?? null;
  }
  return result;
}

/** A page of one conversation, oldest first; `before` is the oldest id the client already has. */
async function loadPage(userId, query, req, options) {
  const where = { userId };
  if (query.before) where.id = { [Op.lt]: intInRange(query.before, "before", { min: 1, max: 2 ** 31 }) };
  const rows = await SupportMessage.findAll({
    where,
    include: options.admin ? [{ model: User, as: "admin", attributes: ["fullName"] }] : [],
    order: [["id", "DESC"]],
    limit: PAGE_SIZE,
  });
  return { messages: rows.reverse().map((m) => serialize(m, req, options)), hasMore: rows.length === PAGE_SIZE };
}

/** Marks what `reader` received as seen and tells the other side, when anything changed. */
async function markSeen(userId, reader) {
  const [count] = await SupportMessage.update(
    { seen: true },
    { where: { userId, sender: reader === "user" ? "admin" : "user", seen: false } }
  );
  if (count) emitSupportRead(userId, reader);
}

/** Saves a message from the request (text and/or uploaded image) and pushes it live. */
async function createMessage(req, userId, sender) {
  const text = messageText(req.body?.text);
  const image = req.file ? `uploads/support/${req.file.filename}` : null;
  if (!text && !image) throw badRequest("اكتب رسالة");

  const message = await SupportMessage.create({
    userId,
    sender,
    adminId: sender === "admin" ? req.user.id : null,
    type: image ? "image" : "text",
    text: text || null,
    image,
  });
  if (sender === "admin") await message.reload({ include: [{ model: User, as: "admin", attributes: ["fullName"] }] });

  emitSupportMessage(userId, serialize(message, req), serialize(message, req, { admin: true }));
  return message;
}

// Customers hear about replies even with the app closed. Not saved to their notifications
// list: the chat itself is the record.
function pushReply(userId, message) {
  UserDevice.findAll({ where: { user_id: userId } })
    .then((devices) => {
      const ids = devices.map((d) => d.player_id);
      if (!ids.length) return null;
      const body = message.text ? message.text.slice(0, 140) : "📷 صورة";
      return sendNotificationToDevices(ids, body, "فريق 5 Travel", { type: "support" });
    })
    .catch((error) => console.error("[support] reply push failed:", error.response?.data || error.message));
}

// ---------------- Customer ----------------

router.get("/support/messages", authenticateTokenUser, async (req, res) => {
  const page = await loadPage(req.user.id, req.query, req, { admin: false });
  if (!req.query.before) await markSeen(req.user.id, "user");
  return res.json(page);
});

router.post("/support/messages", authenticateTokenUser, sendLimiter, upload.single("image"), async (req, res) => {
  const message = await createMessage(req, req.user.id, "user");
  return res.status(201).json({ message: serialize(message, req) });
});

router.post("/support/read", authenticateTokenUser, async (req, res) => {
  await markSeen(req.user.id, "user");
  return res.json({ success: true });
});

router.get("/support/unread", authenticateTokenUser, async (req, res) => {
  const count = await SupportMessage.count({ where: { userId: req.user.id, sender: "admin", seen: false } });
  return res.json({ count });
});

// ---------------- Admin ----------------

async function requireCustomer(id) {
  const userId = intInRange(id, "userId", { min: 1, max: 2 ** 31 });
  const user = await User.findByPk(userId, { attributes: ["id", "role"] });
  if (!user) throw notFound("المستخدم غير موجود");
  if (user.role === "admin") throw new HttpError(400, "لا يمكن مراسلة حساب أدمن");
  return userId;
}

// Conversations, newest activity first, with the customer and their unread count.
router.get("/admin/support/conversations", requireAdmin, async (req, res) => {
  const q = cleanText(req.query.q, 60);
  const where = {};
  if (q) {
    const users = await User.findAll({
      where: { [Op.or]: [{ fullName: { [Op.like]: `%${q}%` } }, { phone: { [Op.like]: `%${q}%` } }] },
      attributes: ["id"],
      limit: 200,
    });
    where.userId = { [Op.in]: users.map((u) => u.id) };
  }

  const groups = await SupportMessage.findAll({
    where,
    attributes: [
      "userId",
      [fn("MAX", col("id")), "lastId"],
      [fn("SUM", literal("CASE WHEN sender = 'user' AND seen = 0 THEN 1 ELSE 0 END")), "unread"],
    ],
    group: ["userId"],
    order: [[literal("lastId"), "DESC"]],
    limit: 200,
    raw: true,
  });

  const ids = groups.map((g) => g.userId);
  const [users, lasts] = await Promise.all([
    User.findAll({ where: { id: ids }, attributes: ["id", "fullName", "phone"] }),
    SupportMessage.findAll({
      where: { id: groups.map((g) => g.lastId) },
      include: [{ model: User, as: "admin", attributes: ["fullName"] }],
    }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const lastById = new Map(lasts.map((m) => [m.id, m]));

  const conversations = groups
    .filter((g) => userById.has(g.userId))
    .map((g) => {
      const user = userById.get(g.userId);
      return {
        user: { id: user.id, fullName: user.fullName, phone: user.phone },
        lastMessage: serialize(lastById.get(Number(g.lastId)), req, { admin: true }),
        unread: Number(g.unread) || 0,
      };
    });
  return res.json({ conversations });
});

router.get("/admin/support/unread", requireAdmin, async (req, res) => {
  const count = await SupportMessage.count({ where: { sender: "user", seen: false } });
  return res.json({ count });
});

router.get("/admin/support/conversations/:userId/messages", requireAdmin, async (req, res) => {
  const userId = await requireCustomer(req.params.userId);
  const [page, user] = await Promise.all([
    loadPage(userId, req.query, req, { admin: true }),
    User.findByPk(userId, { attributes: ["id", "fullName", "phone", "email", "createdAt"] }),
  ]);
  if (!req.query.before) await markSeen(userId, "admin");
  return res.json({ user, ...page });
});

router.post(
  "/admin/support/conversations/:userId/messages",
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    const userId = await requireCustomer(req.params.userId);
    const message = await createMessage(req, userId, "admin");
    // Answering means the admin has read what came before.
    await markSeen(userId, "admin");
    pushReply(userId, message);
    return res.status(201).json({ message: serialize(message, req, { admin: true }) });
  }
);

router.post("/admin/support/conversations/:userId/read", requireAdmin, async (req, res) => {
  const userId = await requireCustomer(req.params.userId);
  await markSeen(userId, "admin");
  return res.json({ success: true });
});

module.exports = router;

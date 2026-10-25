const express = require("express");
const { Op } = require("sequelize");
const { User, UserDevice, NotificationLog } = require("../models");
const { authenticateTokenUser, requireAdmin } = require("../middlewares/auth");
const { sendNotificationToAll, sendNotificationToUser } = require("../services/notifications");
const { HttpError, badRequest } = require("../services/httpError");
const { cleanText, requireText, intInRange } = require("../services/validators");

const router = express.Router();

function serializeLog(log) {
  return {
    id: log.id,
    title: log.title,
    message: log.message,
    data: log.data,
    target_type: log.target_type,
    target_value: log.target_value,
    status: log.status,
    createdAt: log.createdAt,
  };
}

// ---------------- Devices (the app calls these) ----------------

// Links this OneSignal subscription to the logged-in user (the user comes from the token, not the body).
router.post("/register-device", authenticateTokenUser, async (req, res) => {
  const playerId = cleanText(req.body?.player_id, 100);
  if (!playerId) throw badRequest("player_id مطلوب");

  const device = await UserDevice.findOne({ where: { player_id: playerId } });
  if (device) {
    if (device.user_id !== req.user.id) {
      device.user_id = req.user.id;
      await device.save();
    } else {
      device.changed("updatedAt", true);
      await device.save();
    }
  } else {
    await UserDevice.create({ user_id: req.user.id, player_id: playerId });
  }
  return res.json({ success: true, message: "تم تسجيل الجهاز بنجاح" });
});

// Called on logout so the device stops receiving this user's notifications.
router.delete("/register-device", authenticateTokenUser, async (req, res) => {
  const playerId = cleanText(req.body?.player_id ?? req.query.player_id, 100);
  if (!playerId) throw badRequest("player_id مطلوب");
  await UserDevice.destroy({ where: { player_id: playerId, user_id: req.user.id } });
  return res.json({ success: true });
});

// The user's notifications: broadcasts + the ones sent to them.
router.get("/notifications", authenticateTokenUser, async (req, res) => {
  const page = intInRange(req.query.page, "page", { min: 1, max: 1000, fallback: 1 });
  const limit = intInRange(req.query.limit, "limit", { min: 1, max: 50, fallback: 20 });
  const { rows, count } = await NotificationLog.findAndCountAll({
    where: {
      status: { [Op.ne]: "failed" },
      [Op.or]: [{ target_type: "all" }, { target_type: "user", user_id: req.user.id }],
    },
    order: [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
  });
  return res.json({
    notifications: rows.map(serializeLog),
    pagination: { page, limit, total: count, hasMore: page * limit < count },
  });
});

// ---------------- Admin ----------------

router.post("/admin/notifications", requireAdmin, async (req, res) => {
  const body = req.body || {};
  const title = requireText(body.title, "العنوان", 120);
  const message = requireText(body.message, "نص الإشعار", 1000);

  if (body.target_type === "all") {
    const result = await sendNotificationToAll(message, title);
    if (!result.success) throw new HttpError(502, "تعذر إرسال الإشعار، تحقق من إعدادات OneSignal");
    return res.json({ success: true });
  }

  if (body.target_type === "user") {
    const userId = intInRange(body.target_value, "رقم المستخدم", { min: 1, max: 2147483647 });
    const user = await User.findByPk(userId);
    if (!user) throw new HttpError(404, "المستخدم غير موجود");
    const result = await sendNotificationToUser(userId, message, title);
    if (!result.success) throw new HttpError(422, result.message || "تعذر إرسال الإشعار");
    return res.json({ success: true, devices: result.devices });
  }

  throw badRequest("target_type يجب أن يكون all أو user");
});

router.get("/admin/notifications", requireAdmin, async (req, res) => {
  const page = intInRange(req.query.page, "page", { min: 1, max: 10000, fallback: 1 });
  const limit = intInRange(req.query.limit, "limit", { min: 1, max: 100, fallback: 25 });
  const { rows, count } = await NotificationLog.findAndCountAll({
    order: [["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
  });
  return res.json({
    logs: rows.map(serializeLog),
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
  });
});

module.exports = router;

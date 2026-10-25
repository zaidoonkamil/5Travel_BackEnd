const axios = require("axios");
const { UserDevice, NotificationLog } = require("../models");

// Same OneSignal integration as wasalni. Supports both key formats:
//   legacy REST key  → Authorization: Basic <key>, onesignal.com/api/v1, include_player_ids
//   new os_v2_ key   → Authorization: Key <key>,   api.onesignal.com,     include_subscription_ids
const MAX_IDS_PER_REQUEST = 2000;

function oneSignalConfig() {
  const appId = String(process.env.ONESIGNAL_APP_ID || "").trim();
  const apiKey = String(process.env.ONESIGNAL_API_KEY || "").trim().replace(/^['"]|['"]$/g, "");
  if (!appId || !apiKey) return null;
  const isV2 = apiKey.startsWith("os_v2_");
  return {
    appId,
    url: isV2 ? "https://api.onesignal.com/notifications" : "https://onesignal.com/api/v1/notifications",
    authorization: isV2 ? `Key ${apiKey}` : `Basic ${apiKey}`,
    idsField: isV2 ? "include_subscription_ids" : "include_player_ids",
  };
}

async function postToOneSignal(target, message, title, data) {
  const config = oneSignalConfig();
  if (!config) {
    console.warn("[onesignal] ONESIGNAL_APP_ID / ONESIGNAL_API_KEY not set, push skipped:", title);
    return { skipped: true };
  }

  const payload = {
    app_id: config.appId,
    headings: { en: title, ar: title },
    contents: { en: message, ar: message },
    ...(data ? { data } : {}),
    ...target(config),
  };
  const res = await axios.post(config.url, payload, {
    headers: { Authorization: config.authorization, "Content-Type": "application/json" },
    timeout: 15000,
  });
  return res.data;
}

async function sendNotificationToDevices(playerIds, message, title = "5 Travel", data) {
  const results = [];
  for (let i = 0; i < playerIds.length; i += MAX_IDS_PER_REQUEST) {
    const chunk = playerIds.slice(i, i + MAX_IDS_PER_REQUEST);
    results.push(await postToOneSignal((c) => ({ [c.idsField]: chunk }), message, title, data));
  }
  return results;
}

async function logNotification(fields) {
  try {
    await NotificationLog.create(fields);
  } catch (error) {
    console.error("[onesignal] could not save notification log:", error.message);
  }
}

// Sends a push to every device of one user and records it in their notifications list.
async function sendNotificationToUser(userId, message, title = "5 Travel", data = null) {
  const devices = await UserDevice.findAll({ where: { user_id: userId } });
  const playerIds = devices.map((d) => d.player_id);
  const log = { user_id: userId, title, message, data, target_type: "user", target_value: String(userId) };

  if (playerIds.length === 0) {
    await logNotification({ ...log, status: "no_devices" });
    return { success: false, message: `لا توجد أجهزة للمستخدم ${userId}` };
  }

  try {
    await sendNotificationToDevices(playerIds, message, title, data);
    await logNotification({ ...log, status: "sent" });
    return { success: true, devices: playerIds.length };
  } catch (error) {
    console.error(`[onesignal] send to user ${userId} failed:`, error.response?.data || error.message);
    await logNotification({ ...log, status: "failed" });
    return { success: false, error: error.message };
  }
}

// Broadcast to every subscribed device of the app.
async function sendNotificationToAll(message, title = "5 Travel", data = null) {
  const log = { user_id: null, title, message, data, target_type: "all", target_value: null };
  try {
    await postToOneSignal(() => ({ included_segments: ["Total Subscriptions"] }), message, title, data);
    await logNotification({ ...log, status: "sent" });
    return { success: true };
  } catch (error) {
    console.error("[onesignal] broadcast failed:", error.response?.data || error.message);
    await logNotification({ ...log, status: "failed" });
    return { success: false, error: error.message };
  }
}

// Booking status changes the customer should hear about.
const BOOKING_MESSAGES = {
  confirmed: { title: "تم تأكيد حجزك ✅", message: (b) => `حجزك ${b.reference} (${b.title}) مؤكد الآن. رحلة سعيدة!` },
  cancelled: { title: "تم إلغاء الحجز", message: (b) => `تم إلغاء حجزك ${b.reference} (${b.title}).` },
  refunded: { title: "تم استرداد الحجز", message: (b) => `تم طلب استرداد حجزك ${b.reference}.` },
};

function notifyBookingStatus(booking) {
  const template = BOOKING_MESSAGES[booking.status];
  if (!template) return Promise.resolve();
  return sendNotificationToUser(booking.userId, template.message(booking), template.title, {
    type: "booking",
    bookingId: String(booking.id),
  }).catch((error) => console.error("[onesignal] booking notification failed:", error.message));
}

module.exports = {
  sendNotificationToDevices,
  sendNotificationToUser,
  sendNotificationToAll,
  notifyBookingStatus,
};

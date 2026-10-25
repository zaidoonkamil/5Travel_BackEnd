const { Server } = require("socket.io");
const { userFromToken, extractTokenFromHeader } = require("../middlewares/auth");

// Live side of the support chat. Messages are sent over HTTP (routes/support.js);
// the socket only pushes them, plus read receipts and "typing…", to whoever is online:
//   room "user:<id>" → that customer's devices, room "admins" → every open admin panel.
let io = null;

function initSupportSocket(server, corsOrigin) {
  io = new Server(server, {
    cors: { origin: corsOrigin, credentials: true },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token || extractTokenFromHeader(socket.handshake.headers?.authorization);
      const user = await userFromToken(token);
      if (!user) return next(new Error("unauthorized"));
      socket.data.user = { id: user.id, role: user.role };
      next();
    } catch (error) {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const { id, role } = socket.data.user;
    socket.join(role === "admin" ? "admins" : `user:${id}`);

    // Customer: { typing }. Admin: { userId, typing }.
    socket.on("support:typing", (payload = {}) => {
      const typing = payload.typing !== false;
      if (role === "admin") {
        const userId = Number(payload.userId);
        if (Number.isSafeInteger(userId) && userId > 0) io.to(`user:${userId}`).emit("support:typing", { typing });
      } else {
        io.to("admins").emit("support:typing", { userId: id, typing });
      }
    });
  });

  return io;
}

/** New message: to the customer (as the app shows it) and to the admins (with the panel's fields). */
function emitSupportMessage(userId, forUser, forAdmin) {
  if (!io) return;
  io.to(`user:${userId}`).emit("support:message", forUser);
  io.to("admins").emit("support:message", { userId, message: forAdmin });
}

/** One side has read the other's messages: `by` is "user" or "admin". */
function emitSupportRead(userId, by) {
  if (!io) return;
  io.to(`user:${userId}`).emit("support:read", { by });
  io.to("admins").emit("support:read", { userId, by });
}

module.exports = { initSupportSocket, emitSupportMessage, emitSupportRead };

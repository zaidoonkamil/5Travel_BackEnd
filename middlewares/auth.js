const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const { User } = require("../models");

dotenv.config();

const LOGIN_AGAIN_MESSAGE = "سجل الخروج ومن ثم سجل الدخول من جديد";

function extractTokenFromHeader(authHeader) {
  const normalized = String(authHeader || "").trim().replace(/^"+|"+$/g, "").trim();
  if (!normalized) return null;

  const segments = normalized
    .split(/\s+/)
    .filter((segment) => segment && segment.toLowerCase() !== "bearer");

  return segments.length > 0 ? segments[segments.length - 1].trim() : null;
}

function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => (err ? reject(err) : resolve(decoded)));
  });
}

async function resolveUser(req, res) {
  const token = extractTokenFromHeader(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: "Token not provided. Unauthorized access." });
    return null;
  }

  let decoded;
  try {
    decoded = await verifyToken(token);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      res.status(401).json({ error: LOGIN_AGAIN_MESSAGE });
    } else {
      res.status(403).json({ error: "Invalid token" });
    }
    return null;
  }

  const user = await User.findByPk(decoded.id);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return null;
  }
  if (user.isActive === false) {
    res.status(403).json({ error: "تم حظر حسابك" });
    return null;
  }
  // A token issued before a password change or role change is no longer valid.
  if ((decoded.tv || 0) !== (user.tokenVersion || 0) || decoded.role !== user.role) {
    res.status(401).json({ error: LOGIN_AGAIN_MESSAGE });
    return null;
  }

  return user;
}

// For connections that carry the token outside an HTTP header (the support chat socket).
// Same checks as resolveUser; returns null instead of answering.
async function userFromToken(token) {
  if (!token) return null;
  let decoded;
  try {
    decoded = await verifyToken(token);
  } catch (_) {
    return null;
  }
  const user = await User.findByPk(decoded.id);
  if (!user || user.isActive === false) return null;
  if ((decoded.tv || 0) !== (user.tokenVersion || 0) || decoded.role !== user.role) return null;
  return user;
}

const authenticateTokenUser = async (req, res, next) => {
  try {
    const user = await resolveUser(req, res);
    if (!user) return;
    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (error) {
    console.error("authenticateTokenUser error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const requireAdmin = async (req, res, next) => {
  try {
    const user = await resolveUser(req, res);
    if (!user) return;
    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admins only" });
    }
    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (error) {
    console.error("requireAdmin error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Attaches req.user when a valid token is present, otherwise continues as a guest.
const optionalUser = async (req, res, next) => {
  const token = extractTokenFromHeader(req.headers.authorization);
  if (!token) return next();
  try {
    const decoded = await verifyToken(token);
    req.user = { id: decoded.id, role: decoded.role };
  } catch (_) {
    // Guests can still browse.
  }
  next();
};

module.exports = {
  authenticateTokenUser,
  requireAdmin,
  optionalUser,
  extractTokenFromHeader,
  userFromToken,
};

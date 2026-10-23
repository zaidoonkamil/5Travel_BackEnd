const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const { User } = require("../models");

// Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when no admin exists yet.
async function bootstrapAdminFromEnv() {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!email || !password) return { skipped: true };

  const existingAdmin = await User.findOne({ where: { role: "admin" } });
  if (existingAdmin) return { skipped: true };

  if (password.length < 8) {
    console.warn("ADMIN_PASSWORD must be at least 8 characters; admin not created.");
    return { skipped: true };
  }

  const hash = await bcrypt.hash(password, 12);
  const existing = await User.findOne({ where: { [Op.or]: [{ email }] } });
  if (existing) {
    await existing.update({ role: "admin", password: hash, tokenVersion: existing.tokenVersion + 1 });
    return { promoted: email };
  }

  await User.create({
    fullName: process.env.ADMIN_NAME || "Admin",
    email,
    password: hash,
    role: "admin",
  });
  return { created: email };
}

module.exports = { bootstrapAdminFromEnv };

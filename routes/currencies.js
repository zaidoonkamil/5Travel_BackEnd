const express = require("express");
const { CurrencyOverride } = require("../models");
const { requireAdmin } = require("../middlewares/auth");
const { currentRates, liveRates } = require("../services/currency");
const { badRequest } = require("../services/httpError");
const { decimal } = require("../services/validators");

const router = express.Router();

// 1 USD in every currency the app can show prices in.
router.get("/currencies", async (req, res) => {
  return res.json(await currentRates());
});

router.get("/admin/currencies", requireAdmin, async (req, res) => {
  const [live, overrides] = await Promise.all([liveRates(), CurrencyOverride.findAll()]);
  return res.json({
    rates: live.rates,
    updatedAt: live.updatedAt,
    overrides: Object.fromEntries(overrides.map((o) => [o.code, Number(o.rate)])),
  });
});

// { rate } fixes the currency's rate by hand; { rate: null } goes back to the daily rate.
router.put("/admin/currencies/:code", requireAdmin, async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || code === "USD") throw badRequest("رمز العملة غير صحيح");
  const raw = req.body?.rate;
  if (raw === null || raw === undefined || raw === "") {
    await CurrencyOverride.destroy({ where: { code } });
    return res.json({ code, rate: null });
  }
  const rate = decimal(raw, "سعر الصرف", { min: 0.000001, max: 100000000 });
  await CurrencyOverride.upsert({ code, rate });
  return res.json({ code, rate });
});

module.exports = router;

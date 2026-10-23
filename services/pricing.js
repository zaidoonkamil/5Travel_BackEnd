const { PricingRule } = require("../models");

const SERVICES = ["flights", "hotels", "activities"];
const CACHE_TTL_MS = 30 * 1000;

let cache = null; // { rules: Map<service, {percent, fixedAmount}>, loadedAt }

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function toMoney(value, currency = "USD") {
  return { amount: round2(value).toFixed(2), currency };
}

async function ensureDefaultRules() {
  for (const service of SERVICES) {
    await PricingRule.findOrCreate({
      where: { service },
      defaults: { service, percent: 0, fixedAmount: 0, isActive: true },
    });
  }
}

async function loadRules() {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rules;

  const rows = await PricingRule.findAll();
  const rules = new Map();
  for (const row of rows) {
    rules.set(row.service, {
      percent: row.isActive ? Number(row.percent) || 0 : 0,
      fixedAmount: row.isActive ? Number(row.fixedAmount) || 0 : 0,
    });
  }
  cache = { rules, loadedAt: Date.now() };
  return rules;
}

function invalidateCache() {
  cache = null;
}

// Returns a pricer bound to the current rules of one service.
//   pricer.total(cost)  → cost + percent + fixed  (use on a whole bookable price)
//   pricer.unit(cost)   → cost + percent only     (use on per-traveller / add-on prices,
//                                                  the fixed fee is added once per booking)
async function getPricer(service) {
  const rules = await loadRules();
  const rule = rules.get(service) || { percent: 0, fixedAmount: 0 };

  const unit = (cost) => round2(Number(cost) * (1 + rule.percent / 100));
  const total = (cost) => round2(unit(cost) + rule.fixedAmount);

  return {
    rule,
    unit,
    total,
    // Applies the markup to a HAPI money object { amount, currency }.
    money(moneyObj, { perUnit = false } = {}) {
      if (!moneyObj || moneyObj.amount === undefined || moneyObj.amount === null) return moneyObj;
      const cost = Number(moneyObj.amount);
      if (!Number.isFinite(cost)) return moneyObj;
      return toMoney(perUnit ? unit(cost) : total(cost), moneyObj.currency || "USD");
    },
    breakdown(cost) {
      const sell = total(cost);
      return {
        costAmount: round2(cost),
        markupAmount: round2(sell - Number(cost)),
        sellAmount: sell,
      };
    },
  };
}

module.exports = {
  SERVICES,
  getPricer,
  ensureDefaultRules,
  invalidateCache,
  round2,
  toMoney,
};

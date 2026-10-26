const axios = require("axios");
const { CurrencyOverride } = require("../models");

// Daily USD rates from ExchangeRate-API's open endpoint (no key; attribution shown in the app).
// Supplier prices are always USD; the app converts them for display only.
const SOURCE_URL = "https://open.er-api.com/v6/latest/USD";
const RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000;

let cache = null; // { rates, updatedAt, nextUpdateAt }
let nextAttemptAt = 0;
let inflight = null;

async function fetchRates() {
  const res = await axios.get(SOURCE_URL, { timeout: 10000 });
  const data = res.data || {};
  if (data.result !== "success" || !data.rates || typeof data.rates !== "object") {
    throw new Error(`rates provider answered ${data.result || "nothing"}${data["error-type"] ? `: ${data["error-type"]}` : ""}`);
  }
  return {
    rates: data.rates,
    updatedAt: new Date((data.time_last_update_unix || Date.now() / 1000) * 1000).toISOString(),
    // The provider publishes once a day; ask again shortly after its next update.
    nextUpdateAt: ((data.time_next_update_unix || Date.now() / 1000 + 86400) + 300) * 1000,
  };
}

/** Provider rates, refreshed when the provider has published new ones; the last good copy on failure. */
async function liveRates() {
  const stale = !cache || Date.now() >= cache.nextUpdateAt;
  if (stale && Date.now() >= nextAttemptAt) {
    inflight ||= fetchRates()
      .then((fresh) => {
        cache = fresh;
      })
      .catch((error) => {
        nextAttemptAt = Date.now() + RETRY_AFTER_FAILURE_MS;
        console.error("[currency] rates refresh failed:", error.message);
      })
      .finally(() => {
        inflight = null;
      });
    await inflight;
  }
  return cache || { rates: { USD: 1 }, updatedAt: null, nextUpdateAt: 0 };
}

/** What the app uses: provider rates with the admin's overrides on top. */
async function currentRates() {
  const [live, overrides] = await Promise.all([liveRates(), CurrencyOverride.findAll()]);
  const rates = { ...live.rates, USD: 1 };
  for (const o of overrides) rates[o.code] = Number(o.rate);
  return {
    base: "USD",
    rates,
    overridden: overrides.map((o) => o.code),
    updatedAt: live.updatedAt,
  };
}

module.exports = { currentRates, liveRates };

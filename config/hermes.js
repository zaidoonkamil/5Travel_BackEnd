// ================================================================
//  Hermeseus HAPI v3 — flights, hotels and activities supplier.
//  Docs: https://api.hermeseus.com/docs
//
//  Credentials go in `.env`:
//    HERMES_CLIENT_ID=cid_test_...   (or cid_live_...)
//    HERMES_CLIENT_SECRET=sk_test_... (or sk_live_...)
//  The environment (sandbox / live) is decided by the credential,
//  not by the host. Never ship the secret inside the app.
// ================================================================

const HERMES = Object.freeze({
  BASE_URL: (process.env.HERMES_BASE_URL || "https://api.hermeseus.com/v3/HAPI").replace(/\/+$/, ""),
  CLIENT_ID: process.env.HERMES_CLIENT_ID || "",
  CLIENT_SECRET: process.env.HERMES_CLIENT_SECRET || "",
  REQUEST_TIMEOUT_MS: 60000,
  // Refresh the access token this long before it actually expires.
  TOKEN_REFRESH_MARGIN_MS: 2 * 60 * 1000,
  CURRENCY: "USD",
});

module.exports = HERMES;

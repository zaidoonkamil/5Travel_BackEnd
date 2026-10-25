const axios = require("axios");
const crypto = require("crypto");
const HERMES = require("../config/hermes");

// Supplier error, keeps the HAPI error code so routes can react to it.
class HermesError extends Error {
  constructor({ status, type, code, message, param, requestId }) {
    super(message || "Supplier request failed");
    this.name = "HermesError";
    this.status = status;
    this.type = type;
    this.code = code;
    this.param = param;
    this.requestId = requestId;
  }
}

const http = axios.create({
  baseURL: HERMES.BASE_URL,
  timeout: HERMES.REQUEST_TIMEOUT_MS,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  validateStatus: () => true,
});

let cachedToken = null; // { value, expiresAt }
let pendingTokenRequest = null;

async function requestNewToken() {
  if (!HERMES.CLIENT_ID || !HERMES.CLIENT_SECRET) {
    throw new HermesError({
      status: 500,
      code: "hermes_not_configured",
      message: "HERMES_CLIENT_ID / HERMES_CLIENT_SECRET are not set",
    });
  }

  const res = await http.post("/auth/tokens", {
    grant_type: "client_credentials",
    client_id: HERMES.CLIENT_ID,
    client_secret: HERMES.CLIENT_SECRET,
  });

  // The token endpoint answers 201 Created (not 200), so accept any 2xx.
  if (res.status < 200 || res.status >= 300 || !res.data?.access_token) {
    throw toHermesError(res);
  }

  const expiresInMs = Number(res.data.expires_in || 3600) * 1000;
  cachedToken = {
    value: res.data.access_token,
    expiresAt: Date.now() + expiresInMs - HERMES.TOKEN_REFRESH_MARGIN_MS,
  };
  return cachedToken.value;
}

// One token is shared by every request; concurrent callers wait on the same refresh.
async function getAccessToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  if (!pendingTokenRequest) {
    pendingTokenRequest = requestNewToken().finally(() => {
      pendingTokenRequest = null;
    });
  }
  return pendingTokenRequest;
}

function toHermesError(res) {
  const err = res.data?.error || {};
  return new HermesError({
    status: res.status,
    type: err.type,
    code: err.code,
    message: err.message,
    param: err.param,
    requestId: err.request_id || res.headers?.["request-id"],
  });
}

const TOKEN_ERROR_CODES = new Set(["expired_token", "invalid_token", "missing_authorization"]);

async function request(method, path, { params, data, idempotencyKey, responseType } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getAccessToken({ forceRefresh: attempt > 0 });
    const headers = { Authorization: `Bearer ${token}` };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    let res;
    try {
      res = await http.request({ method, url: path, params, data, headers, responseType });
    } catch (error) {
      throw new HermesError({
        status: 504,
        code: error.code === "ECONNABORTED" ? "supplier_timeout" : "supplier_unreachable",
        message: error.message,
      });
    }

    if (res.status >= 200 && res.status < 300) {
      return res.data;
    }

    // Token rejected: drop the cache and retry once with a fresh one.
    if (res.status === 401 && attempt === 0 && TOKEN_ERROR_CODES.has(res.data?.error?.code)) {
      cachedToken = null;
      continue;
    }

    if (responseType === "arraybuffer" && res.data) {
      try {
        res.data = JSON.parse(Buffer.from(res.data).toString("utf8"));
      } catch (_) {
        // Not JSON, keep the raw status only.
      }
    }
    throw toHermesError(res);
  }
  throw new HermesError({ status: 502, code: "supplier_auth_failed", message: "Supplier authentication failed" });
}

// Opens a server-sent events stream and returns the raw body stream.
// Errors before the stream starts (auth, validation) are thrown like `request`.
async function openStream(path, data, signal) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getAccessToken({ forceRefresh: attempt > 0 });
    let res;
    try {
      res = await http.request({
        method: "POST",
        url: path,
        data,
        signal,
        responseType: "stream",
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      });
    } catch (error) {
      throw new HermesError({
        status: 504,
        code: error.code === "ECONNABORTED" ? "supplier_timeout" : "supplier_unreachable",
        message: error.message,
      });
    }

    if (res.status >= 200 && res.status < 300) return res.data;

    // Error answers are plain JSON: read them fully before deciding.
    let raw = "";
    for await (const chunk of res.data) raw += chunk;
    try {
      res.data = JSON.parse(raw);
    } catch (_) {
      res.data = {};
    }
    if (res.status === 401 && attempt === 0 && TOKEN_ERROR_CODES.has(res.data?.error?.code)) {
      cachedToken = null;
      continue;
    }
    throw toHermesError(res);
  }
  throw new HermesError({ status: 502, code: "supplier_auth_failed", message: "Supplier authentication failed" });
}

// Yields { event, data } for each server-sent event of a stream.
async function* readEvents(stream) {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk.toString("utf8").replace(/\r\n/g, "\n");
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const lines = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /, ""));
      }
      if (lines.length === 0) continue;
      let parsed;
      try {
        parsed = JSON.parse(lines.join("\n"));
      } catch (_) {
        continue;
      }
      yield { event, data: parsed };
    }
  }
}

const newIdempotencyKey = () => crypto.randomUUID();

const hermes = {
  // Flights
  flightPlaces: (params) => request("GET", "/flights/places", { params }),
  searchFlights: (body) => request("POST", "/flights/searches", { data: body }),
  // Offers arrive as each source answers: the first batch usually within ~1s.
  streamFlightSearch: (body, signal) => openStream("/flights/searches/stream", body, signal),
  getFlightOffer: (id) => request("GET", `/flights/offers/${encodeURIComponent(id)}`),
  getFlightConditions: (id) => request("GET", `/flights/offers/${encodeURIComponent(id)}/conditions`),
  createFlightOrder: (body, idempotencyKey) =>
    request("POST", "/flights/orders", { data: body, idempotencyKey }),
  getFlightOrder: (id) => request("GET", `/flights/orders/${encodeURIComponent(id)}`),
  issueFlightTicket: (id, idempotencyKey) =>
    request("POST", `/flights/orders/${encodeURIComponent(id)}/ticket`, { idempotencyKey }),
  cancelFlightOrder: (id, idempotencyKey) =>
    request("POST", `/flights/orders/${encodeURIComponent(id)}/cancellation`, { idempotencyKey }),
  getFlightRefundQuote: (id) => request("GET", `/flights/orders/${encodeURIComponent(id)}/refund`),
  refundFlightOrder: (id, body, idempotencyKey) =>
    request("POST", `/flights/orders/${encodeURIComponent(id)}/refund`, { data: body || {}, idempotencyKey }),

  // Hotels
  hotelPlaces: (params) => request("GET", "/hotels/places", { params }),
  searchHotels: (body) => request("POST", "/hotels/searches", { data: body }),
  getHotelRate: (id) => request("GET", `/hotels/rates/${encodeURIComponent(id)}`),
  createHotelOrder: (body, idempotencyKey) =>
    request("POST", "/hotels/orders", { data: body, idempotencyKey }),
  getHotelOrder: (id) => request("GET", `/hotels/orders/${encodeURIComponent(id)}`),
  confirmHotelOrder: (id, idempotencyKey) =>
    request("POST", `/hotels/orders/${encodeURIComponent(id)}/confirm`, { idempotencyKey }),
  getHotelCancellationQuote: (id) => request("GET", `/hotels/orders/${encodeURIComponent(id)}/cancellation`),
  cancelHotelOrder: (id, idempotencyKey) =>
    request("POST", `/hotels/orders/${encodeURIComponent(id)}/cancellation`, { idempotencyKey }),

  // Activities
  listActivities: (params) => request("GET", "/activities/products", { params }),
  getActivity: (id, params) => request("GET", `/activities/products/${encodeURIComponent(id)}`, { params }),
  getActivityAvailability: (productTypeId, params) =>
    request("GET", `/activities/product-types/${encodeURIComponent(productTypeId)}/availability`, { params }),
  createActivityBooking: (body, idempotencyKey) =>
    request("POST", "/activities/bookings", { data: body, idempotencyKey }),
  getActivityBooking: (id) => request("GET", `/activities/bookings/${encodeURIComponent(id)}`),
  confirmActivityBooking: (id, idempotencyKey) =>
    request("POST", `/activities/bookings/${encodeURIComponent(id)}/confirm`, { idempotencyKey }),
  cancelActivityBooking: (id, idempotencyKey) =>
    request("POST", `/activities/bookings/${encodeURIComponent(id)}/cancel`, { idempotencyKey }),
  listActivityVouchers: (id) => request("GET", `/activities/bookings/${encodeURIComponent(id)}/vouchers`),
  downloadActivityVoucher: (id, voucherId) =>
    request(
      "GET",
      `/activities/bookings/${encodeURIComponent(id)}/vouchers/${encodeURIComponent(voucherId)}/download`,
      { responseType: "arraybuffer" }
    ),

  // Wallet
  getWallet: () => request("GET", "/wallet"),
};

module.exports = { hermes, HermesError, newIdempotencyKey, readEvents };

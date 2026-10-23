// Minimal in-memory fixed-window limiter, keyed by IP + route bucket.
const buckets = new Map();

function rateLimit({ windowMs, max, message = "طلبات كثيرة، حاول بعد قليل" }) {
  return (req, res, next) => {
    const key = `${req.baseUrl}${req.path}|${req.ip}`;
    const now = Date.now();
    const entry = buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, 60 * 1000).unref();

module.exports = { rateLimit };

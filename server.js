require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const sequelize = require("./config/db");
require("./models");
const usersRouter = require("./routes/user");
const homeRouter = require("./routes/home");
const flightsRouter = require("./routes/flights");
const hotelsRouter = require("./routes/hotels");
const activitiesRouter = require("./routes/activities");
const bookingsRouter = require("./routes/bookings");
const adminCustomRouter = require("./routes/adminCustom");
const notificationsRouter = require("./routes/notifications");
const adsRouter = require("./routes/ads");
const adminRouter = require("./routes/admin");
const supportRouter = require("./routes/support");
const visasRouter = require("./routes/visas");
const currenciesRouter = require("./routes/currencies");
const partnerRouter = require("./routes/partner");
const walletRouter = require("./routes/wallet");
const adminPartnersRouter = require("./routes/adminPartners");
const { initSupportSocket } = require("./services/supportSocket");
const { ensureDefaultRules } = require("./services/pricing");
const { bootstrapAdminFromEnv } = require("./services/bootstrapAdmin");
const { errorHandler } = require("./services/errorHandler");
const { ensureSchema } = require("./services/ensureSchema");
const { hermes } = require("./services/hermesClient");
const { isOtpiqConfigured, getOtpiqProjectInfo } = require("./services/otpiqService");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error("JWT_SECRET must be set and at least 32 characters long.");
    process.exit(1);
}

const isProduction = process.env.NODE_ENV === "production";

function normalizeOrigin(origin) {
    return String(origin || "").trim().replace(/\/+$/, "");
}

const allowedOrigins = new Set(
    (process.env.CORS_ORIGINS || "")
        .split(",")
        .map(normalizeOrigin)
        .filter(Boolean)
);

function isOriginAllowed(origin) {
    // Mobile apps send no Origin header.
    if (!origin) return true;
    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.has(normalized)) return true;
    if (isProduction) return false;
    try {
        const { hostname } = new URL(normalized);
        return hostname === "localhost" || hostname === "127.0.0.1";
    } catch (_) {
        return false;
    }
}

const corsOptions = {
    origin(origin, callback) {
        if (isOriginAllowed(origin)) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"],
    credentials: true,
};

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
initSupportSocket(server, corsOptions.origin);

app.use(cors(corsOptions));
// The raw bytes are kept for webhook signature checks (SwiftPay signs the body exactly as sent).
app.use(express.json({ limit: "1mb", verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); } }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
    setHeaders: (res) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "public, max-age=86400");
    },
}));

// Health check: /health (server + database), /health?full=1 also checks Hermeseus and OTPIQ.
app.get("/health", async (req, res) => {
    const checks = {};
    const timed = async (name, fn) => {
        const started = Date.now();
        try {
            const detail = await fn();
            checks[name] = { ok: true, ms: Date.now() - started, ...(detail || {}) };
        } catch (error) {
            checks[name] = { ok: false, ms: Date.now() - started, error: error.code || error.message };
        }
    };

    await timed("database", () => sequelize.authenticate());
    if (req.query.full === "1") {
        await timed("hermes", async () => {
            const wallet = await hermes.getWallet();
            return { environment: wallet.environment };
        });
        await timed("otpiq", async () => {
            if (!isOtpiqConfigured()) return { configured: false };
            await getOtpiqProjectInfo();
            return { configured: true };
        });
    }

    const ok = Object.values(checks).every((c) => c.ok || c.configured === false);
    return res.status(ok ? 200 : 503).json({
        ok,
        uptimeSeconds: Math.round(process.uptime()),
        time: new Date().toISOString(),
        checks,
    });
});

// Order matters: usersRouter serves /admin/login before the admin guard runs.
app.use("/", usersRouter);
app.use("/", homeRouter);
app.use("/", flightsRouter);
app.use("/", hotelsRouter);
app.use("/", activitiesRouter);
app.use("/", bookingsRouter);
app.use("/", notificationsRouter);
app.use("/", adsRouter);
app.use("/", supportRouter);
app.use("/", visasRouter);
app.use("/", currenciesRouter);
app.use("/", partnerRouter);
app.use("/", walletRouter);
app.use("/", adminPartnersRouter);
app.use("/", adminCustomRouter);
app.use("/", adminRouter);

app.use((req, res) => res.status(404).json({ error: "المسار غير موجود" }));
app.use(errorHandler);

const PORT = process.env.PORT || 1500;
const HOST = process.env.HOST || "0.0.0.0";

async function bootstrap() {
    try {
        await sequelize.authenticate();
        console.log("✅ Connected to MySQL successfully!");
        if (process.env.DB_SYNC_ALTER === "true") {
            await sequelize.sync({ alter: true });
        } else {
            await ensureSchema();
        }
        await ensureDefaultRules();
        const adminResult = await bootstrapAdminFromEnv();
        if (!adminResult?.skipped) console.log("Bootstrap admin ensured:", adminResult);

        server.listen(PORT, HOST, () => {
            console.log(`Server running on http://${HOST}:${PORT}`);
        });
    } catch (err) {
        console.error("Error bootstrapping server:", err);
        process.exit(1);
    }
}

bootstrap();

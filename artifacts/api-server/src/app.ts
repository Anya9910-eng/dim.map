import path from "node:path";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import router from "./routes";
import { logger } from "./lib/logger";
import { handleStripeEvent } from "./routes/billing";

const PgStore = connectPgSimple(session);
const app: Express = express();

// Trust Replit's reverse proxy so req.secure = true and secure cookies are set correctly
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

/**
 * CORS.
 *
 * `origin: true` reflects whatever Origin the caller sends and, paired with
 * `credentials: true`, tells the browser that any site may make authenticated
 * requests here. SameSite=Lax on the session cookie is what has actually been
 * preventing that — the cookie is not attached to cross-site XHR — so the
 * misconfiguration has been load-bearing on a single unrelated setting. Change
 * SameSite to None one day and it becomes account takeover.
 *
 * The dashboard is served from the same origin as the API, so it needs no CORS
 * grant at all. Only APP_BASE_URL is allowed, plus localhost for development.
 */
const allowedOrigins = [
  process.env["APP_BASE_URL"]?.trim().replace(/\/+$/, ""),
  ...(process.env["NODE_ENV"] === "production"
    ? []
    : ["http://localhost:5173", "http://localhost:3000", "http://localhost:18150"]),
].filter(Boolean) as string[];

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // No Origin header: same-origin navigations, curl, server-to-server.
      // These are not cross-site requests and CORS has no say over them.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Refuse by omitting the header rather than erroring, so the browser
      // blocks the response and the server does not log a stack trace per hit.
      return callback(null, false);
    },
  }),
);

/**
 * Baseline response headers.
 *
 * nginx terminates TLS but adds none of these, so the app is the only place
 * they can come from. Deliberately not a CSP: the dashboard is a Vite bundle
 * whose exact script/style shape would need pinning first, and a wrong CSP
 * breaks the page rather than failing quietly.
 */
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// Express advertises itself by default; there is no reason to tell a scanner
// which framework and therefore which CVEs to try.
app.disable("x-powered-by");

const sessionSecret = process.env["SESSION_SECRET"];
if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required");
}

app.use(
  session({
    store: new PgStore({
      conString: process.env["DATABASE_URL"],
      createTableIfMissing: true,
      tableName: "user_sessions",
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env["NODE_ENV"] === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  }),
);

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;
    try {
      await handleStripeEvent(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: any) {
      logger.error({ err }, "Stripe webhook error");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

/**
 * Body size ceiling.
 *
 * express.json defaults to 100kb, which silently cost a client four replies:
 * a Lemlist webhook carries the whole email thread, so a reply deep in a
 * quoted chain exceeded it while a short one on the same campaign sailed
 * through. Lemlist retried each six times, got 413 every time, and gave up —
 * and because the rejection happens inside the body parser, before any route
 * runs, nothing was written to the logs table either. The failure was
 * invisible from inside the product.
 *
 * 5mb comfortably fits a long thread with inline images, and sits well under
 * the 20m nginx already allows, so nginx stays the outer bound.
 */
const BODY_LIMIT = "5mb";

const captureRawBody = (_req: Request, _res: Response, buf: Buffer) => {
  (_req as unknown as { rawBody: string }).rawBody = buf.toString("utf8");
};

app.use(express.json({ limit: BODY_LIMIT, verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT, verify: captureRawBody }));

/**
 * A body that is still too large must not fail silently a second time.
 *
 * This is the only place that can see it: the parser throws before routing, so
 * no handler and no per-request logger exists yet. Logging the path and the
 * declared size here is what turns "some replies just never arrived" into
 * something greppable.
 */
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (err && typeof err === "object" && (err as { type?: string }).type === "entity.too.large") {
    logger.error(
      {
        path: req.path,
        contentLength: req.get("content-length"),
        limit: BODY_LIMIT,
      },
      "Rejected an oversized request body — the sender will see 413 and may not retry",
    );
    res.status(413).json({ error: "Request body too large" });
    return;
  }
  next(err);
});

/**
 * Per-IP rate limits.
 *
 * Login codes already throttle per address (5 sends per 15 minutes, 5 wrong
 * guesses per code), but nothing limited a single caller across addresses, so
 * one machine could enumerate accounts or hammer verification at full speed.
 * Real client IPs arrive via X-Forwarded-For from nginx; "trust proxy" above
 * is what makes req.ip honour it, and without that every visitor would share
 * nginx's address and rate-limit each other.
 *
 * Limits are deliberately loose for the app itself: a dashboard polling a few
 * lists never approaches them. They exist to make abuse expensive, not to
 * shape normal traffic.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts from this address. Try again in 15 minutes." },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  // Webhooks are authenticated by their own secret and arrive in bursts
  // from a handful of vendor IPs; a limit tuned for humans would drop them.
  skip: (req) => req.path.startsWith("/webhooks/") || req.path === "/healthz",
  message: { error: "Too many requests. Slow down." },
});

// The landing-page lead form is the one anonymous write on the API. Ten per
// address per hour is far above what a person does and far below what makes
// filling the table worthwhile.
const earlyAccessLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests from this address. Try again later, or email outreach@dim.capital." },
});

app.use("/api/auth", authLimiter);
app.use("/api/early-access", earlyAccessLimiter);
app.use("/api", apiLimiter);

app.use("/api", router);

// Single-server (VPS/Docker) deployments: on Replit each artifact is served by
// the platform router, but on a VPS the API server also serves the built
// frontends. Set STATIC_APP_DIR / STATIC_LANDING_DIR to the vite build output
// dirs to enable; unset (the Replit case) this block is a no-op.
const staticAppDir = process.env["STATIC_APP_DIR"];
const staticLandingDir = process.env["STATIC_LANDING_DIR"];

if (staticAppDir) {
  const appIndex = path.resolve(staticAppDir, "index.html");
  app.use("/app", express.static(path.resolve(staticAppDir)));
  // SPA fallback for client-side routes like /app/drafts
  app.use("/app", (_req, res) => {
    res.sendFile(appIndex);
  });
}

if (staticLandingDir) {
  const landingIndex = path.resolve(staticLandingDir, "index.html");
  app.use(express.static(path.resolve(staticLandingDir)));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(landingIndex);
  });
}

export default app;

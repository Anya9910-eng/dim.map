import { Router } from "express";
import { createHmac } from "crypto";
import { logger } from "../lib/logger";
import { resolveIdentity, type Role } from "../lib/identity";
import { issueLoginCode, verifyLoginCode, normalizeEmail } from "../lib/loginCodes";
import { sendLoginCodeEmail, sendWelcomeEmail } from "../lib/email";
import { createSelfServeAccount } from "../lib/signup";

declare module "express-session" {
  interface SessionData {
    user?: {
      /** The signed-in address, lowercased. It is the stable identifier now
       * that sign-in no longer goes through Slack. */
      id: string;
      name: string;
      email: string;
      /** Decided from the verified email at login — never from the request. */
      role: Role;
      /** The client this person may see. null for an operator, who sees all. */
      clientId: number | null;
    };
  }
}

const router = Router();

/** "anna.smith@corp.com" -> "Anna Smith". Only for display; nothing depends on it. */
function displayNameFor(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length > 0 ? words.join(" ") : email;
}

function isPlausibleEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Step 1 — ask for a code.
 *
 * Always answers `{ ok: true }`, whatever happened. A response that differed
 * for an unknown address would let anyone test which emails have DIM map
 * accounts, and the client list is exactly the thing worth not leaking. So a
 * stranger's address, a throttled address and a genuine one are indistinguishable
 * from outside; the difference is only whether an email actually goes out.
 */
router.post("/auth/request-code", async (req, res) => {
  const { email } = req.body as { email?: unknown };

  if (!isPlausibleEmail(email)) {
    res.status(400).json({ error: "Enter a valid email address" });
    return;
  }

  const normalized = normalizeEmail(email);

  try {
    const identity = await resolveIdentity(normalized);
    if (!identity) {
      logger.info({ email: normalized }, "Sign-in code requested for an address with no access");
      res.json({ ok: true });
      return;
    }

    const issued = await issueLoginCode(normalized);
    if (!issued.ok) {
      logger.warn({ email: normalized }, "Sign-in code request throttled");
      res.json({ ok: true });
      return;
    }

    await sendLoginCodeEmail(normalized, issued.code);
    logger.info({ email: normalized }, "Sign-in code issued");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to issue sign-in code");
    res.status(500).json({ error: "Could not send a code right now. Please try again." });
  }
});

/**
 * Self-serve signup — a tenant, a user, and then the same code flow as sign-in.
 *
 * Answers `{ ok: true }` for an address that already has access, exactly as
 * it does for a new one, and sends that person an ordinary sign-in code. The
 * "already registered" distinction stays server-side for the same reason
 * request-code hides it: the customer list is not for enumerating.
 */
router.post("/auth/signup", async (req, res) => {
  const { email, name, company } = req.body as { email?: unknown; name?: unknown; company?: unknown };

  if (!isPlausibleEmail(email) || email.length > 254) {
    res.status(400).json({ error: "Enter a valid email address" });
    return;
  }
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 120) {
    res.status(400).json({ error: "Enter your name" });
    return;
  }
  if (typeof company !== "string" || company.trim().length === 0 || company.length > 120) {
    res.status(400).json({ error: "Enter your company or team name" });
    return;
  }

  const normalized = normalizeEmail(email);

  try {
    const result = await createSelfServeAccount({ email: normalized, name, company });
    if (result.kind === "existing") {
      logger.info({ email: normalized }, "Signup for an address that already has access — sending a sign-in code");
    } else {
      // Best-effort welcome for a genuinely new account. Never block signup on
      // it: sendWelcomeEmail cannot throw, and a missed welcome is harmless.
      const welcome = await sendWelcomeEmail(normalized, name.trim());
      if (!welcome.delivered) {
        logger.warn({ email: normalized, reason: welcome.reason }, "Welcome email not delivered");
      }
    }

    const issued = await issueLoginCode(normalized);
    if (!issued.ok) {
      logger.warn({ email: normalized }, "Signup code request throttled");
      res.json({ ok: true });
      return;
    }
    await sendLoginCodeEmail(normalized, issued.code);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, email: normalized }, "Signup failed");
    res.status(500).json({ error: "Could not create your account. Please try again." });
  }
});

/**
 * Step 2 — exchange the code for a session.
 *
 * The role is resolved here a second time rather than carried over from step 1:
 * access can be revoked in the ten minutes a code is valid for, and the session
 * should reflect the state at the moment it is minted.
 */
router.post("/auth/verify-code", async (req, res) => {
  const { email, code } = req.body as { email?: unknown; code?: unknown };

  if (!isPlausibleEmail(email) || typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
    res.status(400).json({ error: "Enter the 6-digit code from your email" });
    return;
  }

  const normalized = normalizeEmail(email);

  try {
    const result = await verifyLoginCode(normalized, code);
    if (!result.ok) {
      logger.warn({ email: normalized, reason: result.reason }, "Sign-in code rejected");
      const message =
        result.reason === "expired"
          ? "That code has expired. Request a new one."
          : result.reason === "too_many_attempts"
            ? "Too many incorrect attempts. Request a new code."
            : "That code is not correct.";
      res.status(401).json({ error: message });
      return;
    }

    const identity = await resolveIdentity(normalized);
    if (!identity) {
      logger.warn({ email: normalized }, "Valid code but the address no longer has access");
      res.status(403).json({ error: "This address does not have access to DIM map." });
      return;
    }

    // A fresh session id at the moment privileges are granted: without this, a
    // session id planted in the browser beforehand would survive into the
    // signed-in session.
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        logger.error({ err: regenErr }, "Failed to regenerate session on sign-in");
        res.status(500).json({ error: "Could not complete sign-in. Please try again." });
        return;
      }

      req.session.user = {
        id: normalized,
        name: displayNameFor(normalized),
        email: normalized,
        role: identity.role,
        clientId: identity.clientId,
      };

      // express-session persists at response end, so without an explicit save
      // the browser can call /auth/me before the row exists and bounce to /login.
      req.session.save((saveErr) => {
        if (saveErr) {
          logger.error({ err: saveErr }, "Failed to save session after sign-in");
          res.status(500).json({ error: "Could not complete sign-in. Please try again." });
          return;
        }
        logger.info({ email: normalized, role: identity.role }, "User signed in by email code");
        res.json({ ok: true });
      });
    });
  } catch (err) {
    logger.error({ err }, "Sign-in verification error");
    res.status(500).json({ error: "Could not complete sign-in. Please try again." });
  }
});

router.get("/auth/me", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(req.session.user);
});

function devLoginEnabled(): boolean {
  return (
    process.env["NODE_ENV"] !== "production" &&
    process.env["ENABLE_DEV_LOGIN"] === "true"
  );
}

function safeRedirect(next: unknown): string {
  if (typeof next !== "string") return "/app";
  const trimmed = next.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/app";
  return trimmed;
}

router.post("/auth/dev-login", (req, res) => {
  if (!devLoginEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  req.session.user = {
    id: "test@draftfly.dev",
    name: "Test Operator",
    email: "test@draftfly.dev",
    role: "operator",
    clientId: null,
  };
  res.json({ ok: true });
});

router.get("/auth/dev-login", (req, res) => {
  if (!devLoginEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  req.session.user = {
    id: "test@draftfly.dev",
    name: "Test Operator",
    email: "test@draftfly.dev",
    role: "operator",
    clientId: null,
  };
  const redirect = safeRedirect(req.query["next"]);
  req.session.save(() => res.redirect(redirect));
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) logger.warn({ err }, "Session destroy error");
    res.json({ ok: true });
  });
});

router.post("/auth/telegram", (req, res) => {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"];
  const allowedIds = process.env["ALLOWED_TELEGRAM_USER_IDS"] ?? "";

  if (!botToken) {
    res.status(503).json({ error: "Telegram bot token not configured" });
    return;
  }

  const { initData } = req.body as { initData?: string };

  if (!initData) {
    res.status(400).json({ error: "Missing initData" });
    return;
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) {
      res.status(401).json({ error: "Missing hash" });
      return;
    }

    params.delete("hash");
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (computedHash !== hash) {
      logger.warn("Telegram initData hash mismatch");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const userStr = params.get("user");
    const user = userStr ? (JSON.parse(userStr) as { id?: number }) : null;
    const userId = user?.id?.toString() ?? "";

    const allowed = allowedIds.split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(userId)) {
      logger.warn({ userId }, "Telegram user not in allowlist");
      res.status(403).json({ error: "Access denied" });
      return;
    }

    logger.info({ userId }, "Telegram user verified");
    res.json({ ok: true, userId });
  } catch (err) {
    logger.error({ err }, "Telegram auth error");
    res.status(500).json({ error: "Verification failed" });
  }
});

export default router;

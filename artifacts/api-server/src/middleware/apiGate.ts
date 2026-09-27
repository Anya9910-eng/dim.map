import type { Request, Response, NextFunction } from "express";
import { requireAuth } from "./scope";

/**
 * Default-deny gate for the /api router.
 *
 * Mounted ahead of every data router, so a new route is protected the moment it
 * is added — the previous per-route approach meant anything without an explicit
 * `requireOperator` argument shipped publicly readable and writable.
 *
 * The exceptions below are not unauthenticated: each one carries its own
 * credential check, which an operator session cannot stand in for.
 *   /healthz             liveness probe, exposes no data
 *   /auth/*              the login flow itself; /auth/me answers 401 on its own
 *   /early-access        landing-page lead form; anonymous by design, rate-limited in app.ts
 *   /slack/actions       Slack request signature (verifyIncomingRequest)
 *   /webhooks/lemlist    global shared secret (requireWebhookSecret)
 *   /webhooks/lemlist/:id  that client's own secret (requireClientWebhookSecret);
 *                        digits only, so /webhooks/lemlist/simulate stays gated
 *   /webhooks/meta/:id, /webhooks/whatsapp/:id  same per-client secret
 *   /v1/epicgram/*       API key (requireEpicgramApiKey)
 *
 * POST /api/stripe/webhook verifies its own Stripe signature and is mounted on
 * the app directly, ahead of this router, so it never reaches this gate.
 */
const PUBLIC_PATTERNS: readonly RegExp[] = [
  /^\/healthz$/,
  /^\/auth(?:\/|$)/,
  /^\/early-access$/,
  /^\/slack\/actions$/,
  /^\/webhooks\/lemlist$/,
  /^\/webhooks\/lemlist\/reply$/,
  /^\/webhooks\/lemlist\/\d+$/,
  /^\/webhooks\/(?:meta|whatsapp)\/\d+$/,
  /^\/v1\/epicgram(?:\/|$)/,
];

export function apiGate(req: Request, res: Response, next: NextFunction): void {
  // CORS preflight carries no cookies; blocking it would break the browser
  // before the real, gated request is ever sent.
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  const normalized = req.path.replace(/\/+$/, "") || "/";
  if (PUBLIC_PATTERNS.some((pattern) => pattern.test(normalized))) {
    next();
    return;
  }

  // Authentication only. Which *rows* the caller may see is decided per route
  // by the scoping helpers, and operator-only routes carry requireOperator of
  // their own — gating everything on operator here would lock out the client
  // users the dashboard now serves.
  requireAuth(req, res, next);
}

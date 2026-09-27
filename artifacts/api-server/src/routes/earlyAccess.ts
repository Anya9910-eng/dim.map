import { Router, type IRouter } from "express";
import { recordEarlyAccessRequest } from "../lib/earlyAccess";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MAX_NAME = 120;
const MAX_EMAIL = 254;

function isPlausibleEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_EMAIL &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

/**
 * The landing page's "Request Early Access" form.
 *
 * Public by design — it is the one thing on the site an anonymous visitor is
 * meant to do — and listed as such in apiGate. It is rate-limited per address
 * in app.ts so that a script cannot fill the table.
 *
 * A duplicate submission is answered with the same 202 as a first one: the
 * visitor asked for access, and they have it requested. What the server did
 * about it is not theirs to distinguish.
 */
router.post("/early-access", async (req, res): Promise<void> => {
  const { name, email } = req.body as { name?: unknown; email?: unknown };

  if (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_NAME) {
    res.status(400).json({ error: "Enter your name" });
    return;
  }
  if (!isPlausibleEmail(email)) {
    res.status(400).json({ error: "Enter a valid email address" });
    return;
  }

  try {
    await recordEarlyAccessRequest(name, email);
    res.status(202).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to store early-access request");
    res.status(500).json({ error: "Could not save your request. Please email outreach@draftfly.app instead." });
  }
});

export default router;

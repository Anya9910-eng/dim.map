import app from "./app";
import { logger } from "./lib/logger";
import { isStripeConfigured } from "./lib/billing";
// staleDraftSweeper import retained for manual use only — NOT started automatically.
// Auto-sweeping is disabled: no draft is ever changed without explicit operator action in Slack.
// import { startStaleDraftSweeper } from "./lib/staleDraftSweeper";
import { startRetentionSweeper } from "./lib/retention";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Payments are optional per deployment. Without a key the product still runs:
// managed clients are unaffected, and self-serve clients get their trial and
// then a "not enabled" answer at checkout rather than a broken page.
if (isStripeConfigured()) {
  const missing = ["STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_GROWTH", "APP_BASE_URL"]
    .filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.warn({ missing }, "Stripe key is set but checkout cannot work until these are set too");
  } else {
    logger.info("Stripe payments enabled");
  }
} else {
  logger.info("Stripe not configured — self-serve checkout disabled");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Auto-sweep disabled: manual Slack approval is the only way to action a draft.

  // Retention is different in kind from the stale-draft sweeper above: it
  // never changes a draft's state, it removes prospect data that is past the
  // window the Privacy Policy commits to. Pending drafts are left alone.
  startRetentionSweeper();
});

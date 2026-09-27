import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { scopedClientId } from "../middleware/scope";
import {
  accessStateFor,
  appBaseUrl,
  isStripeConfigured,
  priceIdFor,
  stripeClient,
  applySubscription,
} from "../lib/billing";
import { PLAN_LIMITS, type PlanName } from "../lib/plans";
import { logger } from "../lib/logger";

/**
 * A self-serve client's own billing.
 *
 * Everything here is about the caller's tenant, taken from the session. An
 * operator has no bill of their own and gets 400s; managed clients get their
 * state but cannot check out — their money moves outside the app.
 */
const router: IRouter = Router();

async function callerClient(req: import("express").Request) {
  const id = scopedClientId(req);
  if (id === null || id < 0) return null;
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id)).limit(1);
  return client ?? null;
}

router.get("/me/billing", async (req, res): Promise<void> => {
  const client = await callerClient(req);
  if (!client) {
    res.status(400).json({ error: "Billing is per client; this session is not bound to one" });
    return;
  }
  const state = accessStateFor(client);
  res.json({
    state,
    plan: client.plan,
    limits: PLAN_LIMITS[client.plan],
    plans: (Object.keys(PLAN_LIMITS) as PlanName[]).map((key) => ({
      key,
      limits: PLAN_LIMITS[key],
      available: isStripeConfigured() && !!priceIdFor(key),
    })),
    canManage: client.billingMode === "self_serve" && !!client.stripeCustomerId,
  });
});

/**
 * Starts Stripe Checkout for a plan and answers with the URL to send the
 * browser to. The client id rides along in the subscription's metadata so the
 * webhook can find its way back without trusting the customer id alone.
 */
router.post("/me/billing/checkout", async (req, res): Promise<void> => {
  const client = await callerClient(req);
  if (!client) {
    res.status(400).json({ error: "Billing is per client; this session is not bound to one" });
    return;
  }
  if (client.billingMode !== "self_serve") {
    res.status(400).json({ error: "This account is billed outside the app" });
    return;
  }
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Payments are not enabled on this deployment yet" });
    return;
  }

  const { plan } = req.body as { plan?: unknown };
  if (plan !== "starter" && plan !== "growth") {
    res.status(400).json({ error: "Choose a plan: starter or growth" });
    return;
  }
  const priceId = priceIdFor(plan);
  if (!priceId) {
    res.status(503).json({ error: `The ${plan} plan is not configured for purchase yet` });
    return;
  }

  try {
    const stripe = stripeClient();
    const email = req.session?.user?.email;

    let customerId = client.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name: client.company ?? client.name,
        metadata: { clientId: String(client.id) },
      });
      customerId = customer.id;
      await db.update(clientsTable).set({ stripeCustomerId: customerId }).where(eq(clientsTable.id, client.id));
    }

    const base = appBaseUrl();
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { clientId: String(client.id) } },
      allow_promotion_codes: true,
      success_url: `${base}/app/settings?billing=success`,
      cancel_url: `${base}/app/settings?billing=cancelled`,
    });

    if (!session.url) throw new Error("Stripe returned a checkout session with no URL");
    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err, clientId: client.id }, "Could not start Stripe checkout");
    res.status(502).json({ error: "Could not start checkout. Please try again." });
  }
});

/** Stripe's hosted portal: change plan, update card, cancel. */
router.post("/me/billing/portal", async (req, res): Promise<void> => {
  const client = await callerClient(req);
  if (!client) {
    res.status(400).json({ error: "Billing is per client; this session is not bound to one" });
    return;
  }
  if (client.billingMode !== "self_serve" || !client.stripeCustomerId) {
    res.status(400).json({ error: "No subscription to manage yet" });
    return;
  }
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Payments are not enabled on this deployment yet" });
    return;
  }
  try {
    const session = await stripeClient().billingPortal.sessions.create({
      customer: client.stripeCustomerId,
      return_url: `${appBaseUrl()}/app/settings`,
    });
    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err, clientId: client.id }, "Could not open Stripe portal");
    res.status(502).json({ error: "Could not open the billing portal. Please try again." });
  }
});

export default router;

/**
 * Stripe → us. Mounted on the app *before* express.json so the raw body is
 * available for signature verification; see app.ts.
 *
 * Only subscription lifecycle events matter. checkout.session.completed is
 * handled too so a client sees "active" the moment they return from Stripe,
 * without waiting for the subscription.* event that follows.
 */
export async function handleStripeEvent(rawBody: Buffer, signature: string): Promise<void> {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

  const event = stripeClient().webhooks.constructEvent(rawBody, signature, secret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode === "subscription" && typeof session.subscription === "string") {
        const sub = await stripeClient().subscriptions.retrieve(session.subscription);
        await applySubscription(sub);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object);
      break;
    default:
      logger.debug({ type: event.type }, "Stripe event ignored");
  }
}

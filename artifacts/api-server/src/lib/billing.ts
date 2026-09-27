import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, clientsTable, type Client } from "@workspace/db";
import type { PlanName } from "./plans";
import { logger } from "./logger";

/**
 * Self-serve access and Stripe billing, per client.
 *
 * A client that signs up on the website gets a trial, then must subscribe.
 * A client the operator set up is "managed" and never touched by any of this.
 *
 * Only this module interprets `trialEndsAt` and `subscriptionStatus`; routes
 * ask `accessStateFor` and act on the answer. Stripe's status strings are
 * stored verbatim so a future decision — say, a longer grace period for
 * past_due — is a change here, not a migration.
 */

/** Product decision, 2026-09-12: three days, no card up front, no free tier. */
export const TRIAL_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function trialEndFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
}

export type AccessState =
  /** Operator-managed; billing happens outside the app. Never locked. */
  | { kind: "managed" }
  /** Self-serve, inside the trial. */
  | { kind: "trial"; endsAt: Date; daysLeft: number }
  /** Self-serve, paying. */
  | { kind: "active"; plan: PlanName }
  /** Payment failed; Stripe is retrying. Access continues while it does. */
  | { kind: "past_due"; plan: PlanName }
  /** Trial over or subscription gone. Read-only until they subscribe. */
  | { kind: "locked"; reason: "trial_ended" | "subscription_ended" };

type BillingFields = Pick<Client, "billingMode" | "trialEndsAt" | "subscriptionStatus" | "plan">;

export function accessStateFor(client: BillingFields, now: Date = new Date()): AccessState {
  if (client.billingMode !== "self_serve") return { kind: "managed" };

  const plan = (client.plan === "growth" ? "growth" : "starter") as PlanName;
  switch (client.subscriptionStatus) {
    case "active":
    case "trialing":
      return { kind: "active", plan };
    case "past_due":
      return { kind: "past_due", plan };
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return { kind: "locked", reason: "subscription_ended" };
    default:
      break;
  }

  // No usable subscription: the trial decides. "incomplete" (checkout started,
  // never paid) falls through here too, which is right — nothing was bought.
  if (client.trialEndsAt && client.trialEndsAt.getTime() > now.getTime()) {
    const msLeft = client.trialEndsAt.getTime() - now.getTime();
    return { kind: "trial", endsAt: client.trialEndsAt, daysLeft: Math.ceil(msLeft / DAY_MS) };
  }
  return { kind: "locked", reason: "trial_ended" };
}

export function hasAccess(state: AccessState): boolean {
  return state.kind !== "locked";
}

// ── Stripe ───────────────────────────────────────────────────────────────────

export function isStripeConfigured(): boolean {
  return !!process.env["STRIPE_SECRET_KEY"];
}

let cached: Stripe | null = null;
export function stripeClient(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!cached) cached = new Stripe(key);
  return cached;
}

/**
 * Which Stripe price sells which plan. Explicit env vars rather than product
 * metadata: the mapping is then visible in one place on the server, and a
 * price created by hand in the Stripe dashboard cannot silently grant growth.
 */
export function priceIdFor(plan: PlanName): string | null {
  const key = plan === "growth" ? "STRIPE_PRICE_GROWTH" : "STRIPE_PRICE_STARTER";
  return process.env[key] || null;
}

export function planForPriceId(priceId: string | null | undefined): PlanName | null {
  if (!priceId) return null;
  if (priceId === process.env["STRIPE_PRICE_GROWTH"]) return "growth";
  if (priceId === process.env["STRIPE_PRICE_STARTER"]) return "starter";
  return null;
}

/** Where Stripe sends people back to. Set on the VPS; never a Replit domain. */
export function appBaseUrl(): string {
  const raw = process.env["APP_BASE_URL"];
  if (!raw) throw new Error("APP_BASE_URL is not set");
  return raw.replace(/\/$/, "");
}

/**
 * Copies a subscription's state onto the client it belongs to.
 *
 * Called from the webhook for every subscription event, and from checkout
 * completion. Idempotent: applying the same subscription twice writes the
 * same values. The client is found by the id we put in the subscription's
 * metadata at checkout, falling back to the customer id.
 */
export async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const fromMeta = Number(sub.metadata?.["clientId"]);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const [client] = Number.isInteger(fromMeta) && fromMeta > 0
    ? await db.select().from(clientsTable).where(eq(clientsTable.id, fromMeta)).limit(1)
    : await db.select().from(clientsTable).where(eq(clientsTable.stripeCustomerId, customerId)).limit(1);

  if (!client) {
    logger.warn({ subscriptionId: sub.id, customerId }, "Stripe subscription for no known client — ignored");
    return;
  }

  const priceId = sub.items.data[0]?.price?.id ?? null;
  const plan = planForPriceId(priceId);
  if (!plan) {
    logger.error(
      { subscriptionId: sub.id, priceId, clientId: client.id },
      "Stripe subscription price maps to no plan — status recorded, plan left unchanged",
    );
  }

  await db
    .update(clientsTable)
    .set({
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      ...(plan ? { plan } : {}),
      billingMode: "self_serve",
    })
    .where(eq(clientsTable.id, client.id));

  logger.info(
    { clientId: client.id, status: sub.status, plan: plan ?? client.plan },
    "Applied Stripe subscription to client",
  );
}

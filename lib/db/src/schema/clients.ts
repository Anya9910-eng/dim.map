import { pgTable, serial, text, boolean, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { encryptedText } from "./encrypted";

export const clientModeEnum = pgEnum("client_mode", ["draft", "auto"]);

/**
 * Which plan a client is on. Limits live in the api-server's `plans` module
 * rather than here, so changing an allowance is a code change with a test
 * rather than a migration.
 *
 * Agency is deliberately absent: it means several Lemlist accounts under one
 * customer, which this schema cannot express — a client *is* one Lemlist
 * account. Selling it needs a grouping layer above `clients` first.
 */
export const clientPlanEnum = pgEnum("client_plan", ["starter", "growth"]);

/**
 * Who is responsible for a client's bill.
 *
 * `managed`: the operator set this client up and settles money outside the
 * app — every client that existed before self-serve, and the safe default,
 * since a row that says nothing must never lock anyone out.
 *
 * `self_serve`: the client signed up on the website. Their access is decided
 * by `trialEndsAt` and the Stripe subscription — see api-server `lib/billing`.
 */
export const billingModeEnum = pgEnum("billing_mode", ["managed", "self_serve"]);

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  // Optional. Approvals happen in the dashboard; a Slack channel only adds the
  // approval *card* on top of that. It was NOT NULL from when Slack was the
  // only way to approve anything — which stopped being true once the dashboard
  // grew working Send/Edit/Discard, and made no sense at all once sign-in
  // moved to email. A client with no channel simply gets no card.
  slackChannel: text("slack_channel"),
  slackWorkspaceId: text("slack_workspace_id"),
  // Encrypted at rest — see schema/encrypted.ts. Callers still read and write a
  // plain string; the column type handles both directions.
  slackBotToken: encryptedText("slack_bot_token"),
  mode: clientModeEnum("mode").notNull().default("draft"),
  // Starter until someone says otherwise — the safe default, since an
  // unrecognised plan must never grant the larger allowance.
  plan: clientPlanEnum("plan").notNull().default("starter"),
  lemlistApiKey: encryptedText("lemlist_api_key"),
  // Per-client shared secret for POST /api/webhooks/lemlist/:clientId. Generated
  // when the client is created and rotatable from the client card. It never
  // falls back to the global LEMLIST_WEBHOOK_SECRET — a client without one
  // simply cannot use the per-client webhook path.
  lemlistWebhookSecret: encryptedText("lemlist_webhook_secret"),
  n8nWebhookUrl: text("n8n_webhook_url"),
  isActive: boolean("is_active").notNull().default(true),
  billingMode: billingModeEnum("billing_mode").notNull().default("managed"),
  // Self-serve only. Access without a subscription ends here; null means the
  // client never had a trial (managed clients, or a subscription that started
  // before one was recorded).
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Stripe's own status string — "active", "trialing", "past_due", "canceled",
  // "unpaid", "incomplete" — copied verbatim from the last webhook. What each
  // one means for access is decided in one place, api-server `lib/billing`.
  subscriptionStatus: text("subscription_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("clients_stripe_customer_idx").on(table.stripeCustomerId)]);

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;

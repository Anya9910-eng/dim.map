import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const operatorBillingTable = pgTable("operator_billing", {
  id: serial("id").primaryKey(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOperatorBillingSchema = createInsertSchema(operatorBillingTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOperatorBilling = z.infer<typeof insertOperatorBillingSchema>;
export type OperatorBilling = typeof operatorBillingTable.$inferSelect;

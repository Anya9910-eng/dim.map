import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activityTypeEnum = pgEnum("activity_type", [
  "draft_created",
  "draft_sent",
  "draft_edited",
  "draft_discarded",
  "draft_send_failed",
  "draft_escalated",
  "draft_skipped",
  "webhook_received",
  "error",
]);

export const activityTable = pgTable("activity", {
  id: serial("id").primaryKey(),
  type: activityTypeEnum("type").notNull(),
  description: text("description").notNull(),
  clientName: text("client_name"),
  campaignName: text("campaign_name"),
  clientId: integer("client_id"),
  campaignId: integer("campaign_id"),
  draftId: integer("draft_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertActivitySchema = createInsertSchema(activityTable).omit({ id: true, createdAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activityTable.$inferSelect;

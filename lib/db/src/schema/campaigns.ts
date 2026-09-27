import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  personaId: integer("persona_id"),
  name: text("name").notNull(),
  lemlistCampaignId: text("lemlist_campaign_id").notNull(),
  tone: text("tone"),
  replyRules: text("reply_rules"),
  regionRules: text("region_rules"),
  isActive: boolean("is_active").notNull().default(true),
  replyCount: integer("reply_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true, replyCount: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;

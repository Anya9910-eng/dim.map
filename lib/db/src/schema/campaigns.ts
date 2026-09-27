import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadChannelEnum } from "./leadChannels";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  personaId: integer("persona_id"),
  name: text("name").notNull(),
  // Which source this campaign receives leads from. Lemlist for every
  // campaign created before Meta and WhatsApp existed.
  channel: leadChannelEnum("channel").notNull().default("lemlist"),
  // The campaign's id in its source system — kept under its original name so
  // nothing that already reads it changes. Lemlist: the Lemlist campaign id.
  // Meta: the Lead Ads form id (or ad campaign id). WhatsApp: any label; an
  // inbound message without one goes to the client's active WhatsApp campaign.
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

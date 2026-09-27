import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadChannelEnum, leadQualificationEnum } from "./leadChannels";

export const draftStatusEnum = pgEnum("draft_status", ["pending", "sent", "edited", "discarded", "send_failed", "escalated", "skipped"]);

export const draftsTable = pgTable("drafts", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  campaignId: integer("campaign_id").notNull(),
  // Where the lead arrived from — decides where an approved reply is sent.
  channel: leadChannelEnum("channel").notNull().default("lemlist"),
  // Empty for a WhatsApp lead, who has a phone number and no address.
  prospectEmail: text("prospect_email").notNull(),
  // E.164 digits without "+", as WhatsApp reports them. Null for email leads.
  prospectPhone: text("prospect_phone"),
  // The model's read on the lead, produced alongside the draft.
  qualification: leadQualificationEnum("qualification"),
  qualificationReason: text("qualification_reason"),
  // Lemlist's own lead id (e.g. "lea_8xJSc7sV7ggpiVnXe"), from the webhook
  // payload. Required to send the reply back — POST /campaigns/:id/leads/:id/reply
  // takes this id, not an email address. Null on drafts created before this
  // column existed; those cannot be sent back through Lemlist and are sendable
  // manually only.
  lemlistLeadId: text("lemlist_lead_id"),
  prospectName: text("prospect_name").notNull(),
  prospectCompany: text("prospect_company"),
  prospectCountry: text("prospect_country"),
  prospectRole: text("prospect_role"),
  conversationSnippet: text("conversation_snippet"),
  replyText: text("reply_text").notNull(),
  editedReplyText: text("edited_reply_text"),
  status: draftStatusEnum("status").notNull().default("pending"),
  slackMessageTs: text("slack_message_ts"),
  actionedAt: timestamp("actioned_at", { withTimezone: true }),
  sweeperAlertedAt: timestamp("sweeper_alerted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDraftSchema = createInsertSchema(draftsTable).omit({ id: true, createdAt: true, actionedAt: true });
export type InsertDraft = z.infer<typeof insertDraftSchema>;
export type Draft = typeof draftsTable.$inferSelect;

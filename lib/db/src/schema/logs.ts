import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const logLevelEnum = pgEnum("log_level", ["info", "warning", "error"]);
export const logSourceEnum = pgEnum("log_source", ["lemlist", "n8n", "claude", "slack", "system"]);
export const logFinalStatusEnum = pgEnum("log_final_status", ["draft", "sent", "edited", "discarded", "send_failed"]);

export const logsTable = pgTable("logs", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id"),
  campaignId: integer("campaign_id"),
  draftId: integer("draft_id"),
  leadId: text("lead_id"),
  level: logLevelEnum("level").notNull().default("info"),
  message: text("message").notNull(),
  source: logSourceEnum("source").notNull().default("system"),
  generatedDraft: text("generated_draft"),
  finalStatus: logFinalStatusEnum("final_status"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLogSchema = createInsertSchema(logsTable).omit({ id: true, createdAt: true });
export type InsertLog = z.infer<typeof insertLogSchema>;
export type Log = typeof logsTable.$inferSelect;

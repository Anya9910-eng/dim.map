import { pgTable, serial, text, timestamp, pgEnum, real } from "drizzle-orm/pg-core";

export const epicgramDraftStatusEnum = pgEnum("epicgram_draft_status", [
  "pending",
  "approved",
  "rejected",
]);

export const epicgramDraftsTable = pgTable("epicgram_drafts", {
  id: serial("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  auditId: text("audit_id").notNull(),
  telegramAccountSlot: text("telegram_account_slot"),
  chatId: text("chat_id").notNull(),
  chatTitle: text("chat_title"),
  messages: text("messages").notNull(),
  task: text("task").notNull(),
  replyText: text("reply_text").notNull(),
  editedText: text("edited_text"),
  confidenceScore: real("confidence_score"),
  detectedIntent: text("detected_intent"),
  suggestedAction: text("suggested_action"),
  status: epicgramDraftStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  actionedAt: timestamp("actioned_at", { withTimezone: true }),
});

export type EpicgramDraft = typeof epicgramDraftsTable.$inferSelect;

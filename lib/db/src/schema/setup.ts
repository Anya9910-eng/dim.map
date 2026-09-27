import { pgTable, serial, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const setupCategoryEnum = pgEnum("setup_category", ["infrastructure", "integrations", "configuration", "testing"]);
export const checklistTypeEnum = pgEnum("checklist_type", ["client_onboarding", "internal_setup"]);

export const setupItemsTable = pgTable("setup_items", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: setupCategoryEnum("category").notNull(),
  checklistType: checklistTypeEnum("checklist_type").notNull().default("internal_setup"),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertSetupItemSchema = createInsertSchema(setupItemsTable).omit({ id: true });
export type InsertSetupItem = z.infer<typeof insertSetupItemSchema>;
export type SetupItem = typeof setupItemsTable.$inferSelect;

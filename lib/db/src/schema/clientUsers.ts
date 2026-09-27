import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * People allowed into a client's own dashboard.
 *
 * Membership is by email. Nothing here grants access on its own: the person
 * still has to prove they can read that inbox, by entering the one-time code
 * sent to it. A row is permission, not authentication.
 *
 * Emails are stored lowercased and are unique across all clients: one address
 * belongs to one client, so a login can never resolve ambiguously.
 */
export const clientUsersTable = pgTable(
  "client_users",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").notNull(),
    email: text("email").notNull(),
    invitedBy: text("invited_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("client_users_email_idx").on(table.email)],
);

export const insertClientUserSchema = createInsertSchema(clientUsersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertClientUser = z.infer<typeof insertClientUserSchema>;
export type ClientUser = typeof clientUsersTable.$inferSelect;

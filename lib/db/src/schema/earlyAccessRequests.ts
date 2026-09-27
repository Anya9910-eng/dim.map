import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * People who asked for access from the landing page.
 *
 * The form is the site's only conversion action, so a request is written here
 * *before* anyone is notified: a mail-provider outage must not lose a lead.
 * `notifiedAt` records whether the operator email actually went out, which is
 * what to query when checking for requests that were never followed up.
 */
export const earlyAccessRequestsTable = pgTable(
  "early_access_requests",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("early_access_requests_email_idx").on(table.email, table.createdAt)],
);

export const insertEarlyAccessRequestSchema = createInsertSchema(earlyAccessRequestsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertEarlyAccessRequest = z.infer<typeof insertEarlyAccessRequestSchema>;
export type EarlyAccessRequest = typeof earlyAccessRequestsTable.$inferSelect;

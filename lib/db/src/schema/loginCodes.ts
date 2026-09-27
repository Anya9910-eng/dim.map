import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One-time sign-in codes emailed to a person proving they own an address.
 *
 * Sign-in is entirely email-based: whoever can read the inbox can sign in, and
 * `resolveIdentity` then decides from that same address whether they are an
 * operator or one client's staff. This table is only the proof step.
 *
 * The code itself is never stored — `codeHash` is an HMAC keyed with
 * SESSION_SECRET. A dump of this table therefore does not let the reader sign
 * in as anyone, which matters because these rows sit in the same database as
 * the client data they protect.
 *
 * Rows are kept after use rather than deleted: `consumedAt` makes a replay
 * visible instead of silently minting a second session, and the recent history
 * is what the per-address send throttle counts.
 */
export const loginCodesTable = pgTable(
  "login_codes",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /** Wrong guesses so far. The row dies at MAX_ATTEMPTS, so a 6-digit code
     * cannot be walked through 10^6 possibilities. */
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("login_codes_email_idx").on(table.email, table.createdAt)],
);

export const insertLoginCodeSchema = createInsertSchema(loginCodesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertLoginCode = z.infer<typeof insertLoginCodeSchema>;
export type LoginCode = typeof loginCodesTable.$inferSelect;

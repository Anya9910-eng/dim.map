import { and, eq, gt } from "drizzle-orm";
import { db, earlyAccessRequestsTable } from "@workspace/db";
import { normalizeEmail } from "./loginCodes";
import { sendEarlyAccessNotification } from "./email";
import { logger } from "./logger";

/**
 * A repeat submission from the same address inside this window is answered
 * as a success but neither stored nor announced again. Double-clicks and
 * "did it go through?" resubmits are common on a form like this and each one
 * would otherwise land in the operator's inbox.
 */
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function operatorNotificationAddresses(): string[] {
  return (process.env["OPERATOR_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Records a landing-page access request and tells the operators about it.
 *
 * The row is written first, and the function never throws after that: the
 * lead is safe in the database whatever the mail provider does. If the
 * notification cannot be delivered the request is logged at warn level
 * instead, so it is still findable from the host.
 */
export async function recordEarlyAccessRequest(name: string, rawEmail: string): Promise<{ stored: boolean }> {
  const email = normalizeEmail(rawEmail);
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);

  const recent = await db
    .select({ id: earlyAccessRequestsTable.id })
    .from(earlyAccessRequestsTable)
    .where(and(eq(earlyAccessRequestsTable.email, email), gt(earlyAccessRequestsTable.createdAt, since)))
    .limit(1);
  if (recent.length > 0) {
    logger.info({ email }, "Early-access request repeated within 24h — not stored again");
    return { stored: false };
  }

  const [row] = await db
    .insert(earlyAccessRequestsTable)
    .values({ name: name.trim(), email })
    .returning({ id: earlyAccessRequestsTable.id });

  const recipients = operatorNotificationAddresses();
  const result = recipients.length > 0
    ? await sendEarlyAccessNotification(recipients, name.trim(), email)
    : { delivered: false as const, reason: "OPERATOR_EMAILS is not set" };

  if (result.delivered && row) {
    await db
      .update(earlyAccessRequestsTable)
      .set({ notifiedAt: new Date() })
      .where(eq(earlyAccessRequestsTable.id, row.id));
    logger.info({ email, requestId: row.id }, "Early-access request stored and operators notified");
  } else {
    logger.warn(
      { email, name: name.trim(), requestId: row?.id, reason: result.reason },
      "Early-access request stored but operators were NOT emailed — follow up from the early_access_requests table",
    );
  }

  return { stored: true };
}

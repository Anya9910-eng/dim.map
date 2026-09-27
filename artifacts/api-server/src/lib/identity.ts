import { eq } from "drizzle-orm";
import { db, clientUsersTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Who a signed-in person is, decided once at login.
 *
 * Two populations share the same email sign-in:
 *   operator — us. Sees every client, edits credentials, creates clients.
 *   client   — one customer's staff. Sees only that customer's data.
 *
 * Both are resolved from the address the sign-in code proved ownership of,
 * never from anything the browser sends. This has always been email-based;
 * sign-in used to prove the address through Slack OAuth and now proves it with
 * a one-time code, which changes nothing here.
 */
export type Role = "operator" | "client";

export interface Identity {
  role: Role;
  /** The client this person belongs to. Always null for an operator. */
  clientId: number | null;
}

const OPERATOR_EMAILS_ENV = "OPERATOR_EMAILS";

function operatorEmails(): string[] {
  return (process.env[OPERATOR_EMAILS_ENV] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOperatorEmail(email: string): boolean {
  const allowed = operatorEmails();
  if (allowed.length === 0) {
    // Fail closed. An empty list means the deployment has not been configured
    // yet; granting operator access to everyone in that window is exactly the
    // hole this replaces.
    logger.error(
      `${OPERATOR_EMAILS_ENV} is not set — no one can be an operator. Set it to the operators' email addresses.`,
    );
    return false;
  }
  return allowed.includes(email.trim().toLowerCase());
}

/**
 * Resolves the role for an email whose ownership has just been proven.
 * Returns null when the address matches neither an operator nor an invited
 * client user — that person has no access at all.
 */
export async function resolveIdentity(email: string): Promise<Identity | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  if (isOperatorEmail(normalized)) {
    return { role: "operator", clientId: null };
  }

  const [membership] = await db
    .select()
    .from(clientUsersTable)
    .where(eq(clientUsersTable.email, normalized));

  if (membership) {
    return { role: "client", clientId: membership.clientId };
  }

  return null;
}

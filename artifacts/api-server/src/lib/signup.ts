import { db, clientsTable, clientUsersTable } from "@workspace/db";
import { resolveIdentity } from "./identity";
import { generateWebhookSecret } from "./lemlist";
import { trialEndFrom } from "./billing";
import { logger } from "./logger";

/**
 * Self-serve account creation.
 *
 * A signup is a new client (the tenant) plus its first user, on a trial. It
 * is deliberately *not* a login: the caller still has to prove the address by
 * entering the emailed code, exactly like everyone else. So an unverified
 * signup costs an attacker nothing but a row, and a typo'd address creates a
 * tenant no one can ever enter — which the retention sweep can later reap.
 */
export type SignupResult =
  /** Fresh tenant created; the caller should now send a sign-in code. */
  | { kind: "created"; clientId: number }
  /** The address already has access somewhere; treat as a plain sign-in. */
  | { kind: "existing" };

export async function createSelfServeAccount(input: {
  email: string;
  name: string;
  company: string;
}): Promise<SignupResult> {
  const email = input.email.trim().toLowerCase();

  // An address that already resolves — operator or invited user — must not get
  // a second tenant, and must not be told it already exists either. The route
  // answers identically; here we just decline to create.
  if (await resolveIdentity(email)) return { kind: "existing" };

  const clientId = await db.transaction(async (tx) => {
    const [client] = await tx
      .insert(clientsTable)
      .values({
        name: input.company.trim(),
        company: input.company.trim(),
        plan: "starter",
        billingMode: "self_serve",
        trialEndsAt: trialEndFrom(),
        lemlistWebhookSecret: generateWebhookSecret(),
      })
      .returning({ id: clientsTable.id });
    if (!client) throw new Error("Insert returned no client row");

    await tx.insert(clientUsersTable).values({
      clientId: client.id,
      email,
      invitedBy: "self-serve signup",
    });
    return client.id;
  });

  logger.info({ clientId, email }, "Self-serve account created; trial started");
  return { kind: "created", clientId };
}

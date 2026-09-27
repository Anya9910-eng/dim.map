import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  clientsTable,
  clientUsersTable,
  draftsTable,
  campaignsTable,
  personasTable,
  logsTable,
  activityTable,
} from "@workspace/db";
import {
  ListClientsResponse,
  CreateClientBody,
  CreateClientResponse,
  GetClientParams,
  GetClientResponse,
  UpdateClientParams,
  UpdateClientBody,
  UpdateClientResponse,
  DeleteClientParams,
} from "@workspace/api-zod";
import { requireOperator } from "../middleware/requireOperator";
import { canAccessClient, denyNotFound, scopedClientId, isOperator } from "../middleware/scope";
import { generateWebhookSecret } from "../lib/lemlist";
import { accessStateFor } from "../lib/billing";


/**
 * Strips credentials from a client row before it leaves the API for a client
 * user.
 *
 * The columns decrypt transparently on read, so without this the browser of
 * every invited client user would receive a working Slack bot token and Lemlist
 * key in plain JSON — undoing much of what encrypting them at rest bought.
 * Operators keep the values because the client card edits them.
 */
function redactForClientUser<T extends Record<string, unknown>>(req: import("express").Request, row: T): T {
  if (isOperator(req)) return row;
  return { ...row, slackBotToken: null, lemlistApiKey: null, lemlistWebhookSecret: null };
}

const router: IRouter = Router();

/**
 * The webhook URL an operator hands to the client to paste into Lemlist.
 *
 * Lemlist cannot send custom headers on outgoing webhooks, so the secret rides
 * in the query string. The `X-Webhook-Secret` header still works for n8n and
 * anything else that can set one.
 */
function buildWebhookInfo(
  req: import("express").Request,
  client: { id: number; lemlistWebhookSecret: string | null; lemlistApiKey: string | null },
) {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  const base = configured || `${req.protocol}://${req.get("host") ?? ""}`;
  const path = `/api/webhooks/lemlist/${client.id}`;
  const secret = client.lemlistWebhookSecret;
  const hasClientApiKey = !!client.lemlistApiKey?.trim();
  return {
    clientId: client.id,
    path,
    url: secret ? `${base}${path}?secret=${encodeURIComponent(secret)}` : null,
    secret,
    hasSecret: !!secret,
    headerName: "X-Webhook-Secret",
    hasClientApiKey,
    usingGlobalApiKeyFallback: !hasClientApiKey && !!process.env.LEMLIST_API_KEY?.trim(),
  };
}


/**
 * The two computed billing fields the operator dashboard shows. Derived from
 * the same accessStateFor the paywall uses, so the badge can never disagree
 * with whether the client is actually locked.
 */
function billingDisplay(client: typeof clientsTable.$inferSelect): { billingStatus: string; trialDaysLeft: number | null } {
  const state = accessStateFor(client);
  return {
    billingStatus: state.kind,
    trialDaysLeft: state.kind === "trial" ? state.daysLeft : null,
  };
}

router.get("/clients", async (req, res): Promise<void> => {
  const scoped = scopedClientId(req);
  const clients = scoped === null
    ? await db.select().from(clientsTable).orderBy(clientsTable.createdAt)
    : await db.select().from(clientsTable).where(eq(clientsTable.id, scoped));
  res.json(ListClientsResponse.parse(clients.map((c) => ({ ...redactForClientUser(req, c), ...billingDisplay(c) }))));
});

router.post("/clients", requireOperator, async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  // Every client gets its own webhook secret up front — the per-client webhook
  // path is unusable without one, and nothing else generates it lazily.
  const [client] = await db
    .insert(clientsTable)
    .values({ ...parsed.data, lemlistWebhookSecret: generateWebhookSecret() })
    .returning();
  res.status(201).json(CreateClientResponse.parse(client));
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.id));
  if (!client || !canAccessClient(req, client.id)) {
    denyNotFound(res, "Client");
    return;
  }
  res.json(GetClientResponse.parse({ ...redactForClientUser(req, client), ...billingDisplay(client) }));
});

// ─── Lemlist webhook endpoint for this client ──────────────────────────────
// GET returns the ready-to-paste URL; POST rotates the secret, which
// immediately invalidates the URL the client already has.
//
// Both sit behind the default-deny apiGate (operator session required); the
// rotation additionally carries requireOperator explicitly, like PATCH does.

function parseClientIdParam(raw: unknown): number | null {
  if (typeof raw !== "string" || raw === "") return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/clients/:id/lemlist-webhook", requireOperator, async (req, res): Promise<void> => {
  const id = parseClientIdParam(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(buildWebhookInfo(req, client));
});

router.post("/clients/:id/lemlist-webhook/regenerate", requireOperator, async (req, res): Promise<void> => {
  const id = parseClientIdParam(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }
  const [client] = await db
    .update(clientsTable)
    .set({ lemlistWebhookSecret: generateWebhookSecret() })
    .where(eq(clientsTable.id, id))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  req.log.info({ clientId: id }, "Lemlist webhook secret regenerated — the previous URL no longer works");
  res.json(buildWebhookInfo(req, client));
});

// Channel binding (and any client edit) is a write to operator config — gate it
// behind the operator session, same as the Slack binding endpoints.
router.patch("/clients/:id", requireOperator, async (req, res): Promise<void> => {
  const params = UpdateClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const [client] = await db
    .update(clientsTable)
    .set(parsed.data)
    .where(eq(clientsTable.id, params.data.id))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(UpdateClientResponse.parse(client));
});

router.delete("/clients/:id", requireOperator, async (req, res): Promise<void> => {
  const params = DeleteClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;

  // Six tables carry a client_id and none of them has a foreign key, so
  // deleting only the client row left its drafts, campaigns, personas, logs and
  // activity behind — invisible to everyone, since nothing owns them any more —
  // and its client_users still resolving a sign-in to a client that no longer
  // exists. All of it goes in one transaction: a half-deleted client is worse
  // than either outcome.
  const removed = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(clientsTable).where(eq(clientsTable.id, id));
    if (!row) return null;

    await tx.delete(activityTable).where(eq(activityTable.clientId, id));
    await tx.delete(draftsTable).where(eq(draftsTable.clientId, id));
    await tx.delete(logsTable).where(eq(logsTable.clientId, id));
    await tx.delete(campaignsTable).where(eq(campaignsTable.clientId, id));
    await tx.delete(personasTable).where(eq(personasTable.clientId, id));
    await tx.delete(clientUsersTable).where(eq(clientUsersTable.clientId, id));
    await tx.delete(clientsTable).where(eq(clientsTable.id, id));
    return row;
  });

  if (!removed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  req.log.info({ clientId: id, name: removed.name }, "Client deleted with all of its data");
  res.sendStatus(204);
});

// ─── Client dashboard access ────────────────────────────────────────────────
//
// Who may sign in and see this client's data. Operator-only: this is the list
// that decides access, so letting a client edit it would let them invite
// anyone, and letting them read it would expose their colleagues' addresses to
// anyone who got in once.

router.get("/clients/:id/users", requireOperator, async (req, res): Promise<void> => {
  const id = parseClientIdParam(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }
  const users = await db
    .select()
    .from(clientUsersTable)
    .where(eq(clientUsersTable.clientId, id))
    .orderBy(clientUsersTable.createdAt);
  res.json(users);
});

router.post("/clients/:id/users", requireOperator, async (req, res): Promise<void> => {
  const id = parseClientIdParam(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }
  const email = String((req.body as { email?: unknown }).email ?? "").trim().toLowerCase();
  // Deliberately permissive: the address only matters if Slack later vouches
  // for it, so the check is against typos, not an attempt at validation.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(422).json({ error: "A valid email address is required" });
    return;
  }

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const [existing] = await db.select().from(clientUsersTable).where(eq(clientUsersTable.email, email));
  if (existing) {
    // One address belongs to one client, so a login never resolves ambiguously.
    res.status(409).json({
      error: existing.clientId === id
        ? "This address already has access to this client"
        : "This address already has access to a different client",
    });
    return;
  }

  const [created] = await db
    .insert(clientUsersTable)
    .values({ clientId: id, email, invitedBy: req.session.user?.email ?? null })
    .returning();
  res.status(201).json(created);
});

router.delete("/clients/:id/users/:userId", requireOperator, async (req, res): Promise<void> => {
  const id = parseClientIdParam(req.params.id);
  const userId = parseClientIdParam(req.params.userId);
  if (id === null || userId === null) {
    res.status(400).json({ error: "ids must be positive integers" });
    return;
  }
  const [removed] = await db
    .delete(clientUsersTable)
    .where(and(eq(clientUsersTable.id, userId), eq(clientUsersTable.clientId, id)))
    .returning();
  if (!removed) {
    res.status(404).json({ error: "Access entry not found" });
    return;
  }
  // Their existing session keeps working until it expires; revoking it here
  // would mean reaching into the session store, which is left as follow-up.
  res.sendStatus(204);
});

export default router;

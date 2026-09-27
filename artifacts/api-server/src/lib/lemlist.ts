import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, clientsTable, type Client } from "@workspace/db";
import { logger } from "./logger";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from "express";

// ─── Configuration ─────────────────────────────────────────────────────────

/**
 * Resolve the Lemlist API key to use for a request.
 *
 * The Lemlist account belongs to the client, so the key stored on the client
 * card wins. `LEMLIST_API_KEY` stays as a fallback for clients that have not
 * had their own key entered yet — without it the existing single client would
 * stop working the moment this shipped.
 */
export function resolveLemlistApiKey(clientApiKey?: string | null): string | undefined {
  const perClient = clientApiKey?.trim();
  if (perClient) return perClient;
  const global = process.env.LEMLIST_API_KEY?.trim();
  return global || undefined;
}

/** True when *some* key is available for this client (own key or global fallback). */
export function isLemlistConfigured(clientApiKey?: string | null): boolean {
  return !!resolveLemlistApiKey(clientApiKey);
}

/**
 * The key for anything done *on behalf of a client* — no global fallback.
 *
 * `resolveLemlistApiKey` falls back to the operator's LEMLIST_API_KEY, which is
 * fine for the operator's own connection test and wrong for everything else: a
 * client with no key of their own would otherwise read the operator's campaign
 * list and send replies out of the operator's Lemlist account. That is the same
 * shape of mistake the global SLACK_CHANNEL_ID fallback made when it posted
 * several clients' prospects into one shared channel.
 *
 * A client without a key is not "configured with someone else's" — it is
 * unconfigured, and the caller should say so.
 */
export function clientLemlistApiKey(clientApiKey?: string | null): string | undefined {
  return clientApiKey?.trim() || undefined;
}

/** True when this client has a key **of their own**. */
export function isClientLemlistConfigured(clientApiKey?: string | null): boolean {
  return !!clientLemlistApiKey(clientApiKey);
}

export function isWebhookSecretConfigured(): boolean {
  return !!process.env.LEMLIST_WEBHOOK_SECRET;
}

// ─── Webhook secrets ────────────────────────────────────────────────────────

/** A fresh per-client webhook secret. URL-safe so it can live in a query string. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time string comparison.
 *
 * `!==` leaks the length of the matching prefix through response timing, which
 * is enough to recover a secret one character at a time. Length is compared
 * first (it is not secret — the format is fixed) and a same-length dummy
 * comparison keeps the timing profile flat on the mismatch path.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Reads the secret Lemlist sent, from either supported location. */
function readProvidedSecret(req: ExpressRequest): {
  value: string | null;
  fromHeader: boolean;
  fromQuery: boolean;
} {
  const header = req.headers["x-webhook-secret"];
  const query = req.query["secret"];
  // Google Ads lead forms have their own "Key" field, delivered in the body
  // as google_key. The client sets it to this same secret.
  const googleKey = (req.body as Record<string, unknown> | undefined)?.["google_key"];
  const fromHeader = typeof header === "string" && header.length > 0;
  const fromQuery = typeof query === "string" && query.length > 0;
  const fromBody = typeof googleKey === "string" && googleKey.length > 0;
  const value = fromHeader ? (header as string) : fromQuery ? (query as string) : fromBody ? (googleKey as string) : null;
  return { value, fromHeader, fromQuery };
}

/**
 * Express middleware that verifies incoming Lemlist webhook requests carry the
 * correct *global* shared secret — either in the `X-Webhook-Secret` header (n8n
 * path) or as a `?secret=` query parameter (direct Lemlist registration path,
 * since Lemlist does not support custom headers on outgoing webhooks).
 *
 * This guards the legacy, client-agnostic `/api/webhooks/lemlist` path only.
 * New clients get the per-client path guarded by
 * {@link requireClientWebhookSecret}.
 *
 * - If `LEMLIST_WEBHOOK_SECRET` is set: either source must match exactly; mismatches
 *   return 401 and the request is dropped.
 * - If `LEMLIST_WEBHOOK_SECRET` is not set: requests are rejected with 503 so the
 *   endpoint is disabled rather than open to anyone.
 */
export function requireWebhookSecret(req: ExpressRequest, res: ExpressResponse, next: NextFunction): void {
  const secret = process.env.LEMLIST_WEBHOOK_SECRET;

  if (!secret) {
    logger.error(
      { path: req.path },
      "LEMLIST_WEBHOOK_SECRET is not configured — webhook endpoint is disabled.",
    );
    res.status(503).json({
      ok: false,
      error: "Webhook endpoint is not configured. Set LEMLIST_WEBHOOK_SECRET in the environment.",
    });
    return;
  }

  const { value: provided, fromHeader, fromQuery } = readProvidedSecret(req);

  if (!provided || !secretsMatch(provided, secret)) {
    logger.warn(
      { path: req.path, hasHeader: fromHeader, hasQuery: fromQuery },
      "Lemlist webhook rejected — missing or invalid secret",
    );
    res.status(401).json({ ok: false, error: "Unauthorized: invalid or missing webhook secret" });
    return;
  }

  next();
}

/** Key under which {@link requireClientWebhookSecret} leaves the authenticated client. */
export const LEMLIST_WEBHOOK_CLIENT = "lemlistWebhookClient";

/** Reads the client authenticated by {@link requireClientWebhookSecret}, if any. */
export function getWebhookClient(res: ExpressResponse): Client | undefined {
  return res.locals[LEMLIST_WEBHOOK_CLIENT] as Client | undefined;
}

/**
 * Express middleware for `POST /api/webhooks/lemlist/:clientId`.
 *
 * Secret verification runs before the body is trusted, so the client cannot be
 * derived from `payload.campaignId` the way the handler does it — that lookup
 * happens after authentication, not before. The client id therefore travels in
 * the URL, and each client's secret only unlocks that client's own path.
 *
 * On success the resolved client is left on `res.locals` so the handler does
 * not repeat the lookup.
 */
export async function requireClientWebhookSecret(
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> {
  const raw = req.params["clientId"];
  const clientId = Number(raw);
  if (!raw || !Number.isInteger(clientId) || clientId <= 0) {
    res.status(404).json({ ok: false, error: "Unknown webhook endpoint" });
    return;
  }

  const { value: provided, fromHeader, fromQuery } = readProvidedSecret(req);
  if (!provided) {
    logger.warn({ clientId }, "Lemlist client webhook rejected — no secret provided");
    res.status(401).json({ ok: false, error: "Unauthorized: invalid or missing webhook secret" });
    return;
  }

  let client: Client | undefined;
  try {
    [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  } catch (err) {
    logger.error({ err, clientId }, "Lemlist client webhook — client lookup failed");
    res.status(500).json({ ok: false, error: "Internal error" });
    return;
  }

  // An unknown client and a wrong secret answer identically, so the endpoint
  // cannot be used to enumerate which client ids exist.
  const expected = client?.lemlistWebhookSecret;
  if (!expected || !secretsMatch(provided, expected)) {
    logger.warn(
      { clientId, clientExists: !!client, hasSecret: !!expected, fromHeader, fromQuery },
      "Lemlist client webhook rejected — missing or invalid secret",
    );
    res.status(401).json({ ok: false, error: "Unauthorized: invalid or missing webhook secret" });
    return;
  }

  res.locals[LEMLIST_WEBHOOK_CLIENT] = client;
  next();
}

const LEMLIST_BASE = "https://api.lemlist.com/api";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LemlistCampaign {
  _id: string;
  name: string;
  status: string;
  sendingSchedule?: unknown;
}

export interface LemlistWebhookPayload {
  type: string;
  campaignId: string;
  leadId?: string;
  leadEmail?: string;
  leadFirstName?: string;
  leadLastName?: string;
  leadCompanyName?: string;
  country?: string;
  jobTitle?: string;
  replyText?: string;
  text?: string;
  [key: string]: unknown;
}

/** Common option for every Lemlist call: whose account to act on. */
export interface LemlistAuthOptions {
  /** The client's own key. Falls back to `LEMLIST_API_KEY` when absent. */
  apiKey?: string | null;
}

// ─── API calls ──────────────────────────────────────────────────────────────

function requireApiKey(clientApiKey?: string | null): string {
  const key = resolveLemlistApiKey(clientApiKey);
  if (!key) {
    throw new Error(
      "No Lemlist API key available. Set one on the client card, or configure LEMLIST_API_KEY as a fallback.",
    );
  }
  return key;
}

async function lemlistFetch(path: string, apiKey: string, options?: RequestInit): Promise<Response> {
  const auth = Buffer.from(`any:${apiKey}`).toString("base64");
  return fetch(`${LEMLIST_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
}

export const TEST_CONNECTION_TIMEOUT_MS = 10_000;
export const GET_CAMPAIGNS_TIMEOUT_MS = 15_000;

export async function testConnection(opts?: LemlistAuthOptions & {
  /** Override the default 10 s timeout — useful in tests. */
  timeoutMs?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const key = resolveLemlistApiKey(opts?.apiKey);
  if (!key) {
    return { ok: false, error: "No Lemlist API key configured for this client" };
  }
  const timeoutMs = opts?.timeoutMs ?? TEST_CONNECTION_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await lemlistFetch("/campaigns?limit=1", key, { signal: controller.signal });
    if (res.ok) return { ok: true };
    const body = await res.text();
    return { ok: false, error: `HTTP ${res.status}: ${body}` };
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      logger.error({ timeoutMs }, "Lemlist testConnection timed out — no response within the allowed window");
      return { ok: false, error: "timeout" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Lemlist connection test failed");
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function getCampaigns(opts?: LemlistAuthOptions & {
  /** Override the default 15 s timeout — useful in tests. */
  timeoutMs?: number;
}): Promise<LemlistCampaign[]> {
  const key = requireApiKey(opts?.apiKey);
  const timeoutMs = opts?.timeoutMs ?? GET_CAMPAIGNS_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await lemlistFetch("/campaigns", key, { signal: controller.signal });
    if (!res.ok) throw new Error(`Lemlist API error: HTTP ${res.status}`);
    const data = await res.json() as { campaigns?: LemlistCampaign[] } | LemlistCampaign[];
    return Array.isArray(data) ? data : (data.campaigns ?? []);
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      logger.error({ timeoutMs }, "Lemlist getCampaigns timed out — no response within the allowed window");
      throw new Error("timeout");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const SEND_REPLY_TIMEOUT_MS = 30_000;

/** The fields of a Lemlist activity that identify who sent it, and from where. */
interface LemlistActivity {
  type?: string;
  sendUserId?: string;
  sendUserEmail?: string;
  sendUserMailboxId?: string;
}

/** The identity a reply is sent as: which user, from which connected mailbox. */
interface SenderIdentity {
  sendUserId: string;
  sendUserEmail: string;
  sendUserMailboxId: string;
}

/**
 * Works out which mailbox the reply must be sent from.
 *
 * A campaign typically rotates across several mailboxes to spread sending
 * volume, so "the account's mailbox" is not a single thing and picking one at
 * random is wrong: the lead would receive a reply from an address they have
 * never seen, on a thread started by a different one. Observed on a single live
 * campaign, two mailboxes were in use — `jashl@` and `jash@` on the same
 * domain — so choosing the first would have been close to a coin flip.
 *
 * Lemlist records the sending identity on each activity, so the answer is read
 * from this lead's own history: whichever mailbox last emailed them is the one
 * that replies to them. That also sidesteps `/user/channels`, which reports the
 * API key owner's channels and can be empty while the campaign's real
 * mailboxes are attached to another team member.
 *
 * Read live rather than stored: mailboxes get disconnected and rotated, and a
 * stale copy here would fail in a way that looked like our bug rather than
 * their configuration.
 */
async function resolveSenderIdentity(
  key: string,
  leadId: string,
  signal: AbortSignal,
): Promise<{ ok: true; identity: SenderIdentity } | { ok: false; error: string }> {
  const res = await lemlistFetch(
    `/activities?leadId=${encodeURIComponent(leadId)}&limit=50`,
    key,
    { signal },
  );
  if (!res.ok) {
    return { ok: false, error: `could not read this lead's activity: HTTP ${res.status}` };
  }

  const parsed = (await res.json()) as LemlistActivity[] | { data?: LemlistActivity[] };
  const activities = Array.isArray(parsed) ? parsed : (parsed.data ?? []);

  // Newest first, and only some activity types carry a mailbox — a "paused" or
  // "conditionChosen" row has none, so the first *complete* one wins.
  const sent = activities.find(
    (a) => a.sendUserId && a.sendUserEmail && a.sendUserMailboxId,
  );

  if (!sent) {
    logger.error(
      { leadId, activityCount: activities.length },
      "No Lemlist activity for this lead carries a sending mailbox — cannot decide which address to reply from",
    );
    return {
      ok: false,
      error:
        "could not determine which mailbox emailed this lead, so the reply was not sent — check the lead still exists in Lemlist and its campaign has a connected mailbox",
    };
  }

  return {
    ok: true,
    identity: {
      sendUserId: sent.sendUserId!,
      sendUserEmail: sent.sendUserEmail!,
      sendUserMailboxId: sent.sendUserMailboxId!,
    },
  };
}

/** Plain text to the minimal HTML `/inbox/email` expects, preserving breaks. */
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Sends the approved draft back to the lead, threaded onto their conversation.
 *
 * This used to POST `/campaigns/{id}/leads/{id}/reply`, which is not a Lemlist
 * route at all — it answers 405 before authentication is even considered, so
 * every send failed identically no matter whose key was used. That is why no
 * approved reply has ever reached a lead. The real endpoint is `/inbox/email`
 * (Lemlist's own docs index lists `/inbox/send-email`, which 405s too).
 *
 * `replyToActivityId: "latest"` threads onto the existing conversation and
 * reuses its subject, so the lead sees a reply rather than a new cold email.
 */
export async function sendReply(params: LemlistAuthOptions & {
  leadId: string;
  campaignId: string;
  replyText: string;
  /** Override the default 30 s timeout — useful in tests. */
  timeoutMs?: number;
}): Promise<{ ok: boolean; error?: string }> {
  // Deliberately the client's own key, never the operator's fallback. Sending
  // is the one call with an irreversible effect on someone else's inbox, and
  // doing it through the wrong Lemlist account would deliver a reply from a
  // mailbox the lead has never corresponded with — and from a business that is
  // not the one they wrote to.
  const key = clientLemlistApiKey(params.apiKey);
  if (!key) {
    return {
      ok: false,
      error: "This client has no Lemlist API key of their own — add one in Settings before sending.",
    };
  }

  const timeoutMs = params.timeoutMs ?? SEND_REPLY_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const sender = await resolveSenderIdentity(key, params.leadId, controller.signal);
    if (!sender.ok) {
      logger.error(
        { campaignId: params.campaignId, leadId: params.leadId, reason: sender.error },
        "Lemlist sendReply: could not resolve a sender",
      );
      return { ok: false, error: sender.error };
    }

    const res = await lemlistFetch("/inbox/email", key, {
      method: "POST",
      body: JSON.stringify({
        ...sender.identity,
        leadId: params.leadId,
        message: textToHtml(params.replyText),
        // Threads onto the lead's existing conversation and reuses its subject.
        replyToActivityId: "latest",
      }),
      signal: controller.signal,
    });

    if (res.ok) return { ok: true };
    const body = await res.text();
    logger.error(
      { campaignId: params.campaignId, leadId: params.leadId, body: body.slice(0, 300) },
      `Lemlist sendReply failed: HTTP ${res.status}`,
    );
    return { ok: false, error: `HTTP ${res.status}: ${body}` };
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      logger.error(
        { campaignId: params.campaignId, leadId: params.leadId, timeoutMs },
        "Lemlist sendReply timed out — no response within the allowed window",
      );
      return { ok: false, error: "timeout" };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Self-service settings for the signed-in client.
 *
 * Everything a client needs to connect DIM Convert to their own Lemlist account
 * used to live on the operator's client card, behind `requireOperator` — so a
 * client could be handed a dashboard they had no way to configure. These
 * routes close that gap without loosening the operator ones: rather than
 * opening PATCH /clients/:id, which would expose `plan`, `mode` and
 * `isActive`, they expose exactly two writable fields and nothing else.
 *
 * The client is always taken from the session. An operator has no client of
 * their own, so they pass ?clientId= explicitly.
 */

import { Router, type IRouter } from "express";
import { eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, clientsTable, campaignsTable, draftsTable } from "@workspace/db";
import { scopedClientId, isOperator } from "../middleware/scope";
import { limitsFor, currentPeriodStart } from "../lib/plans";
import { isRealSlackChannelId } from "../lib/slack";
import {
  generateWebhookSecret,
  getCampaigns,
  testConnection,
  isClientLemlistConfigured,
  clientLemlistApiKey,
} from "../lib/lemlist";

const router: IRouter = Router();

/**
 * Which client this request is about.
 *
 * A client user's own id, from the session — never from the request, which is
 * the whole point. An operator is not a client, so they must name one.
 */
function resolveClientId(req: import("express").Request): number | { error: string; status: number } {
  const scoped = scopedClientId(req);
  if (scoped !== null && scoped >= 0) return scoped;
  if (!isOperator(req)) return { error: "Session is not bound to a client", status: 401 };

  const raw = req.query["clientId"];
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: "An operator must name a client: ?clientId=", status: 400 };
  }
  return id;
}

/** The last four characters of a key, so the UI can show *which* key is saved. */
function keyHint(key: string | null | undefined): string | null {
  const trimmed = key?.trim();
  if (!trimmed) return null;
  return trimmed.length <= 4 ? "••••" : `••••${trimmed.slice(-4)}`;
}

function webhookUrl(
  req: import("express").Request,
  clientId: number,
  secret: string | null,
  source: "lemlist" | "meta" | "whatsapp" | "google" | "youtube" = "lemlist",
): string | null {
  if (!secret) return null;
  const configured = process.env["APP_BASE_URL"]?.trim().replace(/\/+$/, "");
  const base = configured || `${req.protocol}://${req.get("host") ?? ""}`;
  return `${base}/api/webhooks/${source}/${clientId}?secret=${encodeURIComponent(secret)}`;
}

async function buildSettings(req: import("express").Request, clientId: number) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) return null;

  const limits = limitsFor(client.plan);

  const [{ count: activeCampaigns = 0 } = {}] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.clientId, clientId), eq(campaignsTable.isActive, true)));

  const [{ count: totalCampaigns = 0 } = {}] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignsTable)
    .where(eq(campaignsTable.clientId, clientId));

  const [{ count: repliesThisMonth = 0 } = {}] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(draftsTable)
    .where(and(eq(draftsTable.clientId, clientId), gte(draftsTable.createdAt, currentPeriodStart())));

  return {
    client: {
      id: client.id,
      name: client.name,
      company: client.company,
      plan: client.plan,
    },
    lemlist: {
      // Never the key itself. It is write-only from here on: a saved key can be
      // replaced but not read back, so a session hijack cannot harvest it.
      hasApiKey: !!client.lemlistApiKey?.trim(),
      keyHint: keyHint(client.lemlistApiKey),
      usingGlobalFallback: !client.lemlistApiKey?.trim() && !!process.env["LEMLIST_API_KEY"]?.trim(),
    },
    webhook: {
      url: webhookUrl(req, client.id, client.lemlistWebhookSecret),
      hasSecret: !!client.lemlistWebhookSecret,
      headerName: "X-Webhook-Secret",
      // Same secret, one URL per lead source. Meta's subscription handshake
      // also asks for a verify token: it is this same secret.
      metaUrl: webhookUrl(req, client.id, client.lemlistWebhookSecret, "meta"),
      whatsappUrl: webhookUrl(req, client.id, client.lemlistWebhookSecret, "whatsapp"),
      // Google Ads lead forms; YouTube video campaigns use the same forms.
      googleUrl: webhookUrl(req, client.id, client.lemlistWebhookSecret, "google"),
      youtubeUrl: webhookUrl(req, client.id, client.lemlistWebhookSecret, "youtube"),
    },
    whatsapp: {
      phoneNumberId: client.whatsappPhoneNumberId,
      // Write-only, like the Lemlist key.
      hasAccessToken: !!client.whatsappAccessToken?.trim(),
      tokenHint: keyHint(client.whatsappAccessToken),
    },
    slack: {
      channel: client.slackChannel,
    },
    usage: {
      activeCampaigns,
      activeCampaignLimit: limits.activeCampaigns,
      totalCampaigns,
      repliesThisMonth,
      replyLimit: limits.repliesPerMonth,
    },
  };
}

router.get("/me/settings", async (req, res): Promise<void> => {
  const resolved = resolveClientId(req);
  if (typeof resolved !== "number") {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const settings = await buildSettings(req, resolved);
  if (!settings) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(settings);
});

/**
 * The only fields a client may change about themselves.
 *
 * Listed explicitly rather than filtered out of the body: a deny-list would
 * silently start accepting any column added to `clients` later.
 */
const MeSettingsBody = z.object({
  lemlistApiKey: z.string().trim().min(1).optional(),
  slackChannel: z.string().trim().nullable().optional(),
  // Empty string clears the value.
  whatsappPhoneNumberId: z.string().trim().regex(/^\d*$/, "The phone number ID is digits only").optional(),
  whatsappAccessToken: z.string().trim().optional(),
});

router.patch("/me/settings", async (req, res): Promise<void> => {
  const resolved = resolveClientId(req);
  if (typeof resolved !== "number") {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const parsed = MeSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.lemlistApiKey !== undefined) update["lemlistApiKey"] = parsed.data.lemlistApiKey;
  if (parsed.data.whatsappPhoneNumberId !== undefined) {
    update["whatsappPhoneNumberId"] = parsed.data.whatsappPhoneNumberId || null;
  }
  if (parsed.data.whatsappAccessToken !== undefined) {
    update["whatsappAccessToken"] = parsed.data.whatsappAccessToken || null;
  }

  if (parsed.data.slackChannel !== undefined) {
    const channel = parsed.data.slackChannel;
    // Empty means "clear it" and is stored as null — approvals then happen in
    // the dashboard only. A non-empty value has to be a real channel ID, since
    // a name like #replies silently posts nowhere.
    if (channel === null || channel === "") {
      update["slackChannel"] = null;
    } else if (!isRealSlackChannelId(channel)) {
      res.status(422).json({
        error: "That is not a Slack channel ID. Open the channel in Slack, choose View channel details, and copy the ID at the bottom — it starts with C or G.",
      });
      return;
    } else {
      update["slackChannel"] = channel;
    }
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const [client] = await db
    .update(clientsTable)
    .set(update)
    .where(eq(clientsTable.id, resolved))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  req.log?.info({ clientId: resolved, fields: Object.keys(update) }, "Client updated their own settings");

  const settings = await buildSettings(req, resolved);
  res.json(settings);
});

/** Confirms the saved key actually reaches Lemlist, before a reply depends on it. */
router.post("/me/settings/lemlist/test", async (req, res): Promise<void> => {
  const resolved = resolveClientId(req);
  if (typeof resolved !== "number") {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, resolved));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  if (!isClientLemlistConfigured(client.lemlistApiKey)) {
    res.status(400).json({ ok: false, error: "No Lemlist API key saved yet" });
    return;
  }
  try {
    const result = await testConnection({ apiKey: clientLemlistApiKey(client.lemlistApiKey) });
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/me/settings/webhook/regenerate", async (req, res): Promise<void> => {
  const resolved = resolveClientId(req);
  if (typeof resolved !== "number") {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const [client] = await db
    .update(clientsTable)
    .set({ lemlistWebhookSecret: generateWebhookSecret() })
    .where(eq(clientsTable.id, resolved))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  req.log?.warn({ clientId: resolved }, "Client regenerated their webhook secret — the previous URL no longer works");
  res.json(await buildSettings(req, resolved));
});

/**
 * The client's real Lemlist campaigns, each marked with whether DIM Convert
 * already has a mapping for it — so the Campaigns page can offer the ones that
 * are missing instead of asking anyone to copy an ID by hand.
 */
router.get("/me/lemlist/campaigns", async (req, res): Promise<void> => {
  const resolved = resolveClientId(req);
  if (typeof resolved !== "number") {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, resolved));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  if (!isClientLemlistConfigured(client.lemlistApiKey)) {
    res.status(503).json({ error: "No Lemlist API key saved yet" });
    return;
  }

  try {
    const remote = await getCampaigns({ apiKey: clientLemlistApiKey(client.lemlistApiKey) });
    const mapped = await db
      .select({ lemlistCampaignId: campaignsTable.lemlistCampaignId })
      .from(campaignsTable)
      .where(eq(campaignsTable.clientId, resolved));
    const mappedIds = new Set(mapped.map((m) => m.lemlistCampaignId));

    res.json({
      campaigns: remote.map((c) => ({
        id: String(c._id ?? ""),
        name: c.name ?? "(untitled)",
        mapped: mappedIds.has(String(c._id ?? "")),
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg === "timeout" ? 504 : 502).json({ error: msg });
  }
});

export default router;

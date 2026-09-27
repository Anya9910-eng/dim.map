import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, clientsTable, type Client } from "@workspace/db";
import { isSlackConfigured, getSlackStatus, postTestMessage } from "../lib/slack";
import {
  isLemlistConfigured,
  isWebhookSecretConfigured,
  testConnection as testLemlist,
  getCampaigns,
} from "../lib/lemlist";
import { isClaudeConfigured, testConnection as testClaude } from "../lib/claude";

import { requireOperator } from "../middleware/requireOperator";

const router: IRouter = Router();

// ─── Per-client scoping ────────────────────────────────────────────────────
// Lemlist credentials live on the client, so every Lemlist-facing endpoint here
// accepts `?clientId=` and reports that client's state. Without it these fall
// back to the global env key — which is what the old, single-client behaviour
// did for everyone.

type ClientLookup =
  | { ok: true; client: Client | null }
  | { ok: false; status: number; error: string };

async function lookupClient(raw: unknown): Promise<ClientLookup> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, client: null };
  const clientId = Number(raw);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { ok: false, status: 400, error: "clientId must be a positive integer" };
  }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) return { ok: false, status: 404, error: "Client not found" };
  return { ok: true, client };
}

// ─── n8n helpers ───────────────────────────────────────────────────────────

function getN8nWebhookUrl(): string | null {
  return process.env.N8N_WEBHOOK_URL?.trim() || null;
}

function isN8nConfigured(): boolean {
  return !!getN8nWebhookUrl();
}

async function pingN8n(): Promise<{ reachable: boolean; status?: number; error?: string }> {
  const url = getN8nWebhookUrl();
  if (!url) return { reachable: false, error: "N8N_WEBHOOK_URL not set" };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    }).catch(() =>
      // HEAD not always supported — fall back to GET with empty body
      fetch(url, { method: "GET", signal: controller.signal }),
    );
    clearTimeout(timeout);
    // n8n returns 2xx or 4xx depending on workflow state; any HTTP response means reachable
    return { reachable: true, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { reachable: false, error: msg };
  }
}

// ─── GET /integrations/status ──────────────────────────────────────────────

router.get("/integrations/status", requireOperator, async (req, res): Promise<void> => {
  const lookup = await lookupClient(req.query["clientId"]);
  if (!lookup.ok) {
    res.status(lookup.status).json({ error: lookup.error });
    return;
  }
  const client = lookup.client;
  const clientApiKey = client?.lemlistApiKey?.trim() || null;
  const globalApiKey = process.env.LEMLIST_API_KEY?.trim() || null;

  const slackStatus = getSlackStatus();
  const dbOk = !!process.env.DATABASE_URL;
  const n8nUrl = getN8nWebhookUrl();

  res.json({
    slack: {
      configured: slackStatus.configured,
      appId: slackStatus.appId,
      clientId: slackStatus.clientId,
      hasToken: !!process.env.SLACK_BOT_TOKEN,
      hasSigningSecret: !!process.env.SLACK_SIGNING_SECRET,
    },
    lemlist: {
      // Scoped to ?clientId= when given; otherwise this is the global picture.
      clientId: client?.id ?? null,
      configured: isLemlistConfigured(clientApiKey),
      hasApiKey: !!(clientApiKey ?? globalApiKey),
      hasClientApiKey: !!clientApiKey,
      hasGlobalApiKey: !!globalApiKey,
      // True when this client is riding the global fallback rather than its own key.
      usingGlobalFallback: !!client && !clientApiKey && !!globalApiKey,
      hasWebhookSecret: client ? !!client.lemlistWebhookSecret : isWebhookSecretConfigured(),
      hasGlobalWebhookSecret: isWebhookSecretConfigured(),
      webhookPath: client ? `/api/webhooks/lemlist/${client.id}` : "/api/webhooks/lemlist",
    },
    claude: {
      configured: isClaudeConfigured(),
      hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    },
    n8n: {
      configured: isN8nConfigured(),
      webhookUrl: n8nUrl,
      // The canonical endpoint n8n should POST to:
      lemlistWebhookPath: "/api/webhooks/lemlist",
    },
    database: {
      configured: dbOk,
    },
    appBaseUrl: process.env.APP_BASE_URL ?? null,
  });
});

// ─── POST /integrations/test/slack ────────────────────────────────────────

router.post("/integrations/test/slack", requireOperator, async (req, res): Promise<void> => {
  const channelId = (req.body as { channelId?: string }).channelId;
  if (!channelId) {
    res.status(400).json({ error: "channelId is required" });
    return;
  }
  const result = await postTestMessage(channelId);
  res.json(result);
});

// ─── POST /integrations/test/lemlist ──────────────────────────────────────

router.post("/integrations/test/lemlist", requireOperator, async (req, res): Promise<void> => {
  const lookup = await lookupClient(
    (req.body as { clientId?: unknown } | undefined)?.clientId ?? req.query["clientId"],
  );
  if (!lookup.ok) {
    res.status(lookup.status).json({ ok: false, error: lookup.error });
    return;
  }
  const result = await testLemlist({ apiKey: lookup.client?.lemlistApiKey });
  res.json(result);
});

// ─── POST /integrations/test/claude ───────────────────────────────────────

router.post("/integrations/test/claude", requireOperator, async (_req, res): Promise<void> => {
  const result = await testClaude();
  res.json(result);
});

// ─── POST /integrations/test/database ─────────────────────────────────────

router.post("/integrations/test/database", requireOperator, async (_req, res): Promise<void> => {
  try {
    const { db } = await import("@workspace/db");
    await db.execute("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, error: msg });
  }
});

// ─── POST /integrations/test/n8n ──────────────────────────────────────────
// Pings the configured N8N_WEBHOOK_URL to confirm the n8n instance is reachable.
// Returns { ok, reachable, status?, error? }

router.post("/integrations/test/n8n", requireOperator, async (_req, res): Promise<void> => {
  if (!isN8nConfigured()) {
    res.status(503).json({ ok: false, error: "N8N_WEBHOOK_URL is not configured" });
    return;
  }
  const result = await pingN8n();
  res.json({ ok: result.reachable, ...result });
});

// ─── GET /integrations/n8n/setup ──────────────────────────────────────────
// Returns the expected n8n workflow shape so the user can configure their workflow.

router.get("/integrations/n8n/setup", requireOperator, (_req, res): void => {
  const appBaseUrl = process.env.APP_BASE_URL ?? "https://<your-deployed-domain>";
  const lemlistWebhookUrl = `${appBaseUrl}/api/webhooks/lemlist`;

  res.json({
    overview: "Lemlist → n8n → DraftFly → Claude → Slack",
    steps: [
      {
        step: 1,
        node: "Webhook Trigger",
        description: "Add a Webhook node in n8n. Set it to receive POST requests. Copy the generated webhook URL and paste it into Lemlist → Settings → Webhooks as the 'emailReplied' event URL.",
        n8nNodeType: "n8n-nodes-base.webhook",
        method: "POST",
        yourWebhookUrl: process.env.N8N_WEBHOOK_URL ?? "Set N8N_WEBHOOK_URL in Replit Secrets",
      },
      {
        step: 2,
        node: "HTTP Request",
        description: "Add an HTTP Request node after the Webhook Trigger. Configure it to forward the Lemlist payload to DraftFly's API endpoint.",
        n8nNodeType: "n8n-nodes-base.httpRequest",
        method: "POST",
        url: lemlistWebhookUrl,
        bodyType: "json",
        body: "={{ $json.body }}",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "{{ $env.LEMLIST_WEBHOOK_SECRET }} (set this in n8n credentials or as a fixed value matching your LEMLIST_WEBHOOK_SECRET secret)",
        },
        note: "Pass the entire Lemlist payload body as-is. DraftFly reads: type, campaignId, leadId, leadEmail, leadFirstName, leadLastName, leadCompanyName, country, jobTitle, replyText",
        security: "REQUIRED for production: add the X-Webhook-Secret header with the value of LEMLIST_WEBHOOK_SECRET. Requests without a matching secret are rejected with HTTP 401.",
      },
    ],
    lemlistPayloadFields: [
      "type (should be 'emailReplied')",
      "campaignId",
      "leadId",
      "leadEmail",
      "leadFirstName",
      "leadLastName",
      "leadCompanyName",
      "country",
      "jobTitle",
      "replyText",
    ],
    afterProcessing: "DraftFly generates a Claude draft and posts a Slack approval card with Send / Edit / Discard buttons to the configured Slack channel.",
  });
});

// ─── GET /integrations/lemlist/campaigns ──────────────────────────────────

router.get("/integrations/lemlist/campaigns", requireOperator, async (req, res): Promise<void> => {
  const lookup = await lookupClient(req.query["clientId"]);
  if (!lookup.ok) {
    res.status(lookup.status).json({ error: lookup.error });
    return;
  }
  const apiKey = lookup.client?.lemlistApiKey;
  if (!isLemlistConfigured(apiKey)) {
    res.status(503).json({
      error: lookup.client
        ? "No Lemlist API key for this client, and no LEMLIST_API_KEY fallback is configured"
        : "LEMLIST_API_KEY is not configured",
    });
    return;
  }
  try {
    const campaigns = await getCampaigns({ apiKey });
    res.json({ campaigns });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;

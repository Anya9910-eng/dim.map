import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  draftsTable,
  logsTable,
  campaignsTable,
  clientsTable,
  personasTable,
  activityTable,
  type Client,
} from "@workspace/db";
import { generateDraftReply, isValidDraftText } from "../lib/claude";
import { buildDraftHistory } from "../lib/draftContext";
import { postApprovalCard, isSlackConfigured, postUnmatchedCampaignAlert, resolveClientApprovalChannel } from "../lib/slack";
import {
  isLemlistConfigured,
  requireWebhookSecret,
  requireClientWebhookSecret,
  getWebhookClient,
} from "../lib/lemlist";
import type { LemlistWebhookPayload } from "../lib/lemlist";
import { logger } from "../lib/logger";
import { limitsFor, currentPeriodStart } from "../lib/plans";
import { gte, sql } from "drizzle-orm";

const router: IRouter = Router();

// POST /webhooks/lemlist/:clientId  ← canonical path — one URL per client, each
//                                     authenticated with that client's own secret
// POST /webhooks/lemlist            ← legacy shared path, global LEMLIST_WEBHOOK_SECRET
// POST /webhooks/lemlist/reply      ← legacy alias of the above; same handler
//
// Expected n8n workflow shape:
//   1. Webhook Trigger node  — receives Lemlist "emailReplied" event at N8N_WEBHOOK_URL
//   2. HTTP Request node     — POST to <APP_BASE_URL>/api/webhooks/lemlist/<clientId>
//                              Body: pass the Lemlist payload as-is (JSON)
//                              Secret in the X-Webhook-Secret header, or as ?secret=
//                              (Lemlist itself cannot send custom headers).
//
// Lemlist payload fields used: type, campaignId, leadId, leadEmail, leadFirstName,
//   leadLastName, leadCompanyName, country, jobTitle, replyText
/**
 * Lemlist fires roughly a hundred event types, and its webhook form defaults to
 * subscribing to all of them. Only a reply is something to draft against —
 * without this, every "email sent" and "link clicked" would reach Claude and
 * post a card to the client's Slack.
 *
 * Both spellings are accepted: the API documents the plural forms, while the
 * simulate endpoint and older integrations send the singular.
 */
const REPLY_EVENT_TYPES = new Set([
  "emailsReplied",
  "emailReplied",
  "linkedinReplied",
  "linkedinReply",
  "whatsappReplied",
  "smsReplied",
]);

function isReplyEvent(type: unknown): boolean {
  return typeof type === "string" && REPLY_EVENT_TYPES.has(type);
}

async function receiveLemlistWebhook(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  const payload = req.body as LemlistWebhookPayload;
  // Set by requireClientWebhookSecret on the per-client path; absent on the
  // legacy shared path, where the client is still derived from the campaign.
  const client = getWebhookClient(res);

  req.log.info(
    {
      type: payload.type,
      campaignId: payload.campaignId,
      leadEmail: payload.leadEmail,
      clientId: client?.id ?? null,
    },
    "Lemlist webhook received",
  );

  // Respond immediately so Lemlist / n8n don't time out. 200 even for events we
  // ignore: a non-2xx would make Lemlist retry something we will never want.
  res.status(200).json({ ok: true });

  if (!isReplyEvent(payload.type)) {
    // Logged rather than dropped in silence, so a webhook subscribed to every
    // event type is visible as noise instead of looking like nothing arrived.
    req.log.info({ type: payload.type }, "Ignored — not a reply event");
    return;
  }

  // A reply from an address that is not the lead's arrives without campaignId
  // or leadId, so there is nothing to attribute it to and no persona to write
  // as. Lemlist flags these itself.
  if (payload["isThirdPartyReply"] === true) {
    req.log.info(
      { type: payload.type, leadEmail: payload.leadEmail },
      "Ignored — reply came from a third party, not the lead",
    );
    return;
  }

  // Process asynchronously
  void processLemlistReply(payload, { client }).catch((err) => {
    logger.error({ err }, "Error processing Lemlist webhook");
  });
}

router.post("/webhooks/lemlist", requireWebhookSecret, receiveLemlistWebhook);
router.post("/webhooks/lemlist/reply", requireWebhookSecret, receiveLemlistWebhook);

// POST /webhooks/lemlist/simulate — simulate a Lemlist webhook (for testing)
router.post("/webhooks/lemlist/simulate", async (req, res): Promise<void> => {
  const body = req.body as {
    campaignId?: string | number;
    leadName?: string;
    leadEmail?: string;
    leadCompany?: string;
    leadRole?: string;
    leadCountry?: string;
    replyText?: string;
  };

  const campaignId = String(body.campaignId ?? "1");
  const leadName = body.leadName ?? "Sarah Mitchell";
  const leadEmail = body.leadEmail ?? "sarah.mitchell@momentumlabs.io";

  const payload: LemlistWebhookPayload = {
    type: "emailReplied",
    campaignId,
    leadId: `lead_${Date.now()}`,
    leadEmail,
    leadFirstName: leadName.split(" ")[0],
    leadLastName: leadName.split(" ").slice(1).join(" "),
    leadCompanyName: body.leadCompany ?? "Momentum Labs",
    country: body.leadCountry ?? "US",
    jobTitle: body.leadRole ?? "VP of Sales",
    replyText: body.replyText ?? "Yes, interested. Can you send more details?",
  };

  req.log.info({ payload }, "Simulated Lemlist webhook");

  // Process synchronously so the caller gets the result
  try {
    const result = await processLemlistReply(payload);
    res.json({ ok: true, ...result, mock: !isLemlistConfigured() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Simulated webhook processing failed");
    res.status(500).json({ ok: false, error: msg });
  }
});

// Registered last so the literal `/reply` and `/simulate` paths above keep
// their own handlers — Express matches routes in registration order.
router.post("/webhooks/lemlist/:clientId", requireClientWebhookSecret, receiveLemlistWebhook);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Claude occasionally wraps its reply in a JSON object or markdown code block.
 * This function strips all wrappers and returns just the plain draft text.
 * Handles: plain JSON `{"draft":"..."}`, markdown ```json {...} ```, and raw text.
 */
function extractDraftText(raw: string): string {
  const trimmed = raw.trim();

  // Strip markdown code block: ```json {...} ``` or ``` {...} ```
  const codeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  const innerText = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;

  // Try to parse as JSON and extract the draft field
  if (innerText.startsWith("{")) {
    try {
      const parsed = JSON.parse(innerText) as Record<string, unknown>;
      for (const key of ["draft", "reply", "text", "message", "content"]) {
        if (typeof parsed[key] === "string") {
          return (parsed[key] as string).trim();
        }
      }
    } catch {
      // Not valid JSON — fall through
    }
  }

  // If we stripped a code block but couldn't parse JSON, return the inner text
  if (codeBlockMatch) return innerText;

  return raw;
}

// ─── Auto-reply / bounce detection ─────────────────────────────────────────

const AUTO_REPLY_PATTERNS = [
  /out of office/i,
  /out-of-office/i,
  /on vacation/i,
  /on leave/i,
  /automatic reply/i,
  /auto-reply/i,
  /autoreply/i,
  /automated response/i,
  /vacation response/i,
  /away from (the )?office/i,
  /currently unavailable/i,
  /MAILER-DAEMON/i,
  /delivery (status notification|failed|failure)/i,
  /undeliverable/i,
  /mail delivery (failed|subsystem)/i,
  /postmaster@/i,
  /do not reply/i,
  /noreply@/i,
  /no-reply@/i,
];

function isAutoReply(text: string, fromEmail?: string): boolean {
  if (AUTO_REPLY_PATTERNS.some((p) => p.test(text))) return true;
  if (fromEmail && AUTO_REPLY_PATTERNS.some((p) => p.test(fromEmail))) return true;
  return false;
}

/**
 * Pulls the lead fields out of a webhook body.
 *
 * The same reply reaches us shaped differently depending on the route it took:
 * Lemlist's own webhook names the company `companyName`, an n8n workflow that
 * remaps fields may send `leadCompanyName`, and a hand-built integration may
 * send plain `company`. Reading only one spelling loses the value silently —
 * no error, no log line, just an empty column and a draft written without
 * knowing where the lead works.
 *
 * Each field is therefore read through its known aliases, most specific first.
 */
function readLeadFields(payload: LemlistWebhookPayload): {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  jobTitle: string;
  country: string;
  replyText: string;
} {
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };

  return {
    firstName: pick("leadFirstName", "firstName"),
    lastName: pick("leadLastName", "lastName"),
    email: pick("leadEmail", "email"),
    company: pick("leadCompanyName", "companyName", "leadCompany", "company"),
    jobTitle: pick("jobTitle", "leadJobTitle", "title", "position"),
    country: pick("country", "leadCountry"),
    replyText: pick("replyText", "text", "message", "body"),
  };
}

/**
 * Writes a row to the client-visible log, without letting a failure there
 * take down the caller.
 *
 * This insert has already broken draft generation once in production: a
 * value that did not match the log_level enum threw, and because the "no
 * persona" call site logs and *continues* rather than returning, the
 * exception aborted the reply before a draft was ever generated — the reply
 * that would otherwise have succeeded was lost to a bug in telling the
 * operator about a warning. A logging side-channel must never carry that
 * kind of authority over the main path.
 */
async function logEvent(values: {
  clientId?: number;
  campaignId?: number;
  level: "info" | "warning" | "error";
  message: string;
  source: typeof logsTable.$inferSelect["source"];
  leadId?: string;
  metadata?: string;
}): Promise<void> {
  try {
    await db.insert(logsTable).values(values);
  } catch (err) {
    logger.error({ err, values }, "Failed to write log entry — continuing without it");
  }
}

// ─── Core processing logic ──────────────────────────────────────────────────

async function processLemlistReply(
  payload: LemlistWebhookPayload,
  opts?: {
    /** Set when the request arrived on an authenticated per-client webhook path. */
    client?: Client;
  },
): Promise<{
  draftId?: number;
  generatedDraft?: string;
  confidenceScore?: number;
  detectedIntent?: string;
  slackTs?: string | null;
}> {
  // 1. Find the campaign by its Lemlist campaign ID — and only by that.
  //    Matching a numeric payload.campaignId against campaigns.id used to be a
  //    fallback here, but a numeric Lemlist id can collide with another
  //    client's internal row id, which routes the reply to the wrong client.
  const campaignIdStr = String(payload.campaignId);
  const authenticatedClient = opts?.client;
  const whereClause = authenticatedClient
    ? and(
        eq(campaignsTable.lemlistCampaignId, campaignIdStr),
        eq(campaignsTable.clientId, authenticatedClient.id),
      )
    : eq(campaignsTable.lemlistCampaignId, campaignIdStr);
  const [campaign] = await db.select().from(campaignsTable).where(whereClause);

  if (!campaign) {
    logger.warn(
      { campaignId: payload.campaignId, clientId: authenticatedClient?.id ?? null },
      "No DraftFly campaign found for Lemlist campaign ID",
    );
    await logEvent({
      level: "warning",
      message: `Lemlist webhook: no campaign mapping found for campaign ${payload.campaignId}`,
      source: "lemlist",
      leadId: payload.leadEmail ?? payload.leadId,
      metadata: JSON.stringify(payload),
    });
    await postUnmatchedCampaignAlert({
      leadEmail: payload.leadEmail ?? payload.leadId ?? "unknown",
      campaignId: campaignIdStr,
    });
    return {};
  }

  // 2. Find client — already resolved (and authenticated) on the per-client path
  const client = authenticatedClient
    ?? (await db.select().from(clientsTable).where(eq(clientsTable.id, campaign.clientId)))[0];
  if (!client) {
    logger.warn({ clientId: campaign.clientId }, "Client not found for campaign");
    return {};
  }

  // An archived client keeps all of its data and can be switched back on, but
  // stops consuming replies: no draft is generated, nothing is posted to their
  // Slack, and no model call is billed. Logged rather than dropped silently, so
  // an archive nobody meant to leave in place is visible.
  if (!client.isActive) {
    logger.info(
      { clientId: client.id, campaignId: campaign.id, leadEmail: payload.leadEmail },
      "Reply ignored — client is archived",
    );
    await logEvent({
      clientId: client.id,
      campaignId: campaign.id,
      source: "lemlist",
      level: "info",
      message: `Reply from ${payload.leadEmail ?? "unknown"} ignored — client is archived`,
    });
    return {};
  }

  // A campaign switched off drafts nothing. This is the control a client uses
  // to stay inside their plan's active-campaign allowance: the mapping, its
  // persona and its history all stay, and flipping it back on resumes exactly
  // where it left off. Checked before the Claude call, so an inactive campaign
  // costs nothing.
  if (!campaign.isActive) {
    logger.info(
      { clientId: client.id, campaignId: campaign.id, leadEmail: payload.leadEmail },
      "Reply ignored — campaign is inactive",
    );
    await logEvent({
      clientId: client.id,
      campaignId: campaign.id,
      source: "lemlist",
      level: "info",
      message: `Reply from ${payload.leadEmail ?? "unknown"} ignored — campaign "${campaign.name}" is switched off`,
    });
    return {};
  }

  // 3. Find persona
  let persona = campaign.personaId
    ? (await db.select().from(personasTable).where(eq(personasTable.id, campaign.personaId)))[0]
    : null;

  // Without a persona the draft is generated from hardcoded fallbacks — a
  // generic SDR with no knowledge of the client's product. It still reads
  // plausibly, so the only symptom is drafts that are subtly wrong, which is
  // hard to trace back weeks later. Recorded against the client so it shows up
  // in their log rather than only in ours.
  if (!persona) {
    logger.warn(
      { clientId: client.id, campaignId: campaign.id, campaignName: campaign.name },
      "Campaign has no persona — drafting with generic fallbacks",
    );
    await logEvent({
      clientId: client.id,
      campaignId: campaign.id,
      source: "claude",
      level: "warning",
      message: `Campaign "${campaign.name}" has no persona linked — the draft was written with generic wording. Link a persona to fix.`,
    });
  }

  const lead = readLeadFields(payload);
  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "there";
  const leadEmail = lead.email;
  const replyText = lead.replyText;

  // 4. Detect auto-replies, bounces, OOO — skip draft generation for system messages
  if (isAutoReply(replyText, leadEmail)) {
    logger.info({ leadEmail, campaignId: payload.campaignId }, "Auto-reply/bounce detected — skipping draft generation");
    await db.insert(logsTable).values({
      clientId: client.id,
      campaignId: campaign.id,
      leadId: payload.leadId ?? leadEmail,
      level: "info",
      message: `Auto-reply or bounce detected from ${leadEmail} — no draft created`,
      source: "system",
      metadata: JSON.stringify({ replyText: replyText.slice(0, 200) }),
    });
    await db.insert(activityTable).values({
      type: "draft_skipped",
      description: `Auto-reply / bounce from ${leadEmail} — draft skipped (${campaign.name})`,
      clientId: client.id,
      campaignId: campaign.id,
      campaignName: campaign.name,
    });
    return {};
  }

  // 4b. Plan cap on replies. Checked here, immediately before the Claude call,
  // because that call is where the cost is actually incurred — a cap enforced
  // after generation would bill for the work it was meant to prevent.
  //
  // Over the cap the reply is not lost: it is still in the client's Lemlist
  // inbox to answer by hand. What stops is the drafting. This is logged at
  // error level rather than dropped quietly, so the reason is visible in the
  // dashboard instead of looking like the pipeline broke.
  const planLimits = limitsFor(client.plan);
  const [{ used = 0 } = {}] = await db
    .select({ used: sql<number>`count(*)::int` })
    .from(draftsTable)
    .where(and(eq(draftsTable.clientId, client.id), gte(draftsTable.createdAt, currentPeriodStart())));

  if (used >= planLimits.repliesPerMonth) {
    logger.warn(
      { clientId: client.id, plan: client.plan, used, limit: planLimits.repliesPerMonth },
      "Reply allowance reached for this month — no draft generated",
    );
    await db.insert(logsTable).values({
      clientId: client.id,
      campaignId: campaign.id,
      leadId: payload.leadId ?? leadEmail,
      level: "error",
      message: `Monthly reply allowance reached (${used}/${planLimits.repliesPerMonth} on the ${client.plan} plan). This reply was not drafted — answer it in Lemlist, or move to a larger plan.`,
      source: "system",
    });
    return {};
  }

  // 5. Generate Claude draft — with what has already been said to this lead,
  // replies this client approved untouched, and drafts they had to correct.
  const history = await buildDraftHistory({ clientId: client.id, prospectEmail: leadEmail });

  const draftResult = await generateDraftReply({
    ...history,
    leadName,
    leadEmail,
    leadCompany: lead.company,
    leadRole: lead.jobTitle || undefined,
    leadCountry: lead.country || undefined,
    incomingReply: replyText,
    personaName: persona?.name ?? "SDR",
    productDescription: persona?.productDescription ?? "AI-powered B2B reply automation",
    toneOfVoice: persona?.toneOfVoice ?? "Direct, concise, value-driven",
    commonObjections: persona?.commonObjections ?? undefined,
    cta: persona?.cta ?? "15-minute call",
    qualificationRules: persona?.qualificationRules ?? undefined,
    regionRules: campaign.regionRules ?? undefined,
    replyRules: campaign.replyRules ?? undefined,
  });

  // 5. Create draft record — validate extracted text first
  const cleanDraft = extractDraftText(draftResult.draft);

  if (!isValidDraftText(cleanDraft)) {
    logger.error(
      { rawLength: draftResult.draft.length, cleanLength: cleanDraft.trim().length, leadEmail },
      "Claude output failed draft validation — raw AI text is empty or too short to be a real reply",
    );
    const [failedDraft] = await db.insert(draftsTable).values({
      clientId: client.id,
      campaignId: campaign.id,
      prospectEmail: leadEmail,
      lemlistLeadId: payload.leadId ?? null,
      prospectName: leadName,
      prospectCompany: lead.company || null,
      prospectCountry: lead.country || null,
      prospectRole: lead.jobTitle || null,
      conversationSnippet: replyText,
      replyText: "[Draft generation failed — AI output could not be parsed as a valid reply]",
      status: "send_failed",
    }).returning();
    await db.insert(logsTable).values({
      clientId: client.id,
      campaignId: campaign.id,
      draftId: failedDraft.id,
      leadId: payload.leadId ?? leadEmail,
      level: "error",
      message: `Draft validation failed for ${leadName} (${leadEmail}) — AI returned an empty or unparseable reply (${cleanDraft.trim().length} chars after unwrapping)`,
      source: "claude",
      metadata: JSON.stringify({ rawDraft: draftResult.draft.slice(0, 500) }),
    });
    return { draftId: failedDraft.id };
  }

  const [draft] = await db.insert(draftsTable).values({
    clientId: client.id,
    campaignId: campaign.id,
    prospectEmail: leadEmail,
    // Lemlist's own id, needed to send the reply back — sendReply cannot use
    // an email address for this. Null when the payload did not carry one
    // (the simulate endpoint, for instance); that draft can still be reviewed
    // and approved, just not sent back through Lemlist automatically.
    lemlistLeadId: payload.leadId ?? null,
    prospectName: leadName,
    prospectCompany: lead.company || null,
    prospectCountry: lead.country || null,
    prospectRole: lead.jobTitle || null,
    conversationSnippet: replyText,
    replyText: cleanDraft,
    status: "pending",
    // store extra metadata in slackMessageTs field temporarily — will be overwritten
  }).returning();

  // 6. Log the event
  await db.insert(logsTable).values({
    clientId: client.id,
    campaignId: campaign.id,
    draftId: draft.id,
    leadId: payload.leadId ?? leadEmail,
    level: "info",
    message: `Lemlist reply from ${leadName} (${leadEmail}) — draft generated (confidence: ${Math.round(draftResult.confidenceScore * 100)}%)`,
    source: "lemlist",
    generatedDraft: cleanDraft,
    metadata: JSON.stringify({
      detectedIntent: draftResult.detectedIntent,
      suggestedNextAction: draftResult.suggestedNextAction,
      confidenceScore: draftResult.confidenceScore,
    }),
  });

  // 7. Log Claude event
  await db.insert(logsTable).values({
    clientId: client.id,
    campaignId: campaign.id,
    draftId: draft.id,
    leadId: payload.leadId ?? leadEmail,
    level: "info",
    message: `Claude draft generated — intent: ${draftResult.detectedIntent}, confidence: ${Math.round(draftResult.confidenceScore * 100)}%, next: ${draftResult.suggestedNextAction}`,
    source: "claude",
    generatedDraft: cleanDraft,
    metadata: JSON.stringify({}),
  });

  // Keep the campaign's reply tally in step with the drafts it produced.
  // campaigns.reply_count existed, was rendered on the Campaigns page, and was
  // never written by anything — so every campaign displayed 0 no matter how
  // many replies it had handled. Incremented in SQL rather than read-modify-
  // write, so concurrent replies cannot lose a count.
  await db
    .update(campaignsTable)
    .set({ replyCount: sql`${campaignsTable.replyCount} + 1` })
    .where(eq(campaignsTable.id, campaign.id));

  // 8. Activity feed
  await db.insert(activityTable).values({
    type: "draft_created",
    description: `Claude generated reply for ${leadName} (${leadEmail}) — ${campaign.name}`,
    clientId: client.id,
    campaignId: campaign.id,
    draftId: draft.id,
    campaignName: campaign.name,
  });

  // 9. Post Slack approval card
  // This client's own channel, or nothing. See resolveClientApprovalChannel:
  // the old global fallback sent every channel-less client's replies to one
  // shared channel.
  const approvalChannel = resolveClientApprovalChannel(client.slackChannel);
  let slackTs: string | null = null;

  // Use per-client token only if it looks like a real Slack token; fall back to global env var
  const isRealToken = (t: string | null | undefined) =>
    !!t && t.startsWith("xoxb-") && !t.includes("placeholder");
  const effectiveBotToken = isRealToken(client.slackBotToken)
    ? (client.slackBotToken ?? undefined)
    : undefined;

  // No channel anywhere is a normal configuration, not a failure: the client
  // approves in the dashboard. Attempting the post regardless would throw on
  // every single reply and write an error log for something working as
  // intended. The draft already exists either way.
  if (!approvalChannel) {
    logger.info(
      { draftId: draft.id, clientId: client.id },
      "No Slack channel for this client — draft awaits approval in the dashboard",
    );
    return {
      draftId: draft.id,
      generatedDraft: cleanDraft,
      confidenceScore: draftResult.confidenceScore,
      detectedIntent: draftResult.detectedIntent,
      slackTs: null,
    };
  }

  try {
    slackTs = await postApprovalCard({
      channelId: approvalChannel,
      botToken: effectiveBotToken,
      draftId: draft.id,
      leadName,
      leadCompany: lead.company,
      leadEmail,
      incomingReply: replyText,
      generatedDraft: cleanDraft,
      campaignName: campaign.name,
      personaName: persona?.name ?? "SDR",
      region: lead.country || "US",
      confidenceScore: draftResult.confidenceScore,
    });

    if (slackTs) {
      await db.update(draftsTable)
        .set({ slackMessageTs: `${approvalChannel}|${slackTs}` })
        .where(eq(draftsTable.id, draft.id));
    }

    await db.insert(logsTable).values({
      clientId: client.id,
      campaignId: campaign.id,
      draftId: draft.id,
      leadId: payload.leadId ?? leadEmail,
      level: "info",
      message: `Slack approval card posted to ${approvalChannel}${isSlackConfigured() ? "" : " (mock)"}`,
      source: "slack",
      metadata: JSON.stringify({ ts: slackTs, mock: !isSlackConfigured() }),
    });
  } catch (err) {
    logger.error({ err }, "Failed to post Slack approval card");
    await db.insert(logsTable).values({
      clientId: client.id,
      campaignId: campaign.id,
      draftId: draft.id,
      level: "error",
      message: `Failed to post Slack approval card: ${err instanceof Error ? err.message : String(err)}`,
      source: "slack",
    });
  }

  logger.info(
    { draftId: draft.id, slackTs, confidence: draftResult.confidenceScore },
    "Lemlist reply processed successfully",
  );

  return {
    draftId: draft.id,
    generatedDraft: cleanDraft,
    confidenceScore: draftResult.confidenceScore,
    detectedIntent: draftResult.detectedIntent,
    slackTs,
  };
}

export default router;

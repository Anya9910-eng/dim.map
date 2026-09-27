import crypto from "crypto";
import { WebClient, type KnownBlock } from "@slack/web-api";
import { logger } from "./logger";

// ─── Configuration ─────────────────────────────────────────────────────────

export function isSlackConfigured(): boolean {
  return !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET);
}

export function getSlackStatus(): { configured: boolean; appId: string | null; clientId: string | null } {
  return {
    configured: isSlackConfigured(),
    appId: process.env.SLACK_APP_ID ?? null,
    clientId: process.env.SLACK_CLIENT_ID ?? null,
  };
}

function getClient(botToken?: string): WebClient {
  const token = botToken ?? process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not configured. Add it to Replit Secrets to enable Slack integration.");
  return new WebClient(token);
}

// ─── Signature verification ────────────────────────────────────────────────

export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string,
): boolean {
  const fiveMinutes = 5 * 60;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > fiveMinutes) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", signingSecret);
  hmac.update(baseString);
  const computed = `v0=${hmac.digest("hex")}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function verifyIncomingRequest(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    logger.warn("SLACK_SIGNING_SECRET not set — rejecting request");
    return false;
  }
  const timestamp = String(headers["x-slack-request-timestamp"] ?? "");
  const signature = String(headers["x-slack-signature"] ?? "");
  return verifySlackSignature(secret, rawBody, timestamp, signature);
}

// ─── Approval routing ──────────────────────────────────────────────────────

/** A real Slack channel id, as opposed to a #name, a placeholder or "". */
export function isRealSlackChannelId(value: string | null | undefined): boolean {
  return !!value && /^[CG][A-Z0-9]{9,}/.test(value);
}

/**
 * The channel a client's approval cards belong in, or null when that client
 * approves in the dashboard only.
 *
 * Deliberately does **not** fall back to the global SLACK_CHANNEL_ID. That
 * fallback is left over from when there was one customer and one channel. With
 * several clients it quietly routed every channel-less client's prospect
 * names, email addresses and draft text into a single shared channel — the
 * dashboard was scoped per client the whole time, and Slack was not.
 *
 * A client whose channel is blank or a placeholder therefore gets no card,
 * which is exactly what the Clients form now promises when you leave it empty.
 * The global channel is still used for operator-level alerts that belong to no
 * client, such as a reply on an unrecognised campaign.
 */
export function resolveClientApprovalChannel(
  slackChannel: string | null | undefined,
): string | null {
  return isRealSlackChannelId(slackChannel) ? (slackChannel as string) : null;
}

// ─── Message posting ───────────────────────────────────────────────────────

export interface ApprovalCardParams {
  channelId: string;
  botToken?: string;
  draftId: number;
  leadName: string;
  leadCompany: string;
  leadEmail: string;
  incomingReply: string;
  generatedDraft: string;
  campaignName: string;
  personaName: string;
  region: string;
  confidenceScore?: number;
}

export async function postApprovalCard(params: ApprovalCardParams): Promise<string | null> {
  if (!isSlackConfigured() && !params.botToken) {
    throw new Error("Slack is not configured. Add SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET to Replit Secrets.");
  }

  const client = getClient(params.botToken);
  const confidenceLine = params.confidenceScore != null
    ? ` · Confidence: ${Math.round(params.confidenceScore * 100)}%`
    : "";

  const result = await client.chat.postMessage({
    channel: params.channelId,
    text: `New reply from ${params.leadName} — approval required`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*New reply from ${params.leadName}* — ${params.leadCompany}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `> _"${params.incomingReply}"_`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Claude Draft:*\n${params.generatedDraft}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `#${params.campaignName} · Persona: ${params.personaName} · ${params.region}${confidenceLine}`,
          },
        ],
      },
      { type: "divider" },
      {
        type: "actions",
        block_id: `draft_${params.draftId}`,
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "✅ Send Reply" },
            style: "primary",
            action_id: "draft_send",
            value: String(params.draftId),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "✏️ Edit Reply" },
            action_id: "draft_edit",
            value: String(params.draftId),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "🗑️ Discard" },
            style: "danger",
            action_id: "draft_discard",
            value: String(params.draftId),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "🚨 Escalate" },
            action_id: "draft_escalate",
            value: String(params.draftId),
          },
        ],
      },
    ],
  });
  return result.ts ?? null;
}

export async function postUnmatchedCampaignAlert(params: {
  leadEmail: string;
  campaignId: string;
}): Promise<void> {
  const rawChannelEnv = process.env.SLACK_CHANNEL_ID ?? "";
  const channelIdMatch = rawChannelEnv.match(/\b[CG][A-Z0-9]{9,11}\b/);
  const channelId = channelIdMatch ? channelIdMatch[0] : null;

  if (!channelId) {
    logger.warn(
      { campaignId: params.campaignId },
      "Unmatched Lemlist campaign — no SLACK_CHANNEL_ID configured, cannot send alert",
    );
    return;
  }

  if (!isSlackConfigured()) {
    logger.warn(
      { campaignId: params.campaignId, channelId },
      "Unmatched Lemlist campaign — Slack not configured, skipping alert",
    );
    return;
  }

  try {
    const client = getClient();
    await client.chat.postMessage({
      channel: channelId,
      text: `⚠️ Received reply from ${params.leadEmail} for unknown campaign \`${params.campaignId}\` — add it in DIM map to enable auto-drafting`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `⚠️ *Unmatched Lemlist campaign*\n\nReceived a reply from *${params.leadEmail}* for campaign ID \`${params.campaignId}\`, but no matching campaign was found in DIM map.\n\nAdd the campaign in DIM map and map it to this Lemlist campaign ID to enable auto-drafting.`,
          },
        },
      ],
    });
  } catch (err) {
    logger.error({ err, campaignId: params.campaignId }, "Failed to post unmatched campaign Slack alert");
  }
}

export async function postTestMessage(channelId: string, botToken?: string): Promise<{ ok: boolean; ts?: string; error?: string }> {
  if (!isSlackConfigured() && !botToken) {
    return { ok: false, error: "SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are not configured" };
  }

  try {
    const client = getClient(botToken);
    const result = await client.chat.postMessage({
      channel: channelId,
      text: "✅ DIM map test message — Slack connection verified.",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*DIM map* — test connection successful.\nYour approval channel is correctly configured.",
          },
        },
      ],
    });
    return { ok: true, ts: result.ts };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Slack test message failed");
    return { ok: false, error: msg };
  }
}

// ─── Channel binding: workspace + channel discovery ─────────────────────────

export interface SlackWorkspaceStatus {
  connected: boolean;
  teamName: string | null;
  teamId: string | null;
  url: string | null;
  botUserId: string | null;
  error: string | null;
}

/** OAuth/connection status via auth.test — used by the Slack Binding settings page. */
export async function getWorkspaceStatus(botToken?: string): Promise<SlackWorkspaceStatus> {
  const empty = { connected: false, teamName: null, teamId: null, url: null, botUserId: null };
  if (!isSlackConfigured() && !botToken) {
    return { ...empty, error: "SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are not configured" };
  }
  try {
    const client = getClient(botToken);
    const res = await client.auth.test();
    return {
      connected: true,
      teamName: (res.team as string | undefined) ?? null,
      teamId: (res.team_id as string | undefined) ?? null,
      url: (res.url as string | undefined) ?? null,
      botUserId: (res.user_id as string | undefined) ?? null,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "Slack auth.test failed");
    return { ...empty, error: msg };
  }
}

export interface SlackChannelSummary {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  isArchived: boolean;
}

/**
 * List channels the bot can see, so an operator can pick one by NAME instead of
 * pasting a Channel ID. Requires the bot scopes `channels:read` (+ `groups:read`
 * for private channels). Paginated; bot-member channels are sorted first.
 */
export async function listChannels(botToken?: string): Promise<SlackChannelSummary[]> {
  const client = getClient(botToken); // throws a clear error if no token is configured
  const channels: SlackChannelSummary[] = [];
  let cursor: string | undefined;
  // Cap pages defensively so a huge workspace can't spin forever.
  for (let page = 0; page < 20; page++) {
    const res = await client.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: false,
      limit: 200,
      cursor,
    });
    for (const c of res.channels ?? []) {
      channels.push({
        id: (c.id as string | undefined) ?? "",
        name: (c.name as string | undefined) ?? "",
        isPrivate: !!c.is_private,
        isMember: !!c.is_member,
        isArchived: !!c.is_archived,
      });
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  channels.sort((a, b) =>
    a.isMember === b.isMember ? a.name.localeCompare(b.name) : a.isMember ? -1 : 1,
  );
  return channels;
}

export interface SlackAccessCheckResult {
  ok: boolean;
  isMember: boolean;
  name: string | null;
  error: string | null;
}

/**
 * Verify the bot can actually post to a channel BEFORE saving a binding. This is
 * the guard against binding a channel in another workspace or one the bot isn't
 * in: `conversations.info` only resolves channels in the bot's own workspace, and
 * we require the bot to be a member (otherwise `chat.postMessage` would fail).
 */
export async function verifyBotAccess(channelId: string, botToken?: string): Promise<SlackAccessCheckResult> {
  if (!isSlackConfigured() && !botToken) {
    return { ok: false, isMember: false, name: null, error: "Slack is not configured" };
  }
  try {
    const client = getClient(botToken);
    const res = await client.conversations.info({ channel: channelId });
    const ch = res.channel as { name?: string; is_member?: boolean; is_archived?: boolean } | undefined;
    if (!ch) return { ok: false, isMember: false, name: null, error: "Channel not found in this workspace" };
    if (ch.is_archived) {
      return { ok: false, isMember: !!ch.is_member, name: ch.name ?? null, error: "Channel is archived" };
    }
    return {
      ok: !!ch.is_member,
      isMember: !!ch.is_member,
      name: ch.name ?? null,
      error: ch.is_member ? null : "Bot is not a member of this channel — invite it first",
    };
  } catch (err) {
    // Slack returns `channel_not_found` when the ID isn't in the bot's workspace.
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, isMember: false, name: null, error: msg };
  }
}

/**
 * Post a TEST-marked approval card with Send/Edit/Discard buttons. The actions
 * block carries block_id `draft_test` and value `test`, which the interactions
 * handler recognises and short-circuits — it never touches the DB or Lemlist, so
 * clicking the buttons sends no real email.
 */
export async function postTestApprovalCard(
  channelId: string,
  botToken?: string,
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  if (!isSlackConfigured() && !botToken) {
    return { ok: false, error: "SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are not configured" };
  }
  try {
    const client = getClient(botToken);
    const result = await client.chat.postMessage({
      channel: channelId,
      text: "🧪 TEST — DIM map approval card (no real reply will be sent)",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🧪 *TEST approval card* — DIM map channel-binding check. These buttons are safe: clicking them sends *no* email and changes *no* draft.",
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "*New reply from Jane Tester* — Example Co" },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: '> _"Looks interesting — can you send over pricing?"_' },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Claude Draft:*\nHi Jane, thanks for getting back to me! Happy to share pricing — do you have 10 minutes on Tuesday to walk through it?",
          },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: "#test-campaign · Persona: SDR · US · TEST" }],
        },
        { type: "divider" },
        {
          type: "actions",
          block_id: "draft_test",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "✅ Send Reply" },
              style: "primary",
              action_id: "draft_send",
              value: "test",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "✏️ Edit Reply" },
              action_id: "draft_edit",
              value: "test",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "🗑️ Discard" },
              style: "danger",
              action_id: "draft_discard",
              value: "test",
            },
          ],
        },
      ],
    });
    return { ok: true, ts: result.ts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Slack test approval card failed");
    return { ok: false, error: msg };
  }
}

/** Update a TEST card in place after one of its buttons is clicked (no side effects). */
export async function updateTestCardAfterAction(
  channelId: string,
  ts: string,
  label: string,
  operatorId?: string,
  botToken?: string,
): Promise<void> {
  if (!isSlackConfigured() && !botToken) return;
  const by = operatorId ? ` by <@${operatorId}>` : "";
  const client = getClient(botToken);
  await client.chat.update({
    channel: channelId,
    ts,
    text: `🧪 TEST card — ${label} clicked`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🧪 *TEST card* — *${label}* clicked${by}. No email was sent and no draft was changed. ✅ Channel binding works.`,
        },
      },
    ],
  });
}

export async function openEditModal(params: {
  triggerId: string;
  draftId: number;
  currentText: string;
  botToken?: string;
}): Promise<void> {
  if (!isSlackConfigured() && !params.botToken) {
    logger.warn({ draftId: params.draftId }, "openEditModal: Slack not configured, cannot open modal");
    return;
  }

  const client = getClient(params.botToken);
  await client.views.open({
    trigger_id: params.triggerId,
    view: {
      type: "modal",
      callback_id: "draft_edit_modal",
      private_metadata: String(params.draftId),
      title: { type: "plain_text", text: "Edit Reply" },
      submit: { type: "plain_text", text: "Send" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "reply_text_block",
          label: { type: "plain_text", text: "Reply text" },
          element: {
            type: "plain_text_input",
            action_id: "reply_text",
            multiline: true,
            initial_value: params.currentText,
          },
        },
      ],
    },
  });
}

export async function postEphemeral(params: {
  channelId: string;
  userId: string;
  text: string;
  botToken?: string;
}): Promise<void> {
  if (!isSlackConfigured() && !params.botToken) {
    logger.warn("postEphemeral: Slack not configured, cannot post ephemeral message");
    return;
  }
  try {
    const client = getClient(params.botToken);
    await client.chat.postEphemeral({
      channel: params.channelId,
      user: params.userId,
      text: params.text,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to post ephemeral Slack message");
  }
}

export async function postEscalationAlert(params: {
  channelId: string;
  botToken?: string;
  draftId: number;
  leadName: string;
  leadEmail: string;
  campaignName: string;
  operatorName?: string;
}): Promise<void> {
  if (!isSlackConfigured() && !params.botToken) return;
  try {
    const client = getClient(params.botToken);
    const byLine = params.operatorName ? ` by ${params.operatorName}` : "";
    await client.chat.postMessage({
      channel: params.channelId,
      text: `🚨 Draft escalated${byLine} — manual review required`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🚨 *Draft escalated${byLine}*\n\n*Lead:* ${params.leadName} (${params.leadEmail})\n*Campaign:* ${params.campaignName}\n*Draft ID:* #${params.draftId}\n\nThis draft requires manual review before any reply is sent. No automated action will be taken.`,
          },
        },
      ],
    });
  } catch (err) {
    logger.warn({ err }, "Failed to post escalation alert");
  }
}

export async function postFallbackFailureNotification(params: {
  userId: string;
  channelId?: string;
  botToken?: string;
  draftId: number;
  lemlistError?: string;
  cardUpdateError?: string;
  prospectName?: string;
  prospectEmail?: string;
}): Promise<void> {
  if (!isSlackConfigured() && !params.botToken) {
    logger.warn(
      { draftId: params.draftId },
      "postFallbackFailureNotification: Slack not configured, cannot send fallback DM",
    );
    return;
  }

  const leadInfo = params.prospectName
    ? `${params.prospectName}${params.prospectEmail ? ` (${params.prospectEmail})` : ""}`
    : (params.prospectEmail ?? "unknown lead");

  const lines: string[] = [
    `⚠️ *Send failed for draft #${params.draftId}*`,
    `*Lead:* ${leadInfo}`,
  ];
  if (params.lemlistError) lines.push(`*Lemlist error:* ${params.lemlistError}`);
  lines.push(
    `The Slack card could not be updated automatically${params.cardUpdateError ? `: ${params.cardUpdateError}` : "."}`,
    "Please check DIM map to retry or review the draft.",
  );
  const bodyText = lines.join("\n");

  const client = getClient(params.botToken);

  // Try DM first (in Slack, posting to a user ID opens a DM).
  // If that fails, fall back to the original channel so the alert always lands somewhere.
  const targets = [params.userId, params.channelId].filter(Boolean) as string[];
  for (const target of targets) {
    try {
      await client.chat.postMessage({
        channel: target,
        text: `⚠️ Send failed for draft #${params.draftId} — Slack card update also failed. Check DIM map to retry.`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: bodyText },
          },
        ],
      });
      return;
    } catch (err) {
      logger.warn(
        { err, target, draftId: params.draftId },
        "postFallbackFailureNotification: failed to post to target",
      );
    }
  }
}

export async function updateMessageAfterAction(
  channelId: string,
  ts: string,
  action: "sent" | "edited" | "discarded" | "send_failed" | "escalated",
  operatorName?: string,
  botToken?: string,
  errorDetail?: string,
  finalReplyText?: string,
): Promise<void> {
  if (!isSlackConfigured() && !botToken) return;

  const labels: Record<string, string> = {
    sent: "✅ Reply sent",
    edited: "✏️ Reply edited and sent",
    discarded: "🗑️ Draft discarded",
    send_failed: "❌ Send failed — reply was not delivered",
    escalated: "🚨 Escalated — manual review required",
  };

  const byLine = operatorName ? ` by ${operatorName}` : "";
  const text = `${labels[action]}${byLine}`;
  const statusLine = action === "send_failed"
    ? `${labels[action]}${byLine}. ${errorDetail ? `Error: ${errorDetail}. ` : ""}The draft is still pending — retry from DIM map.`
    : `${labels[action]}${byLine}. No further action needed.`;

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: statusLine },
    },
  ];

  // For edited/sent actions, append the final reply text so reviewers can see
  // exactly what was sent.
  if (finalReplyText && (action === "edited" || action === "sent")) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Sent reply:*\n${finalReplyText}` },
    });
  }

  const client = getClient(botToken);
  await client.chat.update({
    channel: channelId,
    ts,
    text,
    blocks,
  });
}

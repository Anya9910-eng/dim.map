import { WebClient } from "@slack/web-api";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, draftsTable, activityTable, clientsTable, campaignsTable } from "@workspace/db";
import { logger } from "./logger";
import { isSlackConfigured, updateMessageAfterAction } from "./slack";

// ─── Configuration ──────────────────────────────────────────────────────────

// Drafts whose Slack approval card was posted successfully but nobody acted:
// default 24 hours. Override with STALE_DRAFT_THRESHOLD_MINUTES.
const DEFAULT_THRESHOLD_MINUTES = 1440;

// Drafts where the Slack card never posted (slackMessageTs is null):
// auto-fail after this shorter window. Override with STALE_ORPHAN_THRESHOLD_MINUTES.
const DEFAULT_ORPHAN_THRESHOLD_MINUTES = 60;

function getThresholdMinutes(): number {
  const raw = process.env.STALE_DRAFT_THRESHOLD_MINUTES;
  if (!raw) return DEFAULT_THRESHOLD_MINUTES;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    logger.warn({ raw }, "staleDraftSweeper: invalid STALE_DRAFT_THRESHOLD_MINUTES — using default 1440");
    return DEFAULT_THRESHOLD_MINUTES;
  }
  return parsed;
}

function getOrphanThresholdMinutes(): number {
  const raw = process.env.STALE_ORPHAN_THRESHOLD_MINUTES;
  if (!raw) return DEFAULT_ORPHAN_THRESHOLD_MINUTES;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    logger.warn({ raw }, "staleDraftSweeper: invalid STALE_ORPHAN_THRESHOLD_MINUTES — using default 60");
    return DEFAULT_ORPHAN_THRESHOLD_MINUTES;
  }
  return parsed;
}

// ─── Core sweep ─────────────────────────────────────────────────────────────

export async function sweepStaleDrafts(): Promise<void> {
  const thresholdMinutes = getThresholdMinutes();
  const orphanThresholdMinutes = getOrphanThresholdMinutes();
  const postedCutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  const orphanCutoff = new Date(Date.now() - orphanThresholdMinutes * 60 * 1000);

  // Two tiers:
  // 1. Posted: Slack card was sent (slackMessageTs set) — use long threshold (default 24h)
  // 2. Orphaned: Slack card never posted (slackMessageTs null) — use short threshold (default 60m)
  const staleDrafts = await db
    .select({
      id: draftsTable.id,
      clientId: draftsTable.clientId,
      campaignId: draftsTable.campaignId,
      prospectEmail: draftsTable.prospectEmail,
      prospectName: draftsTable.prospectName,
      slackMessageTs: draftsTable.slackMessageTs,
      sweeperAlertedAt: draftsTable.sweeperAlertedAt,
      createdAt: draftsTable.createdAt,
    })
    .from(draftsTable)
    .where(
      and(
        eq(draftsTable.status, "pending"),
        or(
          and(isNotNull(draftsTable.slackMessageTs), lt(draftsTable.createdAt, postedCutoff)),
          and(isNull(draftsTable.slackMessageTs),    lt(draftsTable.createdAt, orphanCutoff)),
        ),
      ),
    );

  if (staleDrafts.length === 0) {
    logger.debug({ thresholdMinutes, orphanThresholdMinutes }, "staleDraftSweeper: no stale drafts found");
    return;
  }

  logger.warn(
    { count: staleDrafts.length, thresholdMinutes, orphanThresholdMinutes },
    "staleDraftSweeper: found stale pending drafts",
  );

  for (const draft of staleDrafts) {
    try {
      // Fetch client and campaign for display names and per-client bot token
      const [client] = await db
        .select()
        .from(clientsTable)
        .where(eq(clientsTable.id, draft.clientId));
      const [campaign] = await db
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, draft.campaignId));

      const ageMinutes = Math.round((Date.now() - draft.createdAt.getTime()) / 60_000);

      // Move to send_failed — use a conditional update so a concurrent action
      // that raced us to a terminal state is not overwritten.
      // sweeperAlertedAt is set here (not just in the Slack-alert block below) so
      // the UI can always distinguish a sweeper auto-fail from a manual send failure.
      const updated = await db
        .update(draftsTable)
        .set({ status: "send_failed", actionedAt: new Date(), sweeperAlertedAt: new Date() })
        .where(and(eq(draftsTable.id, draft.id), eq(draftsTable.status, "pending")))
        .returning({ id: draftsTable.id });

      if (updated.length === 0) {
        // Another process already moved the draft — skip notifications.
        logger.info({ draftId: draft.id }, "staleDraftSweeper: draft already actioned by another process, skipping");
        continue;
      }

      logger.warn(
        { draftId: draft.id, ageMinutes },
        "staleDraftSweeper: moved stale draft to send_failed",
      );

      // Write an activity feed entry
      await db.insert(activityTable).values({
        type: "draft_send_failed",
        description: `Draft #${draft.id} was pending for ${ageMinutes} minutes (threshold: ${thresholdMinutes} min) and was automatically moved to send_failed.`,
        clientId: draft.clientId,
        campaignId: draft.campaignId,
        clientName: client?.name ?? undefined,
        campaignName: campaign?.name ?? undefined,
        draftId: draft.id,
      });

      // Update the Slack approval card so operators see it timed out
      if (draft.slackMessageTs) {
        const [channelId, ts] = draft.slackMessageTs.split("|");
        const botToken = client?.slackBotToken ?? undefined;

        if (channelId && ts) {
          try {
            await updateMessageAfterAction(
              channelId,
              ts,
              "send_failed",
              "auto-sweep",
              botToken,
              `Draft was pending for ${ageMinutes} minutes (threshold: ${thresholdMinutes} min)`,
            );
          } catch (err) {
            logger.warn({ err, draftId: draft.id }, "staleDraftSweeper: failed to update Slack approval card");
          }
        }
      }

      // Post a summary alert to the optional admin channel.
      // Dedup: if we already alerted for this draft in a previous sweep cycle,
      // skip posting again to prevent alert fatigue.
      const alertChannel = process.env.SLACK_ALERT_CHANNEL;
      if (alertChannel && isSlackConfigured()) {
        if (draft.sweeperAlertedAt) {
          logger.debug(
            { draftId: draft.id, sweeperAlertedAt: draft.sweeperAlertedAt },
            "staleDraftSweeper: skipping duplicate Slack alert (already alerted)",
          );
        } else {
          const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
          try {
            await slackClient.chat.postMessage({
              channel: alertChannel,
              text: `⚠️ Stale draft auto-failed: #${draft.id} (${draft.prospectName} / ${draft.prospectEmail})`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: [
                      `⚠️ *Stale draft automatically moved to \`send_failed\`*`,
                      `*Draft:* #${draft.id}`,
                      `*Lead:* ${draft.prospectName} (${draft.prospectEmail})`,
                      `*Client:* ${client?.name ?? String(draft.clientId)}`,
                      `*Campaign:* ${campaign?.name ?? String(draft.campaignId)}`,
                      `*Age:* ${ageMinutes} minutes (threshold: ${thresholdMinutes} min)`,
                      ``,
                      `Please review and retry in DraftFly.`,
                    ].join("\n"),
                  },
                },
              ],
            });

            // sweeperAlertedAt is already set above; this is a no-op but kept for clarity.
            // (Previously this was the only place it was stamped; it now serves as a
            //  dedup guard for the Slack alert specifically, not for the auto-fail detection.)
          } catch (err) {
            logger.warn({ err, draftId: draft.id }, "staleDraftSweeper: failed to post alert to SLACK_ALERT_CHANNEL");
          }
        }
      }
    } catch (err) {
      logger.error({ err, draftId: draft.id }, "staleDraftSweeper: error processing stale draft");
    }
  }
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

/**
 * Starts a recurring sweep that checks for stale pending drafts.
 *
 * Two-tier thresholds:
 *   - Posted drafts (slackMessageTs set): Slack card was sent; operators have
 *     time to act. Default: 1440 min (24 h). Override: STALE_DRAFT_THRESHOLD_MINUTES.
 *   - Orphaned drafts (slackMessageTs null): Slack card never posted; cleaned up
 *     sooner. Default: 60 min. Override: STALE_ORPHAN_THRESHOLD_MINUTES.
 *
 * The sweep runs every 5 minutes (or every min(orphanThreshold, 5) minutes).
 *
 * Environment variables:
 *   STALE_DRAFT_THRESHOLD_MINUTES   — posted-draft auto-fail window (default: 1440)
 *   STALE_ORPHAN_THRESHOLD_MINUTES  — orphaned-draft auto-fail window (default: 60)
 *   SLACK_ALERT_CHANNEL             — optional Slack channel for per-draft alerts
 */
export function startStaleDraftSweeper(): NodeJS.Timeout {
  const orphanThresholdMinutes = getOrphanThresholdMinutes();
  const intervalMs = Math.min(orphanThresholdMinutes, 5) * 60_000;

  logger.info(
    { thresholdMinutes: getThresholdMinutes(), orphanThresholdMinutes, intervalMs },
    "staleDraftSweeper: starting",
  );

  // Run one pass immediately on startup to catch any pre-existing stale drafts
  void sweepStaleDrafts().catch((err) => {
    logger.error({ err }, "staleDraftSweeper: initial sweep failed");
  });

  return setInterval(() => {
    void sweepStaleDrafts().catch((err) => {
      logger.error({ err }, "staleDraftSweeper: sweep failed");
    });
  }, intervalMs);
}

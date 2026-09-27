import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, draftsTable, campaignsTable, clientsTable, personasTable, activityTable } from "@workspace/db";
import { postApprovalCard, isSlackConfigured, updateMessageAfterAction, resolveClientApprovalChannel } from "../lib/slack";
import { sendApprovedReply, unsendableReason, channelLabel } from "../lib/leadChannels";
import { logger } from "../lib/logger";
import {
  ListDraftsQueryParams,
  ListDraftsResponse,
  ListPendingDraftsResponse,
  GetDraftParams,
  GetDraftResponse,
  ApplyDraftActionParams,
  ApplyDraftActionBody,
  ApplyDraftActionResponse,
} from "@workspace/api-zod";
import { clientScope, canAccessClient, denyNotFound } from "../middleware/scope";

const router: IRouter = Router();

router.get("/drafts/pending", async (req, res): Promise<void> => {
  const drafts = await db
    .select()
    .from(draftsTable)
    .where(and(eq(draftsTable.status, "pending"), clientScope(req, draftsTable.clientId)))
    .orderBy(draftsTable.createdAt);
  res.json(ListPendingDraftsResponse.parse(drafts));
});

router.get("/drafts", async (req, res): Promise<void> => {
  const query = ListDraftsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  // The caller's own scope is appended last and never removed, so a client
  // user passing ?clientId=<someone else> still only matches their own rows.
  const conditions = [clientScope(req, draftsTable.clientId)];
  if (query.data.status) conditions.push(eq(draftsTable.status, query.data.status as "pending" | "sent" | "edited" | "discarded"));
  if (query.data.clientId != null) conditions.push(eq(draftsTable.clientId, query.data.clientId));
  if (query.data.campaignId != null) conditions.push(eq(draftsTable.campaignId, query.data.campaignId));

  const drafts = await db
    .select()
    .from(draftsTable)
    .where(and(...conditions))
    .orderBy(draftsTable.createdAt);

  res.json(ListDraftsResponse.parse(drafts));
});

router.get("/drafts/:id", async (req, res): Promise<void> => {
  const params = GetDraftParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [draft] = await db.select().from(draftsTable).where(eq(draftsTable.id, params.data.id));
  if (!draft || !canAccessClient(req, draft.clientId)) {
    denyNotFound(res, "Draft");
    return;
  }
  res.json(GetDraftResponse.parse(draft));
});

router.patch("/drafts/:id/action", async (req, res): Promise<void> => {
  const params = ApplyDraftActionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ApplyDraftActionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { action, editedText } = body.data;
  const newStatus = action === "send" ? "sent" : action === "edit" ? "edited" : "discarded";

  // Fetch the current draft so we can detect a send_failed → success retry
  const [existingDraft] = await db
    .select()
    .from(draftsTable)
    .where(eq(draftsTable.id, params.data.id));

  if (!existingDraft || !canAccessClient(req, existingDraft.clientId)) {
    denyNotFound(res, "Draft");
    return;
  }

  // The Slack action handler already ignores a click on a draft that is no
  // longer pending, so a stale Slack card cannot cause a double send even
  // though this route does not update that card's text.
  if (existingDraft.status !== "pending" && existingDraft.status !== "send_failed") {
    res.status(409).json({ error: `Draft is already ${existingDraft.status}` });
    return;
  }

  const isRetryFromFailure = existingDraft.status === "send_failed";

  // If retrying a previously-failed draft, remove the stale draft_send_failed activity
  // entry before inserting the success entry so the feed shows exactly one row per draft.
  if (isRetryFromFailure) {
    await db
      .delete(activityTable)
      .where(and(eq(activityTable.draftId, params.data.id), eq(activityTable.type, "draft_send_failed")));
  }

  // Sending is the one action with a real side effect outside our database:
  // it must reach Lemlist before the draft is marked sent. This mirrors the
  // Slack "Send" button in routes/slack.ts — this route did not call Lemlist
  // at all until now, so pressing Send in the dashboard silently marked a
  // draft "sent" while the lead received nothing.
  if (action === "send") {
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, existingDraft.campaignId));
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, existingDraft.clientId));

    if (!campaign) {
      res.status(404).json({ error: "Campaign not found for draft — cannot send" });
      return;
    }

    const channel = existingDraft.channel ?? "lemlist";

    // A Meta or WhatsApp lead goes out over WhatsApp, which needs the lead's
    // number and this client's WhatsApp credentials. Refused before anything
    // is sent, and the draft stays pending so it can be sent once set up.
    if (channel !== "lemlist") {
      const reason = unsendableReason(existingDraft, client);
      if (reason) {
        res.status(422).json({ error: reason });
        return;
      }
    }

    // Drafts created before lemlist_lead_id existed have nothing to send
    // against — the endpoint takes Lemlist's own lead id, not an email
    // address, and there is no way to recover it after the fact.
    if (channel === "lemlist" && !existingDraft.lemlistLeadId) {
      await db.update(draftsTable)
        .set({ status: "send_failed", actionedAt: new Date() })
        .where(eq(draftsTable.id, existingDraft.id));
      res.status(422).json({
        error: "This draft predates Lemlist lead tracking and cannot be sent automatically — reply to the lead directly in Lemlist.",
      });
      return;
    }

    // A reply that arrived over LinkedIn has no email address on the lead, and
    // sendReply posts to Lemlist's /inbox/email. Sending would either fail
    // obscurely inside Lemlist or, worse, deliver an email to someone who
    // wrote on LinkedIn and never gave an address. The webhook subscribes to
    // linkedinReplied as well as emailsReplied, so these drafts do get created
    // — they simply cannot be answered through the email endpoint.
    if (channel === "lemlist" && !existingDraft.prospectEmail.trim()) {
      res.status(422).json({
        error: "This reply came in without an email address — most likely over LinkedIn. Answer it in Lemlist, then discard this draft.",
      });
      return;
    }

    const replyText = existingDraft.editedReplyText ?? existingDraft.replyText;
    let lemlistError: string | undefined;
    try {
      const result = await sendApprovedReply({
        draft: existingDraft,
        lemlistCampaignId: campaign.lemlistCampaignId,
        client,
        replyText,
      });
      if (!result.ok) lemlistError = result.error;
    } catch (err) {
      lemlistError = err instanceof Error ? err.message : String(err);
    }

    if (lemlistError) {
      logger.error({ draftId: existingDraft.id, lemlistError, channel }, "Dashboard send: sendApprovedReply failed");
      await db.update(draftsTable)
        .set({ status: "send_failed", actionedAt: new Date() })
        .where(eq(draftsTable.id, existingDraft.id));
      // Keep the Slack card, if any, from also trying — same status update
      // the Slack action handler posts on failure.
      if (existingDraft.slackMessageTs) {
        const [channel, ts] = existingDraft.slackMessageTs.split("|");
        const [cardClient] = await db.select().from(clientsTable).where(eq(clientsTable.id, existingDraft.clientId));
        void updateMessageAfterAction(
          channel,
          ts ?? channel,
          "send_failed",
          req.session.user?.name,
          cardClient?.slackBotToken ?? undefined,
          lemlistError,
        ).catch((err) => logger.warn({ err }, "Dashboard send: failed to update Slack card after Lemlist failure"));
      }
      res.status(502).json({ error: `${channelLabel(channel)} send failed: ${lemlistError}` });
      return;
    }
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    actionedAt: new Date(),
  };
  if (action === "edit" && editedText) {
    updateData.editedReplyText = editedText;
  }

  const [draft] = await db
    .update(draftsTable)
    .set(updateData)
    .where(eq(draftsTable.id, params.data.id))
    .returning();

  if (!draft) {
    res.status(404).json({ error: "Draft not found" });
    return;
  }

  // Reflect the outcome on the Slack card too, so it does not keep showing
  // live Send/Edit/Discard buttons for a draft this route already resolved.
  if (draft.slackMessageTs) {
    const [channel, ts] = draft.slackMessageTs.split("|");
    const [cardClient] = await db.select().from(clientsTable).where(eq(clientsTable.id, draft.clientId));
    void updateMessageAfterAction(
      channel,
      ts ?? channel,
      newStatus,
      req.session.user?.name,
      cardClient?.slackBotToken ?? undefined,
      undefined,
      action === "edit" ? (editedText ?? draft.replyText) : undefined,
    ).catch((err) => logger.warn({ err, draftId: draft.id }, "Dashboard action: failed to update Slack card"));
  }

  // Get campaign name for activity log
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, draft.campaignId));

  const activityTypeMap = { sent: "draft_sent", edited: "draft_edited", discarded: "draft_discarded" } as const;
  await db.insert(activityTable).values({
    type: activityTypeMap[newStatus as keyof typeof activityTypeMap],
    description: `Reply to ${draft.prospectName} (${draft.prospectEmail || (draft.prospectPhone ? `+${draft.prospectPhone}` : "no contact")}) ${newStatus}`,
    clientId: draft.clientId,
    campaignId: draft.campaignId,
    draftId: draft.id,
    campaignName: campaign?.name ?? null,
  });

  res.json(ApplyDraftActionResponse.parse(draft));
});

// POST /api/drafts/:id/repost — re-post the Slack approval card for an existing draft.
// Resets status to "pending" and posts a fresh card. Safe to call on send_failed drafts.
// Does NOT create a new draft — no duplicate.
router.post("/drafts/:id/repost", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid draft id" });
    return;
  }

  if (!isSlackConfigured()) {
    res.status(503).json({ error: "Slack is not configured" });
    return;
  }

  const [draft] = await db.select().from(draftsTable).where(eq(draftsTable.id, id));
  if (!draft || !canAccessClient(req, draft.clientId)) {
    denyNotFound(res, "Draft");
    return;
  }

  if (draft.status === "sent" || draft.status === "discarded") {
    res.status(409).json({ error: `Draft is already ${draft.status} — cannot repost` });
    return;
  }

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, draft.campaignId));
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, draft.clientId));
  const persona = campaign?.personaId
    ? (await db.select().from(personasTable).where(eq(personasTable.id, campaign.personaId)))[0]
    : undefined;

  if (!client) {
    res.status(404).json({ error: "Client not found for draft" });
    return;
  }

  // This client's own channel only — no global fallback, so one client's card
  // can never surface in another's channel.
  const approvalChannel = resolveClientApprovalChannel(client.slackChannel);

  if (!approvalChannel) {
    res.status(503).json({
      error: "This client has no Slack channel — approve the draft in the dashboard, or add a channel on the client page.",
    });
    return;
  }

  const isRealToken = (t: string | null | undefined) =>
    !!t && t.startsWith("xoxb-") && !t.includes("placeholder");
  const botToken = isRealToken(client.slackBotToken) ? (client.slackBotToken ?? undefined) : undefined;

  // Reset draft to pending (idempotent — safe to call even if already pending)
  await db.update(draftsTable)
    .set({ status: "pending", actionedAt: null, slackMessageTs: null })
    .where(eq(draftsTable.id, draft.id));

  // Post new approval card
  let slackTs: string | null = null;
  try {
    slackTs = await postApprovalCard({
      channelId: approvalChannel,
      botToken,
      draftId: draft.id,
      leadName: draft.prospectName,
      leadCompany: draft.prospectCompany ?? "",
      leadEmail: draft.prospectEmail,
      incomingReply: draft.conversationSnippet ?? "",
      generatedDraft: draft.replyText,
      campaignName: campaign?.name ?? "",
      personaName: persona?.name ?? "SDR",
      region: draft.prospectCountry ?? "US",
    });
  } catch (err) {
    req.log.error({ err, draftId: draft.id }, "repost: failed to post Slack approval card");
    // Restore original status so draft isn't stuck as pending with no card
    await db.update(draftsTable)
      .set({ status: "send_failed", actionedAt: new Date() })
      .where(eq(draftsTable.id, draft.id));
    res.status(502).json({ error: `Slack post failed: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  if (slackTs) {
    await db.update(draftsTable)
      .set({ slackMessageTs: `${approvalChannel}|${slackTs}` })
      .where(eq(draftsTable.id, draft.id));
  }

  await db.insert(activityTable).values({
    type: "draft_created",
    description: `Slack approval card reposted for draft #${draft.id} (${draft.prospectName} / ${draft.prospectEmail})`,
    clientId: draft.clientId,
    campaignId: draft.campaignId,
    draftId: draft.id,
    campaignName: campaign?.name ?? null,
  });

  req.log.info({ draftId: draft.id, channel: approvalChannel, slackTs }, "repost: Slack approval card posted");

  res.json({ ok: true, draftId: draft.id, channel: approvalChannel, slackTs, duplicateCreated: false });
});

export default router;

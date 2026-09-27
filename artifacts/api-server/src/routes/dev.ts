/**
 * Dev-only routes — blocked in production (NODE_ENV=production → 404).
 * Used exclusively by E2E test suites.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, draftsTable, clientsTable, campaignsTable, activityTable } from "@workspace/db";

import { requireOperator } from "../middleware/requireOperator";

const router: IRouter = Router();

function devEnabled(): boolean {
  return (
    process.env["NODE_ENV"] !== "production" &&
    process.env["ENABLE_DEV_LOGIN"] === "true"
  );
}

/**
 * POST /api/dev/seed-sweeper-draft
 *
 * Creates a send_failed draft with sweeperAlertedAt set, simulating a draft
 * that was auto-failed by the stale-draft sweeper.  The draft is pinned to the
 * first available client + campaign so the frontend can render it.
 *
 * Response: { ok: true, draftId: number, clientId: number, campaignId: number }
 */
router.post("/dev/seed-sweeper-draft", requireOperator, async (req, res): Promise<void> => {
  if (!devEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Find the first client with at least one campaign
  const clients = await db.select().from(clientsTable).limit(10);
  let clientId: number | null = null;
  let campaignId: number | null = null;

  for (const client of clients) {
    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.clientId, client.id))
      .limit(1);
    if (campaign) {
      clientId = client.id;
      campaignId = campaign.id;
      break;
    }
  }

  if (clientId === null || campaignId === null) {
    res.status(422).json({
      error: "No client + campaign found in DB — cannot seed test draft",
    });
    return;
  }

  const now = new Date();
  const [draft] = await db
    .insert(draftsTable)
    .values({
      clientId,
      campaignId,
      prospectEmail: `e2e-sweeper-test-${Date.now()}@example.com`,
      prospectName: "E2E Sweeper Test Lead",
      prospectCompany: "Acme E2E Corp",
      replyText:
        "This is an auto-generated E2E test draft for sweeper badge verification.",
      status: "send_failed",
      actionedAt: now,
      sweeperAlertedAt: now,
    })
    .returning();

  const draftId = draft!.id;

  // Also seed the activity record that the real sweeper would have written,
  // so the draft-detail Activity card has something to display in E2E tests.
  const ageMinutes = 1440; // simulated threshold
  const [activity] = await db
    .insert(activityTable)
    .values({
      type: "draft_send_failed",
      description: `Draft #${draftId} was pending for ${ageMinutes} minutes (threshold: ${ageMinutes} min) and was automatically moved to send_failed.`,
      clientId,
      campaignId,
      draftId,
    })
    .returning({ id: activityTable.id });

  res.json({ ok: true, draftId, activityId: activity!.id, clientId, campaignId });
});

/**
 * DELETE /api/dev/seed-sweeper-draft/:id
 *
 * Removes a previously-seeded sweeper test draft.  Only removes drafts whose
 * prospectEmail starts with "e2e-sweeper-test-" as a safety guard.
 */
router.delete("/dev/seed-sweeper-draft/:id", requireOperator, async (req, res): Promise<void> => {
  if (!devEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  // Fetch first to enforce the safety guard before deleting
  const [existing] = await db
    .select({ id: draftsTable.id, prospectEmail: draftsTable.prospectEmail })
    .from(draftsTable)
    .where(eq(draftsTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Draft not found" });
    return;
  }

  if (!existing.prospectEmail.startsWith("e2e-sweeper-test-")) {
    res.status(403).json({
      error: "Safety guard: will only delete e2e-seeded drafts",
    });
    return;
  }

  await db.delete(activityTable).where(eq(activityTable.draftId, id));
  await db.delete(draftsTable).where(eq(draftsTable.id, id));

  res.json({ ok: true, deleted: id });
});

/**
 * POST /api/dev/seed-placeholder-client
 *
 * Creates a client with a placeholder (non-real) Slack channel so that the
 * dashboard banner can be tested without modifying production data.
 *
 * Response: { ok: true, clientId: number }
 */
router.post("/dev/seed-placeholder-client", requireOperator, async (req, res): Promise<void> => {
  if (!devEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const suffix = Date.now();
  const [client] = await db
    .insert(clientsTable)
    .values({
      name: `E2E Placeholder Client ${suffix}`,
      company: "Acme E2E Corp",
      slackChannel: `placeholder-e2e-${suffix}`,
    })
    .returning();

  res.json({ ok: true, clientId: client!.id });
});

/**
 * DELETE /api/dev/seed-placeholder-client/:id
 *
 * Removes a previously-seeded placeholder client.  Only removes clients whose
 * name starts with "E2E Placeholder Client" as a safety guard.
 */
router.delete("/dev/seed-placeholder-client/:id", requireOperator, async (req, res): Promise<void> => {
  if (!devEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db
    .select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  if (!existing.name.startsWith("E2E Placeholder Client")) {
    res.status(403).json({
      error: "Safety guard: will only delete E2E-seeded placeholder clients",
    });
    return;
  }

  await db.delete(clientsTable).where(eq(clientsTable.id, id));

  res.json({ ok: true, deleted: id });
});

/**
 * POST /api/dev/seed-pending-draft
 *
 * Creates a pending draft pinned to the first available client + campaign.
 * Used by the approve-send E2E spec to exercise the "Approve & Send" button
 * without needing a real Lemlist lead.
 *
 * Response: { ok: true, draftId: number, clientId: number, campaignId: number }
 */
router.post("/dev/seed-pending-draft", requireOperator, async (req, res): Promise<void> => {
  if (!devEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Find the first client with at least one campaign
  const clients = await db.select().from(clientsTable).limit(10);
  let clientId: number | null = null;
  let campaignId: number | null = null;

  for (const client of clients) {
    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.clientId, client.id))
      .limit(1);
    if (campaign) {
      clientId = client.id;
      campaignId = campaign.id;
      break;
    }
  }

  if (clientId === null || campaignId === null) {
    res.status(422).json({
      error: "No client + campaign found in DB — cannot seed test draft",
    });
    return;
  }

  const [draft] = await db
    .insert(draftsTable)
    .values({
      clientId,
      campaignId,
      prospectEmail: `e2e-pending-test-${Date.now()}@example.com`,
      prospectName: "E2E Pending Test Lead",
      prospectCompany: "Acme E2E Corp",
      conversationSnippet: "Hi, I'm interested in your product.",
      replyText: "Thanks for reaching out! I'd love to chat more about how we can help.",
      status: "pending",
    })
    .returning();

  res.json({ ok: true, draftId: draft!.id, clientId, campaignId });
});

/**
 * DELETE /api/dev/seed-pending-draft/:id
 *
 * Removes a previously-seeded pending test draft.  Only removes drafts whose
 * prospectEmail starts with "e2e-pending-test-" as a safety guard.
 */
router.delete("/dev/seed-pending-draft/:id", requireOperator, async (req, res): Promise<void> => {
  if (!devEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db
    .select({ id: draftsTable.id, prospectEmail: draftsTable.prospectEmail })
    .from(draftsTable)
    .where(eq(draftsTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Draft not found" });
    return;
  }

  if (!existing.prospectEmail.startsWith("e2e-pending-test-")) {
    res.status(403).json({
      error: "Safety guard: will only delete e2e-seeded pending drafts",
    });
    return;
  }

  await db.delete(activityTable).where(eq(activityTable.draftId, id));
  await db.delete(draftsTable).where(eq(draftsTable.id, id));

  res.json({ ok: true, deleted: id });
});

/**
 * POST /api/dev/seed-e2e-client
 *
 * Creates a client + campaign pair for E2E tests that require at least one
 * client with a campaign (e.g. the dashboard share-link spec).
 *
 * Only creates the pair when no suitable client+campaign already exists, so
 * it is safe to call on every CI run — it returns the existing pair when
 * the database is already populated.
 *
 * Response: { ok: true, clientId: number, campaignId: number, seeded: boolean }
 */
router.post("/dev/seed-e2e-client", requireOperator, async (req, res): Promise<void> => {
  if (!devEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Return an existing client+campaign if one already exists
  const clients = await db.select().from(clientsTable).limit(20);
  for (const client of clients) {
    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.clientId, client.id))
      .limit(1);
    if (campaign) {
      res.json({ ok: true, clientId: client.id, campaignId: campaign.id, seeded: false });
      return;
    }
  }

  // Nothing usable exists — seed a fresh client + campaign
  const suffix = Date.now();
  const [client] = await db
    .insert(clientsTable)
    .values({
      name: `E2E Share-Link Client ${suffix}`,
      company: "Acme E2E Corp",
      slackChannel: `e2e-share-link-${suffix}`,
    })
    .returning();

  const [campaign] = await db
    .insert(campaignsTable)
    .values({
      clientId: client!.id,
      name: `E2E Share-Link Campaign ${suffix}`,
      lemlistCampaignId: `e2e-cam-${suffix}`,
    })
    .returning();

  res.json({ ok: true, clientId: client!.id, campaignId: campaign!.id, seeded: true });
});

/**
 * DELETE /api/dev/seed-e2e-client/:clientId
 *
 * Removes a client (and its campaigns) that were seeded by
 * POST /api/dev/seed-e2e-client.  Only removes rows whose name starts with
 * "E2E Share-Link Client" as a safety guard.
 */
router.delete("/dev/seed-e2e-client/:clientId", requireOperator, async (req, res): Promise<void> => {
  if (!devEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const clientId = parseInt(String(req.params["clientId"]), 10);
  if (isNaN(clientId)) {
    res.status(400).json({ error: "Invalid clientId" });
    return;
  }

  const [existing] = await db
    .select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));

  if (!existing) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  if (!existing.name.startsWith("E2E Share-Link Client")) {
    res.status(403).json({
      error: "Safety guard: will only delete E2E share-link seeded clients",
    });
    return;
  }

  await db.delete(campaignsTable).where(eq(campaignsTable.clientId, clientId));
  await db.delete(clientsTable).where(eq(clientsTable.id, clientId));

  res.json({ ok: true, deleted: clientId });
});

export default router;

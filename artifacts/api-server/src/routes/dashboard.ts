import { Router, type IRouter } from "express";
import { eq, desc, gte, and, type SQL } from "drizzle-orm";
import { db, clientsTable, campaignsTable, draftsTable, activityTable, personasTable } from "@workspace/db";
import {
  GetDashboardStatsResponse,
  ListActivityQueryParams,
  ListActivityResponse,
  GetReplyTrendsResponse,
  GetReplyTrendsQueryParams,
} from "@workspace/api-zod";

import { clientScope, scopedClientId } from "../middleware/scope";

const router: IRouter = Router();

router.get("/dashboard/stats", async (req, res): Promise<void> => {
  // Each aggregate is scoped separately: an unscoped count would tell a client
  // user how many drafts and clients exist in total, which is itself a leak
  // even without exposing the rows.
  const scoped = scopedClientId(req);
  const [clients, campaigns, allDrafts, personas] = await Promise.all([
    scoped === null
      ? db.select().from(clientsTable)
      : db.select().from(clientsTable).where(eq(clientsTable.id, scoped)),
    db.select().from(campaignsTable).where(and(eq(campaignsTable.isActive, true), clientScope(req, campaignsTable.clientId))),
    db.select().from(draftsTable).where(clientScope(req, draftsTable.clientId)),
    db.select().from(personasTable).where(clientScope(req, personasTable.clientId)),
  ]);

  const pendingDrafts = allDrafts.filter((d) => d.status === "pending").length;
  const sendFailedDrafts = allDrafts.filter((d) => d.status === "send_failed").length;
  const totalDraftsSent = allDrafts.filter((d) => d.status === "sent").length;
  const totalDraftsDiscarded = allDrafts.filter((d) => d.status === "discarded").length;
  const totalDraftsEdited = allDrafts.filter((d) => d.status === "edited").length;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const webhooksToday = allDrafts.filter((d) => new Date(d.createdAt) >= todayStart).length;

  const total = allDrafts.length;
  const actioned = totalDraftsSent + totalDraftsEdited;
  const successRate = total > 0 ? Math.round((actioned / total) * 100) / 100 : 0;

  res.json(GetDashboardStatsResponse.parse({
    totalClients: clients.length,
    activeCampaigns: campaigns.length,
    totalPersonas: personas.length,
    pendingDrafts,
    sendFailedDrafts,
    totalDraftsSent,
    totalDraftsDiscarded,
    totalDraftsEdited,
    webhooksToday,
    successRate,
  }));
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const query = ListActivityQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const limit = query.data.limit ?? 20;
  const conditions = [clientScope(req, activityTable.clientId)];
  if (query.data.draftId !== undefined) {
    conditions.push(eq(activityTable.draftId, query.data.draftId));
  }
  const activity = await db
    .select()
    .from(activityTable)
    .where(and(...conditions))
    .orderBy(desc(activityTable.createdAt))
    .limit(limit);
  res.json(ListActivityResponse.parse(activity));
});

router.get("/dashboard/reply-trends", async (req, res): Promise<void> => {
  const query = GetReplyTrendsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  // All of this works in UTC, deliberately. The bucket *keys* come from
  // toISOString(), which is always UTC, so doing the day arithmetic in local
  // time silently misaligns the two whenever the process is not on UTC: the
  // newest bucket ends up being yesterday's UTC date and every draft created
  // "today" lands on a key no bucket has, so the loop below drops it. The
  // container runs UTC today, which is the only reason this has not shown up
  // in production — that is a coincidence of deployment, not a guarantee.
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const DAY_MS = 24 * 60 * 60 * 1000;
  const since = new Date(todayUtc - 29 * DAY_MS);

  const conditions: (SQL | undefined)[] = [gte(draftsTable.createdAt, since), clientScope(req, draftsTable.clientId)];
  if (query.data.clientId !== undefined) {
    conditions.push(eq(draftsTable.clientId, query.data.clientId));
  }
  if (query.data.campaignId !== undefined) {
    conditions.push(eq(draftsTable.campaignId, query.data.campaignId));
  }

  const drafts = await db
    .select({ createdAt: draftsTable.createdAt, status: draftsTable.status })
    .from(draftsTable)
    .where(and(...conditions));

  const buckets = new Map<string, { pending: number; sent: number; edited: number; discarded: number; send_failed: number }>();

  for (let i = 29; i >= 0; i--) {
    const key = new Date(todayUtc - i * DAY_MS).toISOString().slice(0, 10);
    buckets.set(key, { pending: 0, sent: 0, edited: 0, discarded: 0, send_failed: 0 });
  }

  for (const draft of drafts) {
    const key = new Date(draft.createdAt).toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const status = draft.status as keyof typeof bucket;
    if (status in bucket) bucket[status]++;
  }

  const result = Array.from(buckets.entries()).map(([date, counts]) => ({ date, ...counts }));
  res.json(GetReplyTrendsResponse.parse(result));
});

export default router;

import { Router, type IRouter } from "express";
import { eq, and, ne } from "drizzle-orm";
import { db, campaignsTable, draftsTable, clientsTable } from "@workspace/db";
import {
  ListCampaignsQueryParams,
  ListCampaignsResponse,
  CreateCampaignBody,
  CreateCampaignResponse,
  GetCampaignParams,
  GetCampaignResponse,
  UpdateCampaignParams,
  UpdateCampaignBody,
  UpdateCampaignResponse,
  DeleteCampaignParams,
  GetCampaignStatsParams,
  GetCampaignStatsResponse,
} from "@workspace/api-zod";

import { clientScope, canAccessClient, denyNotFound, scopedClientId } from "../middleware/scope";
import { limitsFor } from "../lib/plans";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

/**
 * How many of a client's campaigns are currently drafting.
 *
 * Counted from the rows every time rather than kept as a running total, so
 * deleting or switching off a campaign frees its slot immediately and no
 * counter can drift out of step with what it claims to count.
 */
async function countActiveCampaigns(clientId: number, excludeCampaignId?: number): Promise<number> {
  const [{ count = 0 } = {}] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignsTable)
    .where(and(
      eq(campaignsTable.clientId, clientId),
      eq(campaignsTable.isActive, true),
      excludeCampaignId != null ? ne(campaignsTable.id, excludeCampaignId) : undefined,
    ));
  return count;
}

function atCapMessage(plan: string, limit: number): string {
  return `The ${plan} plan runs ${limit} campaigns at a time and this client already has ${limit} switched on. Switch one off to free a slot, or move to a larger plan.`;
}

router.get("/campaigns", async (req, res): Promise<void> => {
  const query = ListCampaignsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const campaigns = await db
    .select()
    .from(campaignsTable)
    .where(and(
      clientScope(req, campaignsTable.clientId),
      query.data.clientId != null ? eq(campaignsTable.clientId, query.data.clientId) : undefined,
    ))
    .orderBy(campaignsTable.createdAt);
  res.json(ListCampaignsResponse.parse(campaigns));
});

router.post("/campaigns", async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const scoped = scopedClientId(req);
  if (scoped !== null && parsed.data.clientId !== scoped) {
    res.status(403).json({ error: "Cannot create a campaign for another client" });
    return;
  }

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, parsed.data.clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  // Mapping a campaign is never refused — a client importing their Lemlist
  // account should see all of it. Only *activation* is capped, so a create
  // that would exceed the allowance lands switched off instead of failing.
  // Asking for it explicitly is a different matter: a caller that passed
  // isActive: true gets told it cannot be granted rather than quietly given
  // the opposite of what it asked for.
  const limits = limitsFor(client.plan);
  const active = await countActiveCampaigns(parsed.data.clientId);
  const atCap = active >= limits.activeCampaigns;

  if (atCap && parsed.data.isActive === true) {
    res.status(422).json({ error: atCapMessage(client.plan, limits.activeCampaigns) });
    return;
  }

  const [campaign] = await db
    .insert(campaignsTable)
    .values({ ...parsed.data, isActive: parsed.data.isActive ?? !atCap })
    .returning();
  res.status(201).json(CreateCampaignResponse.parse(campaign));
});

router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  if (campaign && !canAccessClient(req, campaign.clientId)) {
    denyNotFound(res, "Campaign");
    return;
  }
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(GetCampaignResponse.parse(campaign));
});

router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const params = UpdateCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Switching a campaign *on* has to clear the plan's allowance first, so it
  // needs the row before the write. Everything else goes straight to the
  // update. Read through the same scope filter as the update, so this cannot
  // become a way to learn about another client's campaign.
  if (parsed.data.isActive === true) {
    const [existing] = await db
      .select()
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, params.data.id), clientScope(req, campaignsTable.clientId)));
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    // Re-activating something already on is a no-op, not a request for a
    // second slot — checking it would refuse an edit that changes nothing.
    if (!existing.isActive) {
      const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, existing.clientId));
      const limits = limitsFor(client?.plan);
      // Excludes this campaign, which is off, so the count is the slots taken
      // by others. Not serialised against a concurrent activation — at this
      // scale a race could overshoot by one, which is worth far less than the
      // locking needed to prevent it.
      const active = await countActiveCampaigns(existing.clientId, existing.id);
      if (active >= limits.activeCampaigns) {
        res.status(422).json({ error: atCapMessage(client?.plan ?? "starter", limits.activeCampaigns) });
        return;
      }
    }
  }

  // Scoped in the WHERE, not checked afterwards: the update must never touch
  // another client's row, and a post-hoc check runs too late for that.
  const [campaign] = await db
    .update(campaignsTable)
    .set(parsed.data)
    .where(and(eq(campaignsTable.id, params.data.id), clientScope(req, campaignsTable.clientId)))
    .returning();
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(UpdateCampaignResponse.parse(campaign));
});

router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  const params = DeleteCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [campaign] = await db
    .delete(campaignsTable)
    .where(and(eq(campaignsTable.id, params.data.id), clientScope(req, campaignsTable.clientId)))
    .returning();
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/campaigns/:id/stats", async (req, res): Promise<void> => {
  const params = GetCampaignStatsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const campaignId = params.data.id;
  const [statsCampaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!statsCampaign || !canAccessClient(req, statsCampaign.clientId)) {
    denyNotFound(res, "Campaign");
    return;
  }
  const drafts = await db.select().from(draftsTable).where(eq(draftsTable.campaignId, campaignId));
  const sent = drafts.filter((d) => d.status === "sent").length;
  const edited = drafts.filter((d) => d.status === "edited").length;
  const discarded = drafts.filter((d) => d.status === "discarded").length;
  const pending = drafts.filter((d) => d.status === "pending").length;
  res.json(GetCampaignStatsResponse.parse({ campaignId, totalReplies: drafts.length, sent, edited, discarded, pending, avgResponseTimeMs: null }));
});

export default router;

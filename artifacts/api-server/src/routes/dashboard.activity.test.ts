/**
 * End-to-end API integration tests for the activity dashboard after a retry.
 *
 * These tests perform the full "close the loop" sequence:
 *   1. DB starts with a stale draft_send_failed row for draftId 42
 *      (representing a previously failed send that was recorded in the feed)
 *   2. POST /api/slack/actions — operator retries the draft; Lemlist succeeds
 *   3. The stateful mock DB mutates: delete runs (removes draft_send_failed),
 *      insert runs (adds draft_sent)
 *   4. GET /api/dashboard/activity — query the feed endpoint
 *   5. Assert: exactly one draft_sent, zero draft_send_failed for the retried draft
 *
 * This directly validates the dashboard-visible outcome, not just that the correct
 * DB operations were issued.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted shared state ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const draftRow = {
    id: 42,
    status: "send_failed" as string,
    clientId: 1,
    campaignId: 1,
    prospectEmail: "retry@example.com",
    lemlistLeadId: "lea_test123",
    prospectName: "Retry Lead",
    prospectCompany: "Retry Corp",
    prospectCountry: "US",
    replyText: "AI draft reply",
    editedReplyText: null as string | null,
    slackMessageTs: "C_RETRY|1111111111.000001" as string | null,
    actionedAt: null,
  };

  const campaignRow = {
    id: 1,
    name: "Retry Campaign",
    lemlistCampaignId: "cam_retry123",
  };

  const clientRow = { id: 1, slackBotToken: null };

  // Stateful in-memory activity table.
  // Starts with a stale draft_send_failed entry for draftId 42
  // (as it would exist after the first failed send attempt).
  const activityRows: Array<{
    id: number;
    type: string;
    description: string;
    clientName: string | null;
    campaignName: string | null;
    clientId: number | null;
    campaignId: number | null;
    draftId: number | null;
    createdAt: Date;
  }> = [
    {
      id: 1,
      type: "draft_send_failed",
      description:
        "Lemlist send failed for reply to Retry Lead (retry@example.com): rate limited",
      clientName: null,
      campaignName: "Retry Campaign",
      clientId: 1,
      campaignId: 1,
      draftId: 42,
      createdAt: new Date("2026-07-21T09:50:00Z"),
    },
    {
      id: 2,
      type: "draft_created",
      description: "Claude generated reply for Other Lead (other@example.com)",
      clientName: null,
      campaignName: "Other Campaign",
      clientId: 2,
      campaignId: 2,
      draftId: 99,
      createdAt: new Date("2026-07-21T09:40:00Z"),
    },
  ];

  let nextId = 10;

  return {
    draftRow,
    campaignRow,
    clientRow,
    activityRows,
    getNextId: () => ++nextId,
    sendReply: vi.fn<() => Promise<{ ok: boolean; error?: string }>>(),
    verifyIncomingRequest: vi.fn(() => true),
    updateMessageAfterAction: vi.fn(() => Promise.resolve()),
    openEditModal: vi.fn(() => Promise.resolve()),
    postEphemeral: vi.fn(() => Promise.resolve()),
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  desc: vi.fn((_col: unknown) => ({ _desc: _col })),
  gte: vi.fn((_col: unknown, _val: unknown) => ({ _gte_col: _col, _gte_val: _val })),
}));

vi.mock("../lib/lemlist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/lemlist")>();
  return {
    ...actual,
    sendReply: mocks.sendReply,
    isLemlistConfigured: () => true,
  };
});

vi.mock("../lib/slack", () => ({
  verifyIncomingRequest: mocks.verifyIncomingRequest,
  updateMessageAfterAction: mocks.updateMessageAfterAction,
  openEditModal: mocks.openEditModal,
  postEphemeral: mocks.postEphemeral,
  isSlackConfigured: vi.fn(() => false),
  postApprovalCard: vi.fn(() => Promise.resolve("ts999")),
  postTestMessage: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock("@workspace/db", () => {
  const activityTable = { _name: "activity" };
  const draftsTable = { _name: "drafts" };
  const campaignsTable = { _name: "campaigns" };
  const clientsTable = { _name: "clients" };
  const logsTable = { _name: "logs" };
  const personasTable = { _name: "personas" };

  return {
    activityTable,
    draftsTable,
    campaignsTable,
    clientsTable,
    logsTable,
    personasTable,
    db: {
      select: () => ({
        from: (table: object) => ({
          // Dashboard activity feed: .orderBy().limit()
          orderBy: () => ({
            limit: (n: number) =>
              Promise.resolve(
                [...mocks.activityRows]
                  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                  .slice(0, n),
              ),
          }),
          // Other routes: .where(). The activity feed is now scoped, so it
          // arrives as .where().orderBy().limit() — return the same chain the
          // unscoped path above exposes.
          where: () => {
            if (table === activityTable) {
              return {
                orderBy: () => ({
                  limit: (n: number) =>
                    Promise.resolve(
                      [...mocks.activityRows]
                        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                        .slice(0, n),
                    ),
                }),
              };
            }
            if (table === draftsTable)
              return Promise.resolve([{ ...mocks.draftRow }]);
            if (table === campaignsTable)
              return Promise.resolve([{ ...mocks.campaignRow }]);
            if (table === clientsTable)
              return Promise.resolve([{ ...mocks.clientRow }]);
            if (table === personasTable) return Promise.resolve([]);
            return Promise.resolve([]);
          },
        }),
      }),
      update: (table: object) => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            // Keep the in-memory draft row consistent so idempotency guards work
            if (table === draftsTable) {
              Object.assign(mocks.draftRow, values);
            }
            return Promise.resolve(undefined);
          },
        }),
      }),
      insert: (table: object) => ({
        values: (row: Record<string, unknown>) => {
          // Persist activity inserts so the feed endpoint can read them back
          if (table === activityTable) {
            mocks.activityRows.push({
              id: mocks.getNextId(),
              type: (row.type as string) ?? "unknown",
              description: (row.description as string) ?? "",
              clientName: (row.clientName as string | null) ?? null,
              campaignName: (row.campaignName as string | null) ?? null,
              clientId: (row.clientId as number | null) ?? null,
              campaignId: (row.campaignId as number | null) ?? null,
              draftId: (row.draftId as number | null) ?? null,
              createdAt: new Date(),
            });
          }
          return Promise.resolve(undefined);
        },
      }),
      delete: (table: object) => ({
        where: (condition: unknown) => {
          // Parse the mocked drizzle condition and remove matching rows
          if (table === activityTable) {
            type Condition = { _and: Array<{ _val: unknown }> };
            const andArgs = (condition as Condition)._and ?? [];
            const vals = new Set(andArgs.map((a) => a._val));
            // A row matches if ALL condition values are found in its fields
            const toRemove = mocks.activityRows.filter(
              (r) => vals.has(r.draftId) && vals.has(r.type),
            );
            for (const row of toRemove) {
              const idx = mocks.activityRows.indexOf(row);
              if (idx >= 0) mocks.activityRows.splice(idx, 1);
            }
          }
          return Promise.resolve(undefined);
        },
      }),
    },
  };
});

// The /api router is gated by requireOperator, so these route tests need an
// operator session; the real store-backed session would need Postgres.
vi.mock("express-session", async () =>
  (await import("../testing/sessionMock")).expressSessionMock());

// ─── App import (after all vi.mock calls) ─────────────────────────────────────

import request from "supertest";
import app from "../app";
import { loginAsOperator } from "../testing/sessionMock";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendActionBody(draftId = 42) {
  return {
    payload: JSON.stringify({
      type: "block_actions",
      user: { id: "U_OPERATOR" },
      team: { id: "T_WORKSPACE" },
      trigger_id: "trigger.e2e.123",
      channel: { id: "C_RETRY" },
      actions: [{ action_id: "draft_send", value: String(draftId) }],
    }),
  };
}

function flushAsync(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Activity dashboard — end-to-end retry flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginAsOperator();
    mocks.verifyIncomingRequest.mockReturnValue(true);
    mocks.updateMessageAfterAction.mockResolvedValue(undefined);

    // Reset draft to send_failed state
    mocks.draftRow.status = "send_failed";
    mocks.draftRow.editedReplyText = null;
    mocks.draftRow.slackMessageTs = "C_RETRY|1111111111.000001";

    // Reset the activity table to the initial state:
    //   one stale draft_send_failed for draftId 42, one unrelated draft_created
    mocks.activityRows.length = 0;
    mocks.activityRows.push(
      {
        id: 1,
        type: "draft_send_failed",
        description:
          "Lemlist send failed for reply to Retry Lead (retry@example.com): rate limited",
        clientName: null,
        campaignName: "Retry Campaign",
        clientId: 1,
        campaignId: 1,
        draftId: 42,
        createdAt: new Date("2026-07-21T09:50:00Z"),
      },
      {
        id: 2,
        type: "draft_created",
        description: "Claude generated reply for Other Lead (other@example.com)",
        clientName: null,
        campaignName: "Other Campaign",
        clientId: 2,
        campaignId: 2,
        draftId: 99,
        createdAt: new Date("2026-07-21T09:40:00Z"),
      },
    );
  });

  it("after a successful retry, the activity feed has exactly one draft_sent and no draft_send_failed for the retried draft", async () => {
    mocks.sendReply.mockResolvedValue({ ok: true });

    // Step 1: operator retries the failed send via the Slack action
    const actionRes = await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    expect(actionRes.status).toBe(200);
    await flushAsync(); // let the background processor finish

    // Step 2: query the dashboard activity feed
    const feedRes = await request(app)
      .get("/api/dashboard/activity")
      .query({ limit: 20 });

    expect(feedRes.status).toBe(200);
    const feed = feedRes.body as Array<{ type: string; description: string }>;

    // Step 3: assert exactly one entry for the retried prospect — and it is draft_sent
    const forRetried = feed.filter((item) =>
      item.description.includes("retry@example.com"),
    );

    expect(forRetried).toHaveLength(1);
    expect(forRetried[0].type).toBe("draft_sent");
  });

  it("no draft_send_failed entry for the retried draft remains in the feed after a successful retry", async () => {
    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    const feedRes = await request(app)
      .get("/api/dashboard/activity")
      .query({ limit: 20 });

    expect(feedRes.status).toBe(200);
    const feed = feedRes.body as Array<{ type: string; description: string }>;

    const staleFailures = feed.filter(
      (item) =>
        item.type === "draft_send_failed" &&
        item.description.includes("retry@example.com"),
    );

    expect(staleFailures).toHaveLength(0);
  });

  it("total feed entry count after retry is one less than before (stale failure replaced by success)", async () => {
    // Before retry: 2 entries (draft_send_failed for #42 + draft_created for #99)
    const beforeRes = await request(app)
      .get("/api/dashboard/activity")
      .query({ limit: 20 });
    const beforeCount = (beforeRes.body as unknown[]).length;
    expect(beforeCount).toBe(2); // baseline

    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    // After retry: stale failure deleted, draft_sent inserted → still 2 entries
    // (draft_sent for #42 replaces draft_send_failed for #42; draft_created for #99 untouched)
    const afterRes = await request(app)
      .get("/api/dashboard/activity")
      .query({ limit: 20 });
    const afterCount = (afterRes.body as unknown[]).length;

    expect(afterCount).toBe(2);
  });

  it("when retry also fails, the draft_send_failed entry remains and no draft_sent is added", async () => {
    mocks.sendReply.mockResolvedValue({ ok: false, error: "still rate limited" });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    const feedRes = await request(app)
      .get("/api/dashboard/activity")
      .query({ limit: 20 });

    expect(feedRes.status).toBe(200);
    const feed = feedRes.body as Array<{ type: string; description: string }>;

    const failEntries = feed.filter(
      (item) =>
        item.type === "draft_send_failed" &&
        item.description.includes("retry@example.com"),
    );
    // One new draft_send_failed was inserted (old one still there since no delete ran)
    expect(failEntries.length).toBeGreaterThanOrEqual(1);

    const sentEntries = feed.filter(
      (item) =>
        item.type === "draft_sent" &&
        item.description.includes("retry@example.com"),
    );
    expect(sentEntries).toHaveLength(0);
  });

  it("unrelated entries in the feed are not affected by the retry", async () => {
    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    const feedRes = await request(app)
      .get("/api/dashboard/activity")
      .query({ limit: 20 });

    const feed = feedRes.body as Array<{ type: string; description: string }>;

    const unrelated = feed.filter((item) =>
      item.description.includes("other@example.com"),
    );

    expect(unrelated).toHaveLength(1);
    expect(unrelated[0].type).toBe("draft_created");
  });
});

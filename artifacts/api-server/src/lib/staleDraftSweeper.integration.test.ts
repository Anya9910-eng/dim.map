/**
 * Integration tests for sweepStaleDrafts
 *
 * Uses the real PostgreSQL database so the WHERE predicate (status=pending,
 * age cutoffs, posted/orphan tiers) is exercised against actual SQL.
 * Only the Slack / WebClient layer is mocked to avoid real network calls.
 *
 * Requires DATABASE_URL (available in the Replit dev environment).
 *
 * Isolation strategy:
 *   - All test rows share a unique prospectEmail prefix so afterEach can
 *     delete only test data, leaving prod rows untouched.
 *   - STALE_DRAFT_THRESHOLD_MINUTES and STALE_ORPHAN_THRESHOLD_MINUTES are
 *     set to 1 minute so "stale" rows need only be 2 minutes old.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks (Slack layer only) ─────────────────────────────────────────

const { mockUpdateMessageAfterAction, MockWebClient } = vi.hoisted(() => {
  const updateMsg = vi.fn(() => Promise.resolve());
  function MockWebClientCtor(this: unknown) {
    return { chat: { postMessage: vi.fn(() => Promise.resolve({ ok: true })) } };
  }
  return { mockUpdateMessageAfterAction: updateMsg, MockWebClient: MockWebClientCtor };
});

vi.mock("@slack/web-api", () => ({ WebClient: MockWebClient }));

vi.mock("../lib/slack", () => ({
  isSlackConfigured: () => false,
  updateMessageAfterAction: mockUpdateMessageAfterAction,
}));

// ─── Real DB + sweeper imports ─────────────────────────────────────────────────

import { db, draftsTable, activityTable } from "@workspace/db";
import { eq, and, like, inArray } from "drizzle-orm";
import { sweepStaleDrafts } from "./staleDraftSweeper";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_EMAIL_PREFIX = "_int_stale_sweep_";

/** Returns a unique email for each test run to avoid cross-test contamination. */
function testEmail(label: string) {
  return `${TEST_EMAIL_PREFIX}${label}_${Date.now()}@example.com`;
}

/** Inserts a minimal draft row and returns its id. */
async function insertDraft(overrides: {
  status?: "pending" | "sent" | "send_failed" | "edited" | "discarded" | "escalated" | "skipped";
  createdAt?: Date;
  slackMessageTs?: string | null;
  prospectEmail?: string;
}) {
  const [row] = await db
    .insert(draftsTable)
    .values({
      clientId: 999998,
      campaignId: 999998,
      prospectEmail: overrides.prospectEmail ?? testEmail("default"),
      prospectName: "Integration Test Lead",
      replyText: "Test reply text",
      status: overrides.status ?? "pending",
      slackMessageTs: overrides.slackMessageTs ?? null,
    })
    .returning({ id: draftsTable.id });
  if (!row) throw new Error("draft insert failed");

  // Override createdAt separately (Drizzle's defaultNow() can't be overridden inline)
  if (overrides.createdAt) {
    await db
      .update(draftsTable)
      .set({ createdAt: overrides.createdAt })
      .where(eq(draftsTable.id, row.id));
  }

  return row.id;
}

/** Reads the current status + actionedAt for a draft by id. */
async function getDraftStatus(id: number) {
  const [row] = await db
    .select({ status: draftsTable.status, actionedAt: draftsTable.actionedAt })
    .from(draftsTable)
    .where(eq(draftsTable.id, id));
  return row;
}

/** Counts activity rows linked to a specific draftId. */
async function countActivity(draftId: number) {
  const rows = await db
    .select({ id: activityTable.id })
    .from(activityTable)
    .where(eq(activityTable.draftId, draftId));
  return rows.length;
}

/** Cleans up all test rows inserted during a test run. */
async function cleanupTestRows(draftIds: number[]) {
  if (draftIds.length > 0) {
    await db.delete(activityTable).where(inArray(activityTable.draftId, draftIds));
    await db.delete(draftsTable).where(inArray(draftsTable.id, draftIds));
  }
  // Also sweep by email prefix for safety
  await db
    .delete(draftsTable)
    .where(like(draftsTable.prospectEmail, `${TEST_EMAIL_PREFIX}%`));
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("sweepStaleDrafts — integration (real DB)", () => {
  const insertedIds: number[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    // Use 1-minute thresholds so a 2-minute-old draft is always stale
    process.env.STALE_DRAFT_THRESHOLD_MINUTES = "1";
    process.env.STALE_ORPHAN_THRESHOLD_MINUTES = "1";
    insertedIds.length = 0;
  });

  afterEach(async () => {
    delete process.env.STALE_DRAFT_THRESHOLD_MINUTES;
    delete process.env.STALE_ORPHAN_THRESHOLD_MINUTES;
    delete process.env.SLACK_ALERT_CHANNEL;
    await cleanupTestRows(insertedIds);
  });

  // ── 1. Stale posted draft is moved to send_failed ─────────────────────────

  it("moves a stale pending posted-draft to send_failed", async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const id = await insertDraft({
      createdAt: twoMinutesAgo,
      slackMessageTs: "CTEST|1700000000.000001",
      prospectEmail: testEmail("posted"),
    });
    insertedIds.push(id);

    await sweepStaleDrafts();

    const row = await getDraftStatus(id);
    expect(row?.status).toBe("send_failed");
    expect(row?.actionedAt).not.toBeNull();
  });

  it("inserts an activity row for the swept draft", async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const id = await insertDraft({
      createdAt: twoMinutesAgo,
      prospectEmail: testEmail("activity"),
    });
    insertedIds.push(id);

    await sweepStaleDrafts();

    const count = await countActivity(id);
    expect(count).toBe(1);

    const [actRow] = await db
      .select()
      .from(activityTable)
      .where(eq(activityTable.draftId, id));
    expect(actRow?.type).toBe("draft_send_failed");
  });

  // ── 2. Stale orphaned draft (no slackMessageTs) ───────────────────────────

  it("moves a stale orphaned draft to send_failed", async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const id = await insertDraft({
      createdAt: twoMinutesAgo,
      slackMessageTs: null,
      prospectEmail: testEmail("orphan"),
    });
    insertedIds.push(id);

    await sweepStaleDrafts();

    const row = await getDraftStatus(id);
    expect(row?.status).toBe("send_failed");
  });

  it("does not call updateMessageAfterAction for orphaned drafts (no Slack card)", async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const id = await insertDraft({
      createdAt: twoMinutesAgo,
      slackMessageTs: null,
      prospectEmail: testEmail("orphan_no_card"),
    });
    insertedIds.push(id);

    await sweepStaleDrafts();

    expect(mockUpdateMessageAfterAction).not.toHaveBeenCalled();
  });

  // ── 3. Fresh pending draft is NOT swept ───────────────────────────────────

  it("does NOT touch a fresh pending draft that is below the threshold", async () => {
    // createdAt = now (seconds old, well under 1-minute threshold)
    const id = await insertDraft({
      prospectEmail: testEmail("fresh"),
      slackMessageTs: null,
    });
    insertedIds.push(id);

    await sweepStaleDrafts();

    const row = await getDraftStatus(id);
    expect(row?.status).toBe("pending");
    expect(row?.actionedAt).toBeNull();
  });

  it("inserts no activity row for a fresh draft", async () => {
    const id = await insertDraft({ prospectEmail: testEmail("fresh_act") });
    insertedIds.push(id);

    await sweepStaleDrafts();

    const count = await countActivity(id);
    expect(count).toBe(0);
  });

  // ── 4. Non-pending drafts (sent, send_failed) are NOT touched ─────────────

  it("does NOT move a stale sent draft", async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const id = await insertDraft({
      status: "sent",
      createdAt: twoMinutesAgo,
      prospectEmail: testEmail("sent"),
    });
    insertedIds.push(id);

    await sweepStaleDrafts();

    const row = await getDraftStatus(id);
    expect(row?.status).toBe("sent");
  });

  it("does NOT move a stale send_failed draft", async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const id = await insertDraft({
      status: "send_failed",
      createdAt: twoMinutesAgo,
      prospectEmail: testEmail("already_failed"),
    });
    insertedIds.push(id);

    await sweepStaleDrafts();

    const count = await countActivity(id);
    expect(count).toBe(0); // no new activity for this draft
  });

  // ── 5. Conditional update guard (concurrent sweeps) ───────────────────────

  it("two concurrent sweeps produce exactly one send_failed transition and one activity row", async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const id = await insertDraft({
      createdAt: twoMinutesAgo,
      slackMessageTs: null,
      prospectEmail: testEmail("concurrent"),
    });
    insertedIds.push(id);

    // Run both sweeps concurrently
    await Promise.all([sweepStaleDrafts(), sweepStaleDrafts()]);

    // Status is send_failed exactly once
    const row = await getDraftStatus(id);
    expect(row?.status).toBe("send_failed");

    // Activity row created exactly once (not twice)
    const count = await countActivity(id);
    expect(count).toBe(1);
  });

  // ── 6. Threshold boundary: draft just inside vs just outside ─────────────

  it("sweeps a draft that is 61 seconds old (> 1 min threshold)", async () => {
    const justOver = new Date(Date.now() - 61 * 1000);
    const id = await insertDraft({
      createdAt: justOver,
      prospectEmail: testEmail("just_over"),
    });
    insertedIds.push(id);

    await sweepStaleDrafts();

    const row = await getDraftStatus(id);
    expect(row?.status).toBe("send_failed");
  });

  it("does NOT sweep a draft that is 30 seconds old (< 1 min threshold)", async () => {
    const justUnder = new Date(Date.now() - 30 * 1000);
    const id = await insertDraft({
      createdAt: justUnder,
      prospectEmail: testEmail("just_under"),
    });
    insertedIds.push(id);

    await sweepStaleDrafts();

    const row = await getDraftStatus(id);
    expect(row?.status).toBe("pending");
  });
});

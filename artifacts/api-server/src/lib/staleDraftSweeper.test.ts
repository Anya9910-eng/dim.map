/**
 * Unit tests for sweepStaleDrafts
 *
 * Strategy: mock @workspace/db so the DB layer is fully controlled, mock
 * @slack/web-api and ../lib/slack to avoid real network calls, then invoke
 * sweepStaleDrafts() directly and assert side-effects via the mock call
 * history.
 *
 * Scenarios covered:
 *  1. Stale posted draft (slackMessageTs set, age > threshold) → moved to
 *     send_failed + activity row inserted + Slack card updated.
 *  2. Stale orphaned draft (slackMessageTs null, age > orphan threshold) →
 *     same outcome, no Slack card update attempt.
 *  3. Non-pending drafts (sent / send_failed) are never touched because the
 *     sweeper only queries status = "pending".
 *  4. Conditional update guard: when db.update().returning() returns [] (a
 *     concurrent process already actioned the draft) the sweep skips the
 *     activity insert and Slack notifications.
 *  5. Concurrent sweeps: running sweepStaleDrafts() twice at the same time
 *     results in exactly one activity row and one Slack card update.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockUpdateReturning,
  mockInsertValues,
  mockUpdateMessageAfterAction,
  mockPostMessage,
  MockWebClient,
  draftsTableRef,
  campaignsTableRef,
  clientsTableRef,
  activityTableRef,
  staleDraftPosted,
  staleDraftOrphan,
  clientRow,
  campaignRow,
} = vi.hoisted(() => {
  const updateReturning = vi.fn<() => Promise<{ id: number }[]>>();
  const insertValues = vi.fn(() => Promise.resolve(undefined));
  const updateMsg = vi.fn(() => Promise.resolve());
  const postMsg = vi.fn<() => Promise<{ ok: boolean }>>();

  function MockWebClientCtor(this: unknown) {
    return { chat: { postMessage: postMsg } };
  }

  // Shared table sentinel objects — same references used in mock and returned
  // from vi.mock so both sides can key the Map correctly.
  const draftsTable = { _name: "drafts" };
  const campaignsTable = { _name: "campaigns" };
  const clientsTable = { _name: "clients" };
  const activityTable = { _name: "activity" };

  const now = Date.now();

  // Posted draft: slackMessageTs set, created 25 hours ago (> 24 h default)
  const postedDraft = {
    id: 42,
    clientId: 1,
    campaignId: 1,
    prospectEmail: "lead@example.com",
    prospectName: "Test Lead",
    slackMessageTs: "C123ABC|1700000000.000100",
    sweeperAlertedAt: null,
    createdAt: new Date(now - 25 * 60 * 60 * 1000),
  };

  // Orphaned draft: no slackMessageTs, created 90 minutes ago (> 60 m default)
  const orphanDraft = {
    id: 99,
    clientId: 2,
    campaignId: 2,
    prospectEmail: "orphan@example.com",
    prospectName: "Orphan Lead",
    slackMessageTs: null,
    sweeperAlertedAt: null,
    createdAt: new Date(now - 90 * 60 * 1000),
  };

  const client = { id: 1, name: "Test Client", slackBotToken: null };
  const campaign = { id: 1, name: "Test Campaign" };

  return {
    mockUpdateReturning: updateReturning,
    mockInsertValues: insertValues,
    mockUpdateMessageAfterAction: updateMsg,
    mockPostMessage: postMsg,
    MockWebClient: MockWebClientCtor,
    draftsTableRef: draftsTable,
    campaignsTableRef: campaignsTable,
    clientsTableRef: clientsTable,
    activityTableRef: activityTable,
    staleDraftPosted: postedDraft,
    staleDraftOrphan: orphanDraft,
    clientRow: client,
    campaignRow: campaign,
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@slack/web-api", () => ({
  WebClient: MockWebClient,
}));

vi.mock("../lib/slack", () => ({
  isSlackConfigured: vi.fn(() => false),
  updateMessageAfterAction: mockUpdateMessageAfterAction,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  or: vi.fn((...args: unknown[]) => ({ _or: args })),
  lt: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
  isNull: vi.fn((_col: unknown) => ({ _isNull: _col })),
  isNotNull: vi.fn((_col: unknown) => ({ _isNotNull: _col })),
}));

// Controlled db mock — staleDraftsRows is mutated per test to control which
// drafts the initial query returns.
let staleDraftsRows: unknown[] = [];

vi.mock("@workspace/db", () => {
  const rowsByTable = new Map<object, () => unknown[]>([
    [draftsTableRef, () => staleDraftsRows],
    [campaignsTableRef, () => [campaignRow]],
    [clientsTableRef, () => [clientRow]],
    [activityTableRef, () => []],
  ]);

  return {
    draftsTable: draftsTableRef,
    campaignsTable: campaignsTableRef,
    clientsTable: clientsTableRef,
    activityTable: activityTableRef,
    db: {
      select: (_cols?: unknown) => ({
        from: (table: object) => ({
          where: () => {
            const getter = rowsByTable.get(table);
            return Promise.resolve(getter ? getter() : []);
          },
        }),
      }),
      update: (_table: unknown) => ({
        set: (_vals: unknown) => ({
          where: (_cond: unknown) => ({
            returning: mockUpdateReturning,
          }),
        }),
      }),
      insert: (_table: unknown) => ({
        values: mockInsertValues,
      }),
    },
  };
});

// ─── Import under test (after vi.mock) ───────────────────────────────────────

import { sweepStaleDrafts } from "./staleDraftSweeper";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("sweepStaleDrafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SLACK_ALERT_CHANNEL;
    // Default: update succeeds (draft was still pending)
    mockUpdateReturning.mockResolvedValue([{ id: 42 }]);
    mockInsertValues.mockResolvedValue(undefined);
    mockUpdateMessageAfterAction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.SLACK_ALERT_CHANNEL;
  });

  // ── 1. Stale posted draft ──────────────────────────────────────────────────

  describe("stale posted draft (slackMessageTs set, age > threshold)", () => {
    beforeEach(() => {
      staleDraftsRows = [staleDraftPosted];
    });

    it("performs a conditional update to send_failed", async () => {
      await sweepStaleDrafts();
      expect(mockUpdateReturning).toHaveBeenCalledTimes(1);
    });

    it("inserts an activity row after a successful update", async () => {
      await sweepStaleDrafts();
      expect(mockInsertValues).toHaveBeenCalledTimes(1);
      const activityArg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
      expect(activityArg.type).toBe("draft_send_failed");
      expect(activityArg.draftId).toBe(staleDraftPosted.id);
    });

    it("calls updateMessageAfterAction to update the Slack approval card", async () => {
      await sweepStaleDrafts();
      expect(mockUpdateMessageAfterAction).toHaveBeenCalledTimes(1);
      const [channelId, ts, status, actor] = mockUpdateMessageAfterAction.mock.calls[0] as string[];
      expect(channelId).toBe("C123ABC");
      expect(ts).toBe("1700000000.000100");
      expect(status).toBe("send_failed");
      expect(actor).toBe("auto-sweep");
    });

    it("does NOT post to SLACK_ALERT_CHANNEL when it is not set", async () => {
      await sweepStaleDrafts();
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it("posts to SLACK_ALERT_CHANNEL when it is set and Slack is configured", async () => {
      const { isSlackConfigured } = await import("../lib/slack");
      vi.mocked(isSlackConfigured).mockReturnValue(true);
      process.env.SLACK_ALERT_CHANNEL = "C_ALERTS";
      mockPostMessage.mockResolvedValue({ ok: true });

      await sweepStaleDrafts();

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      const call = (mockPostMessage.mock.calls as unknown[][])[0]?.[0] as { channel: string; text: string };
      expect(call.channel).toBe("C_ALERTS");
      expect(call.text).toContain(String(staleDraftPosted.id));
    });

    it("skips Slack alert when sweeperAlertedAt is already set (dedup)", async () => {
      const { isSlackConfigured } = await import("../lib/slack");
      vi.mocked(isSlackConfigured).mockReturnValue(true);
      process.env.SLACK_ALERT_CHANNEL = "C_ALERTS";

      // Simulate a draft that was already alerted in a previous sweep cycle
      staleDraftsRows = [{ ...staleDraftPosted, sweeperAlertedAt: new Date(Date.now() - 60_000) }];

      await sweepStaleDrafts();

      // Status should still be updated (move to send_failed)
      expect(mockUpdateReturning).toHaveBeenCalledTimes(1);
      // But no duplicate Slack alert should be posted
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  // ── 2. Stale orphaned draft (no slackMessageTs) ────────────────────────────

  describe("stale orphaned draft (slackMessageTs null)", () => {
    beforeEach(() => {
      staleDraftsRows = [staleDraftOrphan];
      mockUpdateReturning.mockResolvedValue([{ id: staleDraftOrphan.id }]);
    });

    it("moves orphaned draft to send_failed", async () => {
      await sweepStaleDrafts();
      expect(mockUpdateReturning).toHaveBeenCalledTimes(1);
    });

    it("inserts an activity row for the orphaned draft", async () => {
      await sweepStaleDrafts();
      expect(mockInsertValues).toHaveBeenCalledTimes(1);
      const arg = (mockInsertValues.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
      expect(arg.draftId).toBe(staleDraftOrphan.id);
    });

    it("does NOT call updateMessageAfterAction (no Slack card to update)", async () => {
      await sweepStaleDrafts();
      expect(mockUpdateMessageAfterAction).not.toHaveBeenCalled();
    });
  });

  // ── 3. No stale drafts ─────────────────────────────────────────────────────

  describe("when there are no stale drafts", () => {
    beforeEach(() => {
      staleDraftsRows = [];
    });

    it("does nothing — no update, no insert, no Slack call", async () => {
      await sweepStaleDrafts();
      expect(mockUpdateReturning).not.toHaveBeenCalled();
      expect(mockInsertValues).not.toHaveBeenCalled();
      expect(mockUpdateMessageAfterAction).not.toHaveBeenCalled();
    });
  });

  // ── 4. Non-pending drafts are never returned by the query ──────────────────
  // The sweeper filters status = "pending" in the DB query. Because the mock
  // controls what rows come back, we simulate the correct DB behaviour by
  // returning an empty list (as the real DB would for sent/send_failed rows).

  describe("drafts with terminal status (sent / send_failed)", () => {
    it("are not touched when the DB returns no rows for them", async () => {
      staleDraftsRows = []; // DB finds nothing — terminal rows excluded by where clause
      await sweepStaleDrafts();
      expect(mockUpdateReturning).not.toHaveBeenCalled();
      expect(mockInsertValues).not.toHaveBeenCalled();
    });
  });

  // ── 5. Conditional update guard (race-condition protection) ────────────────

  describe("conditional update guard", () => {
    beforeEach(() => {
      staleDraftsRows = [staleDraftPosted];
    });

    it("skips activity insert when update returns empty (draft already actioned)", async () => {
      mockUpdateReturning.mockResolvedValue([]); // another process won the race
      await sweepStaleDrafts();
      expect(mockInsertValues).not.toHaveBeenCalled();
      expect(mockUpdateMessageAfterAction).not.toHaveBeenCalled();
    });

    it("skips Slack card update when update returns empty", async () => {
      mockUpdateReturning.mockResolvedValue([]);
      await sweepStaleDrafts();
      expect(mockUpdateMessageAfterAction).not.toHaveBeenCalled();
    });

    it("concurrent sweeps: only the winner inserts the activity row", async () => {
      // First call wins; second call simulates the concurrent sweep that lost.
      mockUpdateReturning
        .mockResolvedValueOnce([{ id: staleDraftPosted.id }]) // sweep A wins
        .mockResolvedValueOnce([]); // sweep B loses

      await Promise.all([sweepStaleDrafts(), sweepStaleDrafts()]);

      // Activity row inserted exactly once
      expect(mockInsertValues).toHaveBeenCalledTimes(1);
      // Slack card updated exactly once
      expect(mockUpdateMessageAfterAction).toHaveBeenCalledTimes(1);
    });
  });
});

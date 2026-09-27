/**
 * Retry path tests for send_failed drafts
 *
 * Confirms that:
 *  1. A send_failed draft can be retried via the ✅ Send button
 *  2. On success the draft is marked sent and the stale draft_send_failed
 *     activity entry is deleted — leaving exactly one draft_sent entry
 *  3. On a second failure the draft stays send_failed and no spurious delete runs
 *  4. A plain pending draft that succeeds on first try never triggers the delete
 *  5. A send_failed draft retried via the Edit modal on success also cleans up
 */

import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

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

  return {
    draftRow,
    campaignRow,
    clientRow,
    dbUpdateSets: [] as object[],
    dbInsertValues: [] as object[],
    dbDeleteWheres: [] as unknown[],
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
  const draftsTable = { _name: "drafts" };
  const campaignsTable = { _name: "campaigns" };
  const clientsTable = { _name: "clients" };
  const logsTable = { _name: "logs" };
  const activityTable = { _name: "activity" };

  return {
    draftsTable,
    campaignsTable,
    clientsTable,
    logsTable,
    activityTable,
    db: {
      select: () => ({
        from: (table: object) => ({
          where: () => {
            if (table === draftsTable) return Promise.resolve([{ ...mocks.draftRow }]);
            if (table === campaignsTable) return Promise.resolve([{ ...mocks.campaignRow }]);
            if (table === clientsTable) return Promise.resolve([{ ...mocks.clientRow }]);
            return Promise.resolve([]);
          },
        }),
      }),
      update: (_table: object) => ({
        set: (values: object) => {
          mocks.dbUpdateSets.push(values);
          return { where: () => Promise.resolve(undefined) };
        },
      }),
      insert: (_table: object) => ({
        values: (values: object) => {
          mocks.dbInsertValues.push(values);
          return Promise.resolve(undefined);
        },
      }),
      delete: (_table: object) => ({
        where: (condition: unknown) => {
          mocks.dbDeleteWheres.push(condition);
          return Promise.resolve(undefined);
        },
      }),
    },
  };
});

// ─── App import (after all vi.mock calls) ─────────────────────────────────────

import request from "supertest";
import app from "../app";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendActionBody(draftId = 42) {
  return {
    payload: JSON.stringify({
      type: "block_actions",
      user: { id: "U_OPERATOR" },
      team: { id: "T_WORKSPACE" },
      trigger_id: "trigger.retry.123",
      channel: { id: "C_RETRY" },
      actions: [{ action_id: "draft_send", value: String(draftId) }],
    }),
  };
}

function editModalSubmitBody(draftId = 42, text = "Edited retry text") {
  return {
    payload: JSON.stringify({
      type: "view_submission",
      user: { id: "U_OPERATOR" },
      team: { id: "T_WORKSPACE" },
      view: {
        callback_id: "draft_edit_modal",
        private_metadata: String(draftId),
        state: {
          values: {
            reply_text_block: { reply_text: { value: text } },
          },
        },
      },
    }),
  };
}

function flushAsync(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("send_failed draft retry path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyIncomingRequest.mockReturnValue(true);
    mocks.updateMessageAfterAction.mockResolvedValue(undefined);
    mocks.openEditModal.mockResolvedValue(undefined);
    mocks.postEphemeral.mockResolvedValue(undefined);

    mocks.draftRow.status = "send_failed";
    mocks.draftRow.editedReplyText = null;
    mocks.draftRow.slackMessageTs = "C_RETRY|1111111111.000001";
    mocks.dbUpdateSets.length = 0;
    mocks.dbInsertValues.length = 0;
    mocks.dbDeleteWheres.length = 0;
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Successful retry via Send button ────────────────────────────────────

  it("marks draft sent on successful retry", async () => {
    mocks.sendReply.mockResolvedValue({ ok: true });

    const res = await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    expect(res.status).toBe(200);
    await flushAsync();

    const statusUpdate = mocks.dbUpdateSets.find(
      (s) => (s as { status?: string }).status === "sent",
    );
    expect(statusUpdate).toBeDefined();
  });

  it("deletes stale draft_send_failed activity on successful retry via Send", async () => {
    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    expect(mocks.dbDeleteWheres).toHaveLength(1);
  });

  it("inserts draft_sent activity (not draft_send_failed) on successful retry", async () => {
    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    const insertedTypes = mocks.dbInsertValues
      .map((v) => (v as { type?: string }).type)
      .filter(Boolean);

    expect(insertedTypes).toContain("draft_sent");
    expect(insertedTypes).not.toContain("draft_send_failed");
  });

  it("updates Slack message to sent state on successful retry", async () => {
    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    expect(mocks.updateMessageAfterAction).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "sent",
      expect.any(String),
      undefined,
    );
  });

  // ── 2. Second failure — draft stays send_failed, no spurious delete ────────

  it("does not call db.delete when the retry also fails", async () => {
    mocks.sendReply.mockResolvedValue({ ok: false, error: "still rate limited" });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    expect(mocks.dbDeleteWheres).toHaveLength(0);
  });

  it("marks draft send_failed again when retry also fails", async () => {
    mocks.sendReply.mockResolvedValue({ ok: false, error: "still rate limited" });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    const failedUpdate = mocks.dbUpdateSets.find(
      (s) => (s as { status?: string }).status === "send_failed",
    );
    expect(failedUpdate).toBeDefined();
  });

  // ── 3. Pending draft: no delete on first-time success ─────────────────────

  it("does not call db.delete when a pending draft succeeds on first try", async () => {
    mocks.draftRow.status = "pending";
    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    expect(mocks.dbDeleteWheres).toHaveLength(0);
  });

  // ── 4. Successful retry via Edit modal ────────────────────────────────────

  it("deletes stale draft_send_failed activity on successful edit-modal retry", async () => {
    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(editModalSubmitBody());

    await flushAsync();

    expect(mocks.dbDeleteWheres).toHaveLength(1);
  });

  it("inserts draft_sent (not draft_send_failed) after successful edit-modal retry", async () => {
    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(editModalSubmitBody());

    await flushAsync();

    const insertedTypes = mocks.dbInsertValues
      .map((v) => (v as { type?: string }).type)
      .filter(Boolean);

    expect(insertedTypes).toContain("draft_sent");
    expect(insertedTypes).not.toContain("draft_send_failed");
  });

  // ── 5. Activity feed net state: exactly one entry per draft after retry ───

  it("activity feed ends up with exactly one draft_sent entry and no draft_send_failed after a successful retry via Send", async () => {
    // The stale draft_send_failed entry exists in the DB (draft.status === "send_failed").
    // After a successful retry the server must:
    //   a) delete the stale draft_send_failed activity row scoped to this draftId (one db.delete call)
    //   b) insert exactly one draft_sent activity row scoped to this draftId
    //   c) insert zero draft_send_failed activity rows
    // Net result: the dashboard feed for this draft shows exactly one entry — sent, not failed.

    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    // (a) exactly one delete was issued — for the stale failure entry of this specific draft
    expect(mocks.dbDeleteWheres).toHaveLength(1);
    // The delete condition must target draftId 42 and type "draft_send_failed"
    type DeleteCondition = { _and: Array<{ _val: unknown }> };
    const deleteCondition = mocks.dbDeleteWheres[0] as DeleteCondition;
    const deleteVals = deleteCondition._and.map((a) => a._val);
    expect(deleteVals).toContain(42);            // scoped to this draftId
    expect(deleteVals).toContain("draft_send_failed"); // only removes the failure entry

    const activityInserts = mocks.dbInsertValues.filter(
      (v) =>
        (v as { type?: string }).type === "draft_sent" ||
        (v as { type?: string }).type === "draft_send_failed",
    );

    // (b) exactly one draft_sent was inserted, scoped to this draftId
    const sentInserts = activityInserts.filter(
      (v) => (v as { type?: string }).type === "draft_sent",
    );
    expect(sentInserts).toHaveLength(1);
    expect((sentInserts[0] as { draftId?: number }).draftId).toBe(42);

    // (c) no draft_send_failed was inserted (success path only)
    const failedInserts = activityInserts.filter(
      (v) => (v as { type?: string }).type === "draft_send_failed",
    );
    expect(failedInserts).toHaveLength(0);
  });

  it("activity feed ends up with exactly one draft_sent entry and no draft_send_failed after a successful retry via Edit modal", async () => {
    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(editModalSubmitBody());

    await flushAsync();

    // stale failure entry was removed — delete scoped to draftId 42
    expect(mocks.dbDeleteWheres).toHaveLength(1);
    type DeleteCondition = { _and: Array<{ _val: unknown }> };
    const deleteCondition = mocks.dbDeleteWheres[0] as DeleteCondition;
    const deleteVals = deleteCondition._and.map((a) => a._val);
    expect(deleteVals).toContain(42);
    expect(deleteVals).toContain("draft_send_failed");

    const activityInserts = mocks.dbInsertValues.filter(
      (v) =>
        (v as { type?: string }).type === "draft_sent" ||
        (v as { type?: string }).type === "draft_send_failed",
    );

    const sentInserts = activityInserts.filter(
      (v) => (v as { type?: string }).type === "draft_sent",
    );
    expect(sentInserts).toHaveLength(1);
    expect((sentInserts[0] as { draftId?: number }).draftId).toBe(42);

    const failedInserts = activityInserts.filter(
      (v) => (v as { type?: string }).type === "draft_send_failed",
    );
    expect(failedInserts).toHaveLength(0);
  });

  it("activity feed still shows a draft_send_failed entry when the retry also fails (no spurious delete or sent insert)", async () => {
    mocks.sendReply.mockResolvedValue({ ok: false, error: "still rate limited" });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    // No delete — the old failure entry stays in the feed
    expect(mocks.dbDeleteWheres).toHaveLength(0);

    // A new draft_send_failed entry was inserted for this draftId
    const failedInserts = mocks.dbInsertValues.filter(
      (v) => (v as { type?: string }).type === "draft_send_failed",
    );
    expect(failedInserts).toHaveLength(1);
    expect((failedInserts[0] as { draftId?: number }).draftId).toBe(42);

    // No draft_sent insert (send did not succeed)
    const sentInserts = mocks.dbInsertValues.filter(
      (v) => (v as { type?: string }).type === "draft_sent",
    );
    expect(sentInserts).toHaveLength(0);
  });

  // ── 6. Idempotency: already-actioned draft is ignored ─────────────────────

  it("ignores retry if draft is already sent (idempotency guard)", async () => {
    mocks.draftRow.status = "sent";
    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    expect(mocks.sendReply).not.toHaveBeenCalled();
    expect(mocks.dbDeleteWheres).toHaveLength(0);
    expect(mocks.dbUpdateSets).toHaveLength(0);
  });

  it("ignores Send button press if draft is already edited (idempotency guard blocks re-send)", async () => {
    // An operator previously used the Edit modal: the draft was edited and the reply
    // was sent — status is now "edited".  If they somehow press the ✅ Send button
    // again (e.g. via a stale Slack message), the action must be a no-op:
    //  • sendReply must NOT be called (prevents a duplicate Lemlist send)
    //  • No DB status update must be written
    //  • No activity row must be inserted
    mocks.draftRow.status = "edited";
    mocks.sendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(sendActionBody());

    await flushAsync();

    expect(mocks.sendReply).not.toHaveBeenCalled();
    expect(mocks.dbUpdateSets).toHaveLength(0);
    expect(mocks.dbInsertValues).toHaveLength(0);
  });
});

/**
 * Slack 3-second timeout tests
 *
 * Slack requires a 200 OK within 3 seconds of a button click.
 * These tests confirm the /api/slack/actions handler acks immediately
 * (well under 1 second) even when downstream work (Lemlist, DB) is slow.
 *
 * Strategy: mock sendReply with a 5-second artificial delay, then assert
 * the HTTP response arrives in under 1 second — proving the ack is not
 * blocked by the Lemlist call.
 */

import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

// ─── Hoisted mock variables ───────────────────────────────────────────────────
// vi.mock factories are hoisted above all imports/declarations, so any variables
// they reference must also be hoisted via vi.hoisted().

const {
  mockSendReply,
  mockVerifyIncomingRequest,
  mockUpdateMessageAfterAction,
  mockPostFallbackFailureNotification,
  mockDraftRow,
} = vi.hoisted(() => {
  const draftRow = {
    id: 1,
    status: "pending",
    clientId: 1,
    campaignId: 1,
    prospectEmail: "lead@example.com",
    lemlistLeadId: "lea_test123" as string | null,
    prospectName: "Test Lead",
    prospectCompany: "Acme Corp",
    prospectCountry: "US",
    replyText: "Hi there, thanks for reaching out!",
    editedReplyText: null,
    slackMessageTs: null as string | null,
    actionedAt: null,
  };
  return {
    mockSendReply: vi.fn<() => Promise<{ ok: boolean; error?: string }>>(),
    mockVerifyIncomingRequest: vi.fn(() => true),
    mockUpdateMessageAfterAction: vi.fn(() => Promise.resolve()),
    mockPostFallbackFailureNotification: vi.fn(() => Promise.resolve()),
    mockDraftRow: draftRow,
  };
});

// ─── Module mocks (hoisted above all imports by vitest) ───────────────────────

// Mock drizzle-orm so eq() never throws on our fake table objects
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
}));

vi.mock("../lib/lemlist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/lemlist")>();
  return {
    ...actual,
    sendReply: mockSendReply,
    isLemlistConfigured: () => true,
  };
});

vi.mock("../lib/slack", () => ({
  verifyIncomingRequest: mockVerifyIncomingRequest,
  updateMessageAfterAction: mockUpdateMessageAfterAction,
  postFallbackFailureNotification: mockPostFallbackFailureNotification,
  openEditModal: vi.fn(() => Promise.resolve()),
  isSlackConfigured: vi.fn(() => false),
  postApprovalCard: vi.fn(() => Promise.resolve("ts123")),
  postTestMessage: vi.fn(() => Promise.resolve({ ok: true })),
  postEphemeral: vi.fn(() => Promise.resolve()),
}));

// ─── DB mock ─────────────────────────────────────────────────────────────────
// Tables are plain objects; the db mock uses identity (Map) to return the right
// rows for each table. where() ignores the drizzle condition; we only care about
// which table was queried.
//
// draftRow is a shared mutable object — tests mutate it in beforeEach to
// control the slackMessageTs field without needing per-test module resets.

vi.mock("@workspace/db", () => {
  const draftsTable = { _name: "drafts" };
  const campaignsTable = { _name: "campaigns" };
  const clientsTable = { _name: "clients" };
  const logsTable = { _name: "logs" };
  const activityTable = { _name: "activity" };

  const campaignRow = {
    id: 1,
    name: "Test Campaign",
    lemlistCampaignId: "cam_abc123",
  };

  const clientRow = {
    id: 1,
    slackBotToken: null,
  };

  const rowsByTable = new Map<object, unknown[]>([
    [draftsTable, [mockDraftRow]],
    [campaignsTable, [campaignRow]],
    [clientsTable, [clientRow]],
    [logsTable, []],
    [activityTable, []],
  ]);

  return {
    draftsTable,
    campaignsTable,
    clientsTable,
    logsTable,
    activityTable,
    db: {
      select: () => ({
        from: (table: object) => ({
          where: () => Promise.resolve(rowsByTable.get(table) ?? []),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(undefined),
        }),
      }),
      insert: () => ({
        values: () => Promise.resolve(undefined),
      }),
      delete: () => ({
        where: () => Promise.resolve(undefined),
      }),
    },
  };
});

// ─── App import (must come after vi.mock calls) ───────────────────────────────

import request from "supertest";
import app from "../app";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function blockActionBody(actionId: "draft_send" | "draft_discard" | "draft_edit" | "draft_escalate", draftId = 1) {
  const payload = {
    type: "block_actions",
    user: { id: "U_OPERATOR" },
    team: { id: "T_WORKSPACE" },
    trigger_id: "trigger.abc.123",
    actions: [{ action_id: actionId, value: String(draftId) }],
  };
  return { payload: JSON.stringify(payload) };
}

function viewSubmissionBody(draftId = 1, text = "Updated reply text") {
  const payload = {
    type: "view_submission",
    user: { id: "U_OPERATOR" },
    team: { id: "T_WORKSPACE" },
    view: {
      callback_id: "draft_edit_modal",
      private_metadata: String(draftId),
      state: {
        values: {
          reply_text_block: {
            reply_text: { value: text },
          },
        },
      },
    },
  };
  return { payload: JSON.stringify(payload) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const MAX_ACK_MS = 1_000; // Must be < 3 000 ms (Slack's hard limit)

describe("POST /api/slack/actions — 3-second timeout guarantee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIncomingRequest.mockReturnValue(true);
    // Reset slackMessageTs so ack-timing tests are unaffected by Slack update calls
    mockDraftRow.slackMessageTs = null;
    mockDraftRow.status = "pending";
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // ── Send action ────────────────────────────────────────────────────────────

  it("acks draft_send within 1 s even when Lemlist takes 5 s", async () => {
    mockSendReply.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 5_000)),
    );

    const start = Date.now();
    const res = await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(MAX_ACK_MS);
  });

  it("acks draft_send within 1 s when Lemlist returns an error after 5 s", async () => {
    mockSendReply.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: false, error: "rate limited" }), 5_000),
        ),
    );

    const start = Date.now();
    const res = await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(MAX_ACK_MS);
  });

  it("acks draft_send within 1 s when Lemlist throws after 5 s", async () => {
    mockSendReply.mockImplementation(
      () =>
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("network timeout")), 5_000),
        ),
    );

    const start = Date.now();
    const res = await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(MAX_ACK_MS);
  });

  // ── Discard action (no Lemlist call — baseline check) ─────────────────────

  it("acks draft_discard within 1 s", async () => {
    const start = Date.now();
    const res = await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_discard"));
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(MAX_ACK_MS);
    expect(mockSendReply).not.toHaveBeenCalled();
  });

  // ── Edit modal submit ──────────────────────────────────────────────────────

  it("acks view_submission (edit modal) within 1 s even when Lemlist takes 5 s", async () => {
    mockSendReply.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 5_000)),
    );

    const start = Date.now();
    const res = await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(viewSubmissionBody());
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(MAX_ACK_MS);
  });

  it("acks view_submission within 1 s when Lemlist throws after 5 s", async () => {
    mockSendReply.mockImplementation(
      () =>
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("connection refused")), 5_000),
        ),
    );

    const start = Date.now();
    const res = await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(viewSubmissionBody());
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(MAX_ACK_MS);
  });

  // ── Signature verification (safety check) ─────────────────────────────────

  it("returns 401 when Slack signature is invalid", async () => {
    mockVerifyIncomingRequest.mockReturnValue(false);

    const res = await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));

    expect(res.status).toBe(401);
  });

  // ── Unknown action ─────────────────────────────────────────────────────────

  it("returns 400 for an unknown action_id", async () => {
    const payload = {
      type: "block_actions",
      user: { id: "U_OPERATOR" },
      team: { id: "T_WORKSPACE" },
      actions: [{ action_id: "draft_unknown_action", value: "1" }],
    };

    const res = await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send({ payload: JSON.stringify(payload) });

    expect(res.status).toBe(400);
  });
});

// ─── Slack error visibility tests ────────────────────────────────────────────
// These tests assert that the operator sees a clear "send_failed" update on the
// Slack card whenever Lemlist silently rejects a send.  They use a draft with a
// real slackMessageTs so the updateMessageAfterAction code-path is exercised.

describe("POST /api/slack/actions — send_failed Slack card update", () => {
  const SLACK_MSG_TS = "C_CHANNEL|1234567890.000100";

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIncomingRequest.mockReturnValue(true);
    // Give the draft a Slack message so the update path fires
    mockDraftRow.slackMessageTs = SLACK_MSG_TS;
    mockDraftRow.status = "pending";
    mockDraftRow.lemlistLeadId = "lea_test123";
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // A production incident: sendReply was called with the prospect's email in
  // place of Lemlist's own lead id, which the API rejects — the draft looked
  // sent, but nothing left Lemlist. Drafts created before lemlist_lead_id
  // existed have no way to send at all, so this must fail loudly rather than
  // call Lemlist with something that is not a lead id.
  it("fails without calling Lemlist when the draft has no lemlistLeadId", async () => {
    mockDraftRow.lemlistLeadId = null;

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));

    await vi.waitFor(() => {
      expect(mockUpdateMessageAfterAction).toHaveBeenCalledWith(
        "C_CHANNEL",
        "1234567890.000100",
        "send_failed",
        "U_OPERATOR",
        undefined,
        expect.stringContaining("predates Lemlist lead tracking"),
      );
    }, { timeout: 2_000 });

    expect(mockSendReply).not.toHaveBeenCalled();
  });

  it("calls updateMessageAfterAction with 'send_failed' when Lemlist returns ok:false (draft_send)", async () => {
    mockSendReply.mockResolvedValue({ ok: false, error: "rate_limited" });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));

    // Background processing runs asynchronously after the ack; poll until it settles
    await vi.waitFor(
      () => {
        expect(mockUpdateMessageAfterAction).toHaveBeenCalledWith(
          "C_CHANNEL",
          "1234567890.000100",
          "send_failed",
          "U_OPERATOR",
          undefined, // botToken (clientRow.slackBotToken is null)
          "rate_limited",
        );
      },
      { timeout: 2_000 },
    );
  });

  it("calls updateMessageAfterAction with 'send_failed' when Lemlist throws (draft_send)", async () => {
    mockSendReply.mockRejectedValue(new Error("network timeout"));

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));

    await vi.waitFor(
      () => {
        expect(mockUpdateMessageAfterAction).toHaveBeenCalledWith(
          "C_CHANNEL",
          "1234567890.000100",
          "send_failed",
          "U_OPERATOR",
          undefined,
          "network timeout",
        );
      },
      { timeout: 2_000 },
    );
  });

  it("calls updateMessageAfterAction with 'send_failed' when Lemlist returns ok:false (edit modal)", async () => {
    mockSendReply.mockResolvedValue({ ok: false, error: "lead_not_found" });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(viewSubmissionBody());

    await vi.waitFor(
      () => {
        expect(mockUpdateMessageAfterAction).toHaveBeenCalledWith(
          "C_CHANNEL",
          "1234567890.000100",
          "send_failed",
          "U_OPERATOR",
          undefined,
          "lead_not_found",
        );
      },
      { timeout: 2_000 },
    );
  });

  it("calls updateMessageAfterAction with 'send_failed' when Lemlist throws (edit modal)", async () => {
    mockSendReply.mockRejectedValue(new Error("connection refused"));

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(viewSubmissionBody());

    await vi.waitFor(
      () => {
        expect(mockUpdateMessageAfterAction).toHaveBeenCalledWith(
          "C_CHANNEL",
          "1234567890.000100",
          "send_failed",
          "U_OPERATOR",
          undefined,
          "connection refused",
        );
      },
      { timeout: 2_000 },
    );
  });

  it("does NOT call updateMessageAfterAction with 'send_failed' when Lemlist succeeds (draft_send)", async () => {
    mockSendReply.mockResolvedValue({ ok: true });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));

    // Wait long enough for background processing to complete
    await vi.waitFor(
      () => {
        expect(mockUpdateMessageAfterAction).toHaveBeenCalledWith(
          "C_CHANNEL",
          "1234567890.000100",
          "sent",
          "U_OPERATOR",
          undefined,
        );
      },
      { timeout: 2_000 },
    );

    // Confirm no send_failed call was made
    const sendFailedCall = mockUpdateMessageAfterAction.mock.calls.find(
      (args) => (args as unknown[])[2] === "send_failed",
    );
    expect(sendFailedCall).toBeUndefined();
  });

  it("calls updateMessageAfterAction with 'send_failed' and 'timeout' error when sendReply times out (draft_send)", async () => {
    mockSendReply.mockResolvedValue({ ok: false, error: "timeout" });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));

    await vi.waitFor(
      () => {
        expect(mockUpdateMessageAfterAction).toHaveBeenCalledWith(
          "C_CHANNEL",
          "1234567890.000100",
          "send_failed",
          "U_OPERATOR",
          undefined,
          "timeout",
        );
      },
      { timeout: 2_000 },
    );
  });

  it("calls updateMessageAfterAction with 'send_failed' and 'timeout' error when sendReply times out (edit modal)", async () => {
    mockSendReply.mockResolvedValue({ ok: false, error: "timeout" });

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(viewSubmissionBody());

    await vi.waitFor(
      () => {
        expect(mockUpdateMessageAfterAction).toHaveBeenCalledWith(
          "C_CHANNEL",
          "1234567890.000100",
          "send_failed",
          "U_OPERATOR",
          undefined,
          "timeout",
        );
      },
      { timeout: 2_000 },
    );
  });

  it("background process survives when updateMessageAfterAction throws after Lemlist failure", async () => {
    mockSendReply.mockResolvedValue({ ok: false, error: "rate_limited" });
    mockUpdateMessageAfterAction.mockRejectedValue(new Error("Slack token revoked"));

    // Should ack 200 regardless
    const res = await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));

    expect(res.status).toBe(200);

    // The background process should have attempted the Slack update
    await vi.waitFor(
      () => {
        expect(mockUpdateMessageAfterAction).toHaveBeenCalledWith(
          "C_CHANNEL",
          "1234567890.000100",
          "send_failed",
          "U_OPERATOR",
          undefined,
          "rate_limited",
        );
      },
      { timeout: 2_000 },
    );
  });

  // ── Fallback DM when Slack card update fails ───────────────────────────────

  it("sends fallback DM when updateMessageAfterAction rejects after Lemlist failure (draft_send)", async () => {
    mockSendReply.mockResolvedValue({ ok: false, error: "rate_limited" });
    mockUpdateMessageAfterAction.mockRejectedValue(new Error("token_revoked"));

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));

    await vi.waitFor(
      () => {
        expect(mockPostFallbackFailureNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "U_OPERATOR",
            channelId: "C_CHANNEL",
            draftId: 1,
            lemlistError: "rate_limited",
            cardUpdateError: "token_revoked",
          }),
        );
      },
      { timeout: 2_000 },
    );
  });

  it("sends fallback DM when updateMessageAfterAction rejects after Lemlist failure (edit modal)", async () => {
    mockSendReply.mockResolvedValue({ ok: false, error: "lead_not_found" });
    mockUpdateMessageAfterAction.mockRejectedValue(new Error("channel_not_found"));

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(viewSubmissionBody());

    await vi.waitFor(
      () => {
        expect(mockPostFallbackFailureNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "U_OPERATOR",
            channelId: "C_CHANNEL",
            draftId: 1,
            lemlistError: "lead_not_found",
            cardUpdateError: "channel_not_found",
          }),
        );
      },
      { timeout: 2_000 },
    );
  });

  it("sends fallback DM when updateMessageAfterAction rejects after draft_escalate", async () => {
    mockDraftRow.slackMessageTs = "C_CHANNEL|1234567890.123456";
    mockUpdateMessageAfterAction.mockRejectedValue(new Error("token_revoked"));

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_escalate"));

    await vi.waitFor(
      () => {
        expect(mockPostFallbackFailureNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "U_OPERATOR",
            channelId: "C_CHANNEL",
            draftId: 1,
            cardUpdateError: "token_revoked",
          }),
        );
      },
      { timeout: 2_000 },
    );
  });

  it("does NOT call postFallbackFailureNotification when updateMessageAfterAction succeeds (draft_send)", async () => {
    mockSendReply.mockResolvedValue({ ok: false, error: "rate_limited" });
    mockUpdateMessageAfterAction.mockResolvedValue(undefined);

    await request(app)
      .post("/api/slack/actions")
      .type("form")
      .send(blockActionBody("draft_send"));

    await vi.waitFor(
      () => {
        expect(mockUpdateMessageAfterAction).toHaveBeenCalled();
      },
      { timeout: 2_000 },
    );

    expect(mockPostFallbackFailureNotification).not.toHaveBeenCalled();
  });
});

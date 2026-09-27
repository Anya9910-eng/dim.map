/**
 * Edit modal — end-to-end integration tests
 *
 * Covers the full Edit → modal → submit → Lemlist → Slack update flow,
 * including the four critical branches:
 *
 *  1. Modal opens with the correct pre-populated text
 *  2. Empty submission returns a validation error (modal stays open)
 *  3. Successful submit saves editedReplyText and marks draft sent
 *  4. Lemlist failure — draft marked send_failed and Slack updated with error
 *
 * Note on "pending vs send_failed": the task description loosely says "leaves
 * draft pending" on Lemlist failure.  The actual production code in
 * processEditSubmission writes status "send_failed" (not "pending") so
 * operators can surface and retry the failure.  These tests confirm the
 * implemented behaviour, which is the correct product intent.
 *
 * Strategy: mocks resolve immediately so processEditSubmission completes
 * within a short flushAsync() window, letting us assert the final DB and
 * Slack call state without artificial delays.
 */

import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

// ─── Hoisted shared state ─────────────────────────────────────────────────────
// vi.mock factories are hoisted above all imports, so shared mutable state
// must be defined with vi.hoisted() so factories can close over it.

const mocks = vi.hoisted(() => {
  const draftRow = {
    id: 1,
    status: "pending" as string,
    clientId: 1,
    campaignId: 1,
    prospectEmail: "lead@example.com",
    lemlistLeadId: "lea_test123",
    prospectName: "Test Lead",
    prospectCompany: "Acme Corp",
    prospectCountry: "US",
    replyText: "Original AI reply",
    editedReplyText: null as string | null,
    slackMessageTs: "C123|1234567890.123456" as string | null,
    actionedAt: null,
  };

  const campaignRow = {
    current: { id: 1, name: "Test Campaign", lemlistCampaignId: "cam_abc123" } as
      | { id: number; name: string; lemlistCampaignId: string }
      | null,
  };

  return {
    draftRow,
    campaignRow,
    dbUpdateSets: [] as object[],
    dbInsertValues: [] as object[],
    sendReply: vi.fn<() => Promise<{ ok: boolean; error?: string }>>(),
    verifyIncomingRequest: vi.fn(() => true),
    updateMessageAfterAction: vi.fn<
      (...args: unknown[]) => Promise<void>
    >(() => Promise.resolve()),
    openEditModal: vi.fn(() => Promise.resolve()),
    postEphemeral: vi.fn(() => Promise.resolve()),
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
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
  postApprovalCard: vi.fn(() => Promise.resolve("ts123")),
  postTestMessage: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock("@workspace/db", () => {
  const draftsTable = { _name: "drafts" };
  const campaignsTable = { _name: "campaigns" };
  const clientsTable = { _name: "clients" };
  const logsTable = { _name: "logs" };
  const activityTable = { _name: "activity" };

  const clientRow = { id: 1, slackBotToken: null };

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
            if (table === campaignsTable) {
              const row = mocks.campaignRow.current;
              return Promise.resolve(row ? [row] : []);
            }
            if (table === clientsTable) return Promise.resolve([clientRow]);
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
    },
  };
});

// ─── App import (must come after vi.mock calls) ───────────────────────────────

import request from "supertest";
import app from "../app";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function editActionPayload(draftId = 1) {
  return {
    payload: JSON.stringify({
      type: "block_actions",
      user: { id: "U_OPERATOR" },
      team: { id: "T_WORKSPACE" },
      trigger_id: "trigger.abc.123",
      channel: { id: "C123" },
      actions: [{ action_id: "draft_edit", value: String(draftId) }],
    }),
  };
}

function viewSubmissionPayload(draftId = 1, text = "Updated reply text") {
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
            reply_text_block: {
              reply_text: { value: text },
            },
          },
        },
      },
    }),
  };
}

/** Yield to the microtask queue so fire-and-forget async work can finish. */
function flushAsync(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Edit modal flow — end-to-end integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyIncomingRequest.mockReturnValue(true);
    mocks.sendReply.mockResolvedValue({ ok: true });
    mocks.updateMessageAfterAction.mockResolvedValue(undefined);
    mocks.openEditModal.mockResolvedValue(undefined);
    mocks.postEphemeral.mockResolvedValue(undefined);

    // Reset draft row to a clean pending state before each test
    mocks.draftRow.status = "pending";
    mocks.draftRow.editedReplyText = null;
    mocks.draftRow.slackMessageTs = "C123|1234567890.123456";
    mocks.campaignRow.current = { id: 1, name: "Test Campaign", lemlistCampaignId: "cam_abc123" };
    mocks.dbUpdateSets.length = 0;
    mocks.dbInsertValues.length = 0;
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Modal opens with the correct pre-populated text ─────────────────────

  describe("draft_edit block action — opening the modal", () => {
    it("pre-populates the modal with editedReplyText when it exists", async () => {
      mocks.draftRow.editedReplyText = "Tweaked reply from last time";

      const res = await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(editActionPayload());

      expect(res.status).toBe(200);
      await flushAsync();

      expect(mocks.openEditModal).toHaveBeenCalledOnce();
      expect(mocks.openEditModal).toHaveBeenCalledWith(
        expect.objectContaining({
          draftId: 1,
          currentText: "Tweaked reply from last time",
          triggerId: "trigger.abc.123",
        }),
      );
    });

    it("pre-populates the modal with replyText when editedReplyText is null", async () => {
      mocks.draftRow.editedReplyText = null;

      const res = await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(editActionPayload());

      expect(res.status).toBe(200);
      await flushAsync();

      expect(mocks.openEditModal).toHaveBeenCalledOnce();
      expect(mocks.openEditModal).toHaveBeenCalledWith(
        expect.objectContaining({
          draftId: 1,
          currentText: "Original AI reply",
        }),
      );
    });

    it("sends an ephemeral message instead of opening the modal when the draft is already sent", async () => {
      mocks.draftRow.status = "sent";

      const res = await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(editActionPayload());

      expect(res.status).toBe(200);
      await flushAsync();

      expect(mocks.openEditModal).not.toHaveBeenCalled();
      expect(mocks.postEphemeral).toHaveBeenCalledOnce();
      expect(mocks.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("already been sent"),
        }),
      );
    });

    it("sends an ephemeral message instead of opening the modal when the draft is discarded", async () => {
      mocks.draftRow.status = "discarded";

      const res = await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(editActionPayload());

      expect(res.status).toBe(200);
      await flushAsync();

      expect(mocks.openEditModal).not.toHaveBeenCalled();
      expect(mocks.postEphemeral).toHaveBeenCalledOnce();
      expect(mocks.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("already been discarded"),
        }),
      );
    });

    it("sends an ephemeral message instead of opening the modal when the draft is already edited and sent", async () => {
      mocks.draftRow.status = "edited";

      const res = await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(editActionPayload());

      expect(res.status).toBe(200);
      await flushAsync();

      expect(mocks.openEditModal).not.toHaveBeenCalled();
      expect(mocks.postEphemeral).toHaveBeenCalledOnce();
      expect(mocks.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("already been edited and sent"),
        }),
      );
    });
  });

  // ── 2. Empty submission returns validation error ───────────────────────────

  describe("view_submission — empty text validation", () => {
    it("returns a modal validation error for an empty reply text", async () => {
      const res = await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(viewSubmissionPayload(1, ""));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        response_action: "errors",
        errors: { reply_text_block: "Reply text cannot be empty." },
      });
      expect(mocks.sendReply).not.toHaveBeenCalled();
    });

    it("returns a validation error for whitespace-only reply text", async () => {
      const res = await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(viewSubmissionPayload(1, "   \n  \t  "));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        response_action: "errors",
        errors: { reply_text_block: "Reply text cannot be empty." },
      });
      expect(mocks.sendReply).not.toHaveBeenCalled();
    });
  });

  // ── 3. Successful submit saves editedReplyText and marks draft sent ─────────

  describe("view_submission — successful send", () => {
    it("saves editedReplyText, calls Lemlist with edited text, and marks draft sent", async () => {
      const res = await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(viewSubmissionPayload(1, "Polished reply text"));

      // Ack must come back immediately (closes the modal)
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});

      await flushAsync();

      // editedReplyText must be persisted
      expect(mocks.dbUpdateSets).toContainEqual(
        expect.objectContaining({ editedReplyText: "Polished reply text" }),
      );

      // Lemlist called with the edited text and correct campaign
      expect(mocks.sendReply).toHaveBeenCalledOnce();
      expect(mocks.sendReply).toHaveBeenCalledWith(
        expect.objectContaining({
          replyText: "Polished reply text",
          campaignId: "cam_abc123",
          leadId: "lea_test123",
        }),
      );

      // Draft marked as sent (not send_failed)
      expect(mocks.dbUpdateSets).toContainEqual(
        expect.objectContaining({ status: "sent" }),
      );
      expect(mocks.dbUpdateSets).not.toContainEqual(
        expect.objectContaining({ status: "send_failed" }),
      );

      // Slack message updated to "edited" with the final text
      expect(mocks.updateMessageAfterAction).toHaveBeenCalledWith(
        "C123",
        "1234567890.123456",
        "edited",
        "U_OPERATOR",
        undefined,
        undefined,
        "Polished reply text",
      );
    });

    it("ignores resubmission and does not call Lemlist when draft is already actioned", async () => {
      mocks.draftRow.status = "sent";

      await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(viewSubmissionPayload(1, "Some text"));

      await flushAsync();

      // processEditSubmission bails on the idempotency guard
      expect(mocks.sendReply).not.toHaveBeenCalled();
      expect(mocks.dbUpdateSets).not.toContainEqual(
        expect.objectContaining({ status: "sent" }),
      );
    });
  });

  // ── 4a. Lemlist failure leaves draft send_failed and updates Slack ─────────
  //
  // The task description loosely says "leaves draft pending" but the
  // implementation writes "send_failed" so operators can surface and retry
  // the failure from the dashboard.  These tests confirm that behaviour.

  describe("view_submission — Lemlist failure", () => {
    it("marks draft send_failed and posts error to Slack when Lemlist returns ok: false", async () => {
      mocks.sendReply.mockResolvedValue({ ok: false, error: "rate_limited" });

      const res = await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(viewSubmissionPayload(1, "Retry reply text"));

      expect(res.status).toBe(200);
      await flushAsync();

      // editedReplyText still saved even on failure
      expect(mocks.dbUpdateSets).toContainEqual(
        expect.objectContaining({ editedReplyText: "Retry reply text" }),
      );

      // Draft marked send_failed, not sent
      expect(mocks.dbUpdateSets).toContainEqual(
        expect.objectContaining({ status: "send_failed" }),
      );
      expect(mocks.dbUpdateSets).not.toContainEqual(
        expect.objectContaining({ status: "sent" }),
      );

      // Slack card updated with the error
      expect(mocks.updateMessageAfterAction).toHaveBeenCalledWith(
        "C123",
        "1234567890.123456",
        "send_failed",
        "U_OPERATOR",
        undefined,
        "rate_limited",
      );

      // Activity log written for the failure
      expect(mocks.dbInsertValues).toContainEqual(
        expect.objectContaining({ type: "draft_send_failed" }),
      );
    });

    it("marks draft send_failed and posts error to Slack when Lemlist throws", async () => {
      mocks.sendReply.mockRejectedValue(new Error("connection timeout"));

      const res = await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(viewSubmissionPayload(1, "Another reply"));

      expect(res.status).toBe(200);
      await flushAsync();

      expect(mocks.dbUpdateSets).toContainEqual(
        expect.objectContaining({ status: "send_failed" }),
      );

      expect(mocks.updateMessageAfterAction).toHaveBeenCalledWith(
        "C123",
        "1234567890.123456",
        "send_failed",
        "U_OPERATOR",
        undefined,
        "connection timeout",
      );
    });
  });

  // ── 4b. Campaign not found — edit modal submit bails without calling Lemlist

  describe("view_submission — campaign not found", () => {
    it("saves editedReplyText, skips Lemlist, and updates Slack with send_failed when campaign is missing", async () => {
      // Simulate a draft whose campaign has been deleted
      mocks.campaignRow.current = null;

      const res = await request(app)
        .post("/api/slack/actions")
        .type("form")
        .send(viewSubmissionPayload(1, "Edited text no campaign"));

      expect(res.status).toBe(200);
      await flushAsync();

      // editedReplyText persisted regardless
      expect(mocks.dbUpdateSets).toContainEqual(
        expect.objectContaining({ editedReplyText: "Edited text no campaign" }),
      );

      // Lemlist must NOT be called — we can't send without a campaign
      expect(mocks.sendReply).not.toHaveBeenCalled();

      // Slack card updated with the "Campaign not found" error
      expect(mocks.updateMessageAfterAction).toHaveBeenCalledWith(
        "C123",
        "1234567890.123456",
        "send_failed",
        "U_OPERATOR",
        undefined,
        "Campaign not found",
      );
    });
  });
});

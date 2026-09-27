/**
 * applyDraftAction — activity cleanup tests for send_failed retry path
 *
 * Confirms that PATCH /api/drafts/:id/action, when called against a
 * send_failed draft, deletes the stale draft_send_failed activity entry
 * before inserting the success entry — leaving exactly one activity row
 * per draft, matching the same guarantee already provided by the Slack
 * action handler (slack.retry.test.ts).
 */

import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

// ─── Hoisted shared state ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const draftRow = {
    id: 55,
    status: "send_failed" as string,
    clientId: 1,
    campaignId: 1,
    prospectEmail: "action@example.com",
    lemlistLeadId: "lea_test55",
    prospectName: "Action Lead",
    prospectCompany: "Action Corp",
    prospectCountry: "US",
    replyText: "AI draft",
    editedReplyText: null as string | null,
    slackMessageTs: null as string | null,
    actionedAt: null,
    createdAt: new Date("2026-07-21T10:00:00Z"),
  };

  const campaignRow = { id: 1, name: "Action Campaign", lemlistCampaignId: "cam_test" };

  return {
    draftRow,
    campaignRow,
    dbUpdateSets: [] as object[],
    dbInsertValues: [] as object[],
    dbDeleteWheres: [] as unknown[],
    dbReturningRows: [] as object[],
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
}));

vi.mock("../lib/slack", () => ({
  postApprovalCard: vi.fn(() => Promise.resolve("ts_new")),
  isSlackConfigured: vi.fn(() => false),
  updateMessageAfterAction: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/lemlist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/lemlist")>();
  return {
    ...actual,
    sendReply: vi.fn(() => Promise.resolve({ ok: true })),
  };
});


vi.mock("@workspace/db", () => {
  const draftsTable = { _name: "drafts" };
  const campaignsTable = { _name: "campaigns" };
  const clientsTable = { _name: "clients" };
  const activityTable = { _name: "activity" };
  const personasTable = { _name: "personas" };

  return {
    draftsTable,
    campaignsTable,
    clientsTable,
    activityTable,
    personasTable,
    db: {
      select: () => ({
        from: (table: object) => ({
          where: () => {
            if (table === draftsTable) return Promise.resolve([{ ...mocks.draftRow }]);
            if (table === campaignsTable) return Promise.resolve([{ ...mocks.campaignRow }]);
            return Promise.resolve([]);
          },
        }),
      }),
      update: (_table: object) => ({
        set: (values: object) => {
          mocks.dbUpdateSets.push(values);
          return {
            where: () => ({
              returning: () => {
                const updated = { ...mocks.draftRow, ...values };
                return Promise.resolve([updated]);
              },
            }),
          };
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

// The /api router is gated by requireOperator, so these route tests need an
// operator session; the real store-backed session would need Postgres.
vi.mock("express-session", async () =>
  (await import("../testing/sessionMock")).expressSessionMock());

// ─── App import (after all vi.mock calls) ─────────────────────────────────────

import request from "supertest";
import app from "../app";
import { loginAsOperator } from "../testing/sessionMock";
import { sendReply as mockSendReply } from "../lib/lemlist";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PATCH /api/drafts/:id/action — send_failed retry cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginAsOperator();
    mocks.draftRow.status = "send_failed";
    mocks.draftRow.editedReplyText = null;
    mocks.dbUpdateSets.length = 0;
    mocks.dbInsertValues.length = 0;
    mocks.dbDeleteWheres.length = 0;
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("deletes stale draft_send_failed activity when send_failed draft is sent via web action", async () => {
    const res = await request(app)
      .patch("/api/drafts/55/action")
      .send({ action: "send" });

    expect(res.status).toBe(200);
    expect(mocks.dbDeleteWheres).toHaveLength(1);
  });

  it("inserts draft_sent (not draft_send_failed) activity after successful web-action retry", async () => {
    await request(app)
      .patch("/api/drafts/55/action")
      .send({ action: "send" });

    const insertedTypes = mocks.dbInsertValues
      .map((v) => (v as { type?: string }).type)
      .filter(Boolean);

    expect(insertedTypes).toContain("draft_sent");
    expect(insertedTypes).not.toContain("draft_send_failed");
  });

  it("scopes the delete to the correct draftId and type", async () => {
    await request(app)
      .patch("/api/drafts/55/action")
      .send({ action: "send" });

    type DeleteCondition = { _and: Array<{ _val: unknown }> };
    const condition = mocks.dbDeleteWheres[0] as DeleteCondition;
    const vals = condition._and.map((a) => a._val);

    expect(vals).toContain(55);
    expect(vals).toContain("draft_send_failed");
  });

  it("activity feed ends up with exactly one draft_sent and no draft_send_failed after web retry", async () => {
    await request(app)
      .patch("/api/drafts/55/action")
      .send({ action: "send" });

    // Exactly one delete for the stale failure entry
    expect(mocks.dbDeleteWheres).toHaveLength(1);

    const activityInserts = mocks.dbInsertValues.filter(
      (v) =>
        (v as { type?: string }).type === "draft_sent" ||
        (v as { type?: string }).type === "draft_send_failed",
    );

    const sentInserts = activityInserts.filter(
      (v) => (v as { type?: string }).type === "draft_sent",
    );
    expect(sentInserts).toHaveLength(1);
    expect((sentInserts[0] as { draftId?: number }).draftId).toBe(55);

    const failedInserts = activityInserts.filter(
      (v) => (v as { type?: string }).type === "draft_send_failed",
    );
    expect(failedInserts).toHaveLength(0);
  });

  it("does NOT delete any activity entry when a plain pending draft is sent (no prior failure)", async () => {
    mocks.draftRow.status = "pending";

    await request(app)
      .patch("/api/drafts/55/action")
      .send({ action: "send" });

    expect(mocks.dbDeleteWheres).toHaveLength(0);
  });

  it("does NOT delete activity when discarding a pending draft", async () => {
    mocks.draftRow.status = "pending";

    await request(app)
      .patch("/api/drafts/55/action")
      .send({ action: "discard" });

    expect(mocks.dbDeleteWheres).toHaveLength(0);
    const insertedTypes = mocks.dbInsertValues.map((v) => (v as { type?: string }).type).filter(Boolean);
    expect(insertedTypes).toContain("draft_discarded");
  });

  it("also cleans up activity when a send_failed draft is discarded via web action", async () => {
    // Operator gives up on a failed draft — still need clean activity feed
    await request(app)
      .patch("/api/drafts/55/action")
      .send({ action: "discard" });

    expect(mocks.dbDeleteWheres).toHaveLength(1);

    type DeleteCondition = { _and: Array<{ _val: unknown }> };
    const condition = mocks.dbDeleteWheres[0] as DeleteCondition;
    const vals = condition._and.map((a) => a._val);
    expect(vals).toContain(55);
    expect(vals).toContain("draft_send_failed");
  });
});

// A production incident: this route flipped a draft's status to "sent" by
// itself, without ever calling Lemlist — the dashboard Send button gave a
// false confirmation while the reply never reached the lead. These tests
// cover the fix directly, separately from the send_failed cleanup above.
describe("PATCH /api/drafts/:id/action — send actually calls Lemlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginAsOperator();
    mocks.draftRow.status = "pending";
    mocks.draftRow.lemlistLeadId = "lea_test55";
    mocks.draftRow.editedReplyText = null;
    mocks.dbUpdateSets.length = 0;
    mocks.dbInsertValues.length = 0;
    mocks.dbDeleteWheres.length = 0;
    (mockSendReply as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("calls Lemlist with the draft's own lead id before marking it sent", async () => {
    const res = await request(app).patch("/api/drafts/55/action").send({ action: "send" });

    expect(res.status).toBe(200);
    expect(mockSendReply).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "lea_test55", campaignId: "cam_test" }),
    );
    expect(mocks.dbUpdateSets).toContainEqual(expect.objectContaining({ status: "sent" }));
  });

  it("sends the edited text, not the original draft, when one exists", async () => {
    mocks.draftRow.editedReplyText = "A better reply";

    await request(app).patch("/api/drafts/55/action").send({ action: "send" });

    expect(mockSendReply).toHaveBeenCalledWith(expect.objectContaining({ replyText: "A better reply" }));
  });

  it("marks the draft send_failed, not sent, when Lemlist rejects the send", async () => {
    (mockSendReply as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: "rate_limited" });

    const res = await request(app).patch("/api/drafts/55/action").send({ action: "send" });

    expect(res.status).toBe(502);
    expect(mocks.dbUpdateSets).toContainEqual(expect.objectContaining({ status: "send_failed" }));
    expect(mocks.dbUpdateSets).not.toContainEqual(expect.objectContaining({ status: "sent" }));
  });

  it("refuses to send a draft with no lemlistLeadId, without calling Lemlist", async () => {
    // Drafts created before this column existed have nothing to send
    // against, and there is no way to recover the id after the fact.
    mocks.draftRow.lemlistLeadId = null as unknown as string;

    const res = await request(app).patch("/api/drafts/55/action").send({ action: "send" });

    expect(res.status).toBe(422);
    expect(mockSendReply).not.toHaveBeenCalled();
    expect(mocks.dbUpdateSets).not.toContainEqual(expect.objectContaining({ status: "sent" }));
  });

  it("refuses to act on a draft that was already sent", async () => {
    // The status check that keeps a stale dashboard tab from re-sending.
    mocks.draftRow.status = "sent";

    const res = await request(app).patch("/api/drafts/55/action").send({ action: "send" });

    expect(res.status).toBe(409);
    expect(mockSendReply).not.toHaveBeenCalled();
  });
});

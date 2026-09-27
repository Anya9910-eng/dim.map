/**
 * A reply with no email address must not be sent through Lemlist's email
 * endpoint.
 *
 * The Lemlist webhook subscribes to linkedinReplied as well as emailsReplied,
 * so a LinkedIn reply produces a perfectly normal-looking draft with an empty
 * prospect_email. Pressing Send on it would post to /inbox/email for someone
 * who never gave an address. One such draft exists in production.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

const { state, mockSendReply } = vi.hoisted(() => ({
  state: { draft: {} as Record<string, unknown> },
  mockSendReply: vi.fn(async () => ({ ok: true })),
}));

vi.mock("express-session", async () =>
  (await import("../testing/sessionMock")).expressSessionMock());

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((c: unknown, v: unknown) => ({ _eq: [c, v] })),
  ne: vi.fn(() => ({})), and: vi.fn((...a: unknown[]) => ({ _and: a })),
  gte: vi.fn(() => ({})), desc: vi.fn(() => ({})),
  sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn() }),
}));

vi.mock("../lib/lemlist", async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  sendReply: mockSendReply,
}));

vi.mock("../lib/slack", async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  updateMessageAfterAction: vi.fn(async () => undefined),
  postApprovalCard: vi.fn(async () => null),
}));

vi.mock("@workspace/db", () => {
  const draftsTable = { _name: "drafts" }, campaignsTable = { _name: "campaigns" };
  const clientsTable = { _name: "clients" }, activityTable = { _name: "activity" };
  const logsTable = { _name: "logs" }, personasTable = { _name: "personas" };
  return {
    draftsTable, campaignsTable, clientsTable, activityTable, logsTable, personasTable,
    db: {
      select: () => ({ from: (t: object) => ({
        where: () => {
          if (t === draftsTable) return Promise.resolve([state.draft]);
          if (t === campaignsTable) return Promise.resolve([{ id: 4, lemlistCampaignId: "cam_x", name: "Main" }]);
          if (t === clientsTable) return Promise.resolve([{ id: 12, lemlistApiKey: "k", slackBotToken: null }]);
          return Promise.resolve([]);
        },
        orderBy: () => Promise.resolve([]), limit: () => Promise.resolve([]),
      }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([state.draft]) }) }) }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
    },
  };
});

import request from "supertest";
import app from "../app";
import { loginAsOperator } from "../testing/sessionMock";

const base = {
  id: 18, clientId: 12, campaignId: 4, status: "pending",
  prospectName: "Kim Barrow", prospectCompany: "", prospectCountry: null,
  replyText: "Hi Kim, happy to help.", editedReplyText: null,
  conversationSnippet: "Hi Jash,", slackMessageTs: null,
  lemlistLeadId: "lea_kim", createdAt: new Date(),
};

beforeEach(() => { loginAsOperator(); vi.clearAllMocks(); });

describe("sending a draft with no email address", () => {
  it("is refused, and Lemlist is never called", async () => {
    state.draft = { ...base, prospectEmail: "" };

    const res = await request(app).patch("/api/drafts/18/action").send({ action: "send" });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/without an email address/);
    expect(mockSendReply).not.toHaveBeenCalled();
  });

  it("is refused for whitespace too, not just empty string", async () => {
    state.draft = { ...base, prospectEmail: "   " };

    const res = await request(app).patch("/api/drafts/18/action").send({ action: "send" });

    expect(res.status).toBe(422);
    expect(mockSendReply).not.toHaveBeenCalled();
  });

  it("still sends normally when an address is present", async () => {
    state.draft = { ...base, prospectEmail: "kim@example.com" };

    const res = await request(app).patch("/api/drafts/18/action").send({ action: "send" });

    expect(res.status).toBe(200);
    expect(mockSendReply).toHaveBeenCalledOnce();
  });

  // Discarding is how a client clears one of these out, so it must not be
  // caught by a guard that only concerns sending.
  it("can still be discarded without an address", async () => {
    state.draft = { ...base, prospectEmail: "" };

    const res = await request(app).patch("/api/drafts/18/action").send({ action: "discard" });

    expect(res.status).toBe(200);
    expect(mockSendReply).not.toHaveBeenCalled();
  });
});

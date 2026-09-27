/**
 * Slack channel-binding endpoint tests
 *
 * Covers the new binding surface added for the Slack Channel Binding feature:
 *   - GET  /api/slack/workspace          — connection status
 *   - GET  /api/slack/channels           — channel discovery
 *   - GET  /api/slack/verify-access      — bot access check before saving
 *   - POST /api/slack/test-approval-card — TEST card (validated body)
 *   - POST /api/slack/actions            — TEST card buttons have NO side effects
 *
 * The critical safety assertion: clicking a TEST-card button never calls Lemlist
 * (sendReply) and never mutates a draft — it only acks + updates the card.
 */

import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

const {
  mockSendReply,
  mockVerifyIncomingRequest,
  mockGetWorkspaceStatus,
  mockListChannels,
  mockVerifyBotAccess,
  mockPostTestApprovalCard,
  mockUpdateTestCardAfterAction,
  mockPostEphemeral,
} = vi.hoisted(() => ({
  mockSendReply: vi.fn(() => Promise.resolve({ ok: true })),
  mockVerifyIncomingRequest: vi.fn(() => true),
  mockGetWorkspaceStatus: vi.fn(() =>
    Promise.resolve({
      connected: true,
      teamName: "EPIC STAR AI",
      teamId: "T123",
      url: "https://epicstarai.slack.com/",
      botUserId: "U_BOT",
      error: null,
    }),
  ),
  mockListChannels: vi.fn(() =>
    Promise.resolve([
      { id: "C0BK6NPBHKJ", name: "draftfly-approvals", isPrivate: false, isMember: true, isArchived: false },
      { id: "C0OTHER1234", name: "general", isPrivate: false, isMember: false, isArchived: false },
    ]),
  ),
  mockVerifyBotAccess: vi.fn(() =>
    Promise.resolve({ ok: true, isMember: true, name: "draftfly-approvals", error: null }),
  ),
  mockPostTestApprovalCard: vi.fn(() => Promise.resolve({ ok: true, ts: "1700000000.000100" })),
  mockUpdateTestCardAfterAction: vi.fn(() => Promise.resolve()),
  mockPostEphemeral: vi.fn(() => Promise.resolve()),
}));

// These cases exercise endpoint behaviour, not the auth gate — let the operator
// middleware through. Authorization itself is covered in operator-auth.test.ts.
vi.mock("express-session", async () =>
  (await import("../testing/sessionMock")).expressSessionMock());

vi.mock("../middleware/requireOperator", () => ({
  requireOperator: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
}));

vi.mock("../lib/lemlist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/lemlist")>();
  return { ...actual, sendReply: mockSendReply, isLemlistConfigured: () => true };
});

vi.mock("../lib/slack", () => ({
  verifyIncomingRequest: mockVerifyIncomingRequest,
  getWorkspaceStatus: mockGetWorkspaceStatus,
  listChannels: mockListChannels,
  verifyBotAccess: mockVerifyBotAccess,
  postTestApprovalCard: mockPostTestApprovalCard,
  updateTestCardAfterAction: mockUpdateTestCardAfterAction,
  postEphemeral: mockPostEphemeral,
  // Other exports the route imports — stubbed so the module loads.
  updateMessageAfterAction: vi.fn(() => Promise.resolve()),
  postFallbackFailureNotification: vi.fn(() => Promise.resolve()),
  postApprovalCard: vi.fn(() => Promise.resolve("ts123")),
  openEditModal: vi.fn(() => Promise.resolve()),
  postEscalationAlert: vi.fn(() => Promise.resolve()),
  postTestMessage: vi.fn(() => Promise.resolve({ ok: true })),
  isSlackConfigured: vi.fn(() => true),
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
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
      insert: () => ({ values: () => Promise.resolve(undefined) }),
      delete: () => ({ where: () => Promise.resolve(undefined) }),
    },
  };
});

import request from "supertest";
import app from "../app";
import { loginAsOperator } from "../testing/sessionMock";

function testCardActionBody(actionId: "draft_send" | "draft_edit" | "draft_discard") {
  const payload = {
    type: "block_actions",
    user: { id: "U_OPERATOR" },
    team: { id: "T123" },
    trigger_id: "trigger.abc.123",
    channel: { id: "C0BK6NPBHKJ" },
    message: { ts: "1700000000.000100" },
    actions: [{ action_id: actionId, block_id: "draft_test", value: "test" }],
  };
  return { payload: JSON.stringify(payload) };
}

describe("Slack channel-binding endpoints", () => {
  beforeEach(() => {
    loginAsOperator();
    vi.clearAllMocks();
    mockVerifyIncomingRequest.mockReturnValue(true);
  });
  afterAll(() => vi.restoreAllMocks());

  it("GET /api/slack/workspace returns connection status", async () => {
    const res = await request(app).get("/api/slack/workspace");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, teamName: "EPIC STAR AI" });
  });

  it("GET /api/slack/channels returns channels the bot can see", async () => {
    const res = await request(app).get("/api/slack/channels");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: "C0BK6NPBHKJ", name: "draftfly-approvals", isMember: true });
  });

  it("GET /api/slack/verify-access requires a channelId", async () => {
    const res = await request(app).get("/api/slack/verify-access");
    expect(res.status).toBe(400);
    expect(mockVerifyBotAccess).not.toHaveBeenCalled();
  });

  it("GET /api/slack/verify-access returns the access check for a channel", async () => {
    const res = await request(app).get("/api/slack/verify-access").query({ channelId: "C0BK6NPBHKJ" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, isMember: true });
    expect(mockVerifyBotAccess).toHaveBeenCalledWith("C0BK6NPBHKJ");
  });

  it("POST /api/slack/test-approval-card rejects a non-Slack-ID channel with 422", async () => {
    const res = await request(app).post("/api/slack/test-approval-card").send({ channelId: "#general" });
    expect(res.status).toBe(422);
    expect(mockPostTestApprovalCard).not.toHaveBeenCalled();
  });

  it("POST /api/slack/test-approval-card sends a test card for a valid channel ID", async () => {
    const res = await request(app).post("/api/slack/test-approval-card").send({ channelId: "C0BK6NPBHKJ" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(mockPostTestApprovalCard).toHaveBeenCalledWith("C0BK6NPBHKJ");
  });
});

describe("POST /api/slack/actions — TEST card has no side effects", () => {
  beforeEach(() => {
    loginAsOperator();
    vi.clearAllMocks();
    mockVerifyIncomingRequest.mockReturnValue(true);
  });
  afterAll(() => vi.restoreAllMocks());

  it("acks a TEST 'Send Reply' click WITHOUT calling Lemlist", async () => {
    const res = await request(app).post("/api/slack/actions").type("form").send(testCardActionBody("draft_send"));
    expect(res.status).toBe(200);
    // Give the fire-and-forget handlers a tick to run.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSendReply).not.toHaveBeenCalled();
    expect(mockUpdateTestCardAfterAction).toHaveBeenCalledTimes(1);
    expect(mockPostEphemeral).toHaveBeenCalledTimes(1);
  });

  it("acks a TEST 'Discard' click WITHOUT calling Lemlist", async () => {
    const res = await request(app).post("/api/slack/actions").type("form").send(testCardActionBody("draft_discard"));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSendReply).not.toHaveBeenCalled();
    expect(mockUpdateTestCardAfterAction).toHaveBeenCalledTimes(1);
  });
});

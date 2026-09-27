/**
 * Operator authorization tests for the Slack Channel Binding surface.
 *
 * These mount the REAL routers and the REAL `requireOperator` middleware (only
 * the DB is mocked) on a minimal Express app with an injectable session, so we
 * assert the actual wiring:
 *   - no session at all      -> 401
 *   - a client user's session -> 403
 *   - an operator's session   -> passes the gate
 *
 * The client-user case is the one worth having. `requireOperator` used to
 * compare the session's Slack `teamId` against the allowed workspace and check
 * nothing else, so an invited client who was also a guest in that workspace
 * satisfied it and reached operator-only routes. Gating on `role` is what
 * closes that, and this test is what keeps it closed.
 */

import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";

// Minimal DB mock shared by the slack + clients routers.
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
}));

const { mockUpdateReturning } = vi.hoisted(() => ({
  mockUpdateReturning: vi.fn(() =>
    Promise.resolve([
      {
        id: 1,
        name: "Acme",
        company: "Acme Corp",
        slackChannel: "C0BK6NPBHKJ",
        slackWorkspaceId: null,
        slackBotToken: null,
        mode: "draft" as const,
        lemlistApiKey: null,
        n8nWebhookUrl: null,
        isActive: true,
        createdAt: new Date("2024-01-01"),
      },
    ]),
  ),
}));

vi.mock("@workspace/db", () => {
  const clientsTable = { _name: "clients" };
  return {
    clientsTable,
    draftsTable: { _name: "drafts" },
    campaignsTable: { _name: "campaigns" },
    logsTable: { _name: "logs" },
    activityTable: { _name: "activity" },
    db: {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]), orderBy: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: mockUpdateReturning }) }) }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    },
  };
});

import slackRouter from "./slack";
import clientsRouter from "./clients";

// Mutable session injected ahead of the routers to stand in for express-session.
let currentSession: Record<string, unknown> = {};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = currentSession;
    next();
  });
  app.use("/api", slackRouter);
  app.use("/api", clientsRouter);
  return app;
}

const app = buildApp();

function loginAsOperator() {
  currentSession = {
    user: { id: "op@x.com", name: "Op", email: "op@x.com", role: "operator", clientId: null },
  };
}

function loginAsClientUser() {
  currentSession = {
    user: { id: "user@acme.com", name: "Acme User", email: "user@acme.com", role: "client", clientId: 1 },
  };
}

describe("requireOperator gate on Slack binding routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSession = {}; // no user by default
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  const protectedGets = ["/api/slack/workspace", "/api/slack/channels", "/api/slack/verify-access?channelId=C0BK6NPBHKJ"];

  it.each(protectedGets)("returns 401 without an operator session: GET %s", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });

  it("returns 401 without a session: POST /api/slack/test-approval-card", async () => {
    const res = await request(app).post("/api/slack/test-approval-card").send({ channelId: "C0BK6NPBHKJ" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a signed-in client user", async () => {
    loginAsClientUser();
    const res = await request(app).get("/api/slack/workspace");
    expect(res.status).toBe(403);
  });

  it("passes the gate for an authenticated operator", async () => {
    loginAsOperator();
    const res = await request(app).get("/api/slack/workspace");
    // Not 401/403 — the gate let the request through to the handler.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });
});

describe("requireOperator gate on PATCH /api/clients/:id (channel binding)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSession = {};
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 without an operator session and does not write", async () => {
    const res = await request(app).patch("/api/clients/1").send({ slackChannel: "C0BK6NPBHKJ" });
    expect(res.status).toBe(401);
    expect(mockUpdateReturning).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in client user and does not write", async () => {
    loginAsClientUser();
    const res = await request(app).patch("/api/clients/1").send({ slackChannel: "C0BK6NPBHKJ" });
    expect(res.status).toBe(403);
    expect(mockUpdateReturning).not.toHaveBeenCalled();
  });

  it("allows an authenticated operator to save the binding", async () => {
    loginAsOperator();
    const res = await request(app).patch("/api/clients/1").send({ slackChannel: "C0BK6NPBHKJ" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ slackChannel: "C0BK6NPBHKJ" });
    expect(mockUpdateReturning).toHaveBeenCalledTimes(1);
  });
});

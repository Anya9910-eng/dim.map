/**
 * Default-deny gate on the /api router.
 *
 * Mounts the REAL app (only the DB and the session store are mocked) so the
 * assertions cover the actual wiring in routes/index.ts, not a stand-in.
 *
 * The regression this guards: data routes used to ship without an explicit
 * `requireOperator` argument, which made them publicly readable AND writable —
 * an anonymous POST /api/clients reached schema validation (422) instead of
 * being rejected at the gate (401).
 */

import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  desc: vi.fn((col: unknown) => col),
  sql: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
}));

// Any handler reached past the gate would hit these; the point of the suite is
// that the gated cases never do.
vi.mock("@workspace/db", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve([]),
    limit: () => Promise.resolve([]),
    values: () => chain,
    set: () => chain,
    returning: () => Promise.resolve([]),
    then: (resolve: (v: unknown[]) => unknown) => resolve([]),
  };
  return {
    clientsTable: { _name: "clients" },
    draftsTable: { _name: "drafts" },
    campaignsTable: { _name: "campaigns" },
    personasTable: { _name: "personas" },
    logsTable: { _name: "logs" },
    activityTable: { _name: "activity" },
    setupItemsTable: { _name: "setup_items" },
    operatorBillingTable: { _name: "operator_billing" },
    epicgramDraftsTable: { _name: "epicgram_drafts" },
    db: {
      select: () => chain,
      insert: () => chain,
      update: () => chain,
      delete: () => chain,
    },
  };
});

vi.mock("express-session", async () =>
  (await import("../testing/sessionMock")).expressSessionMock());

import request from "supertest";
import app from "../app";
import { loginAsOperator, logoutOperator } from "../testing/sessionMock";

describe("apiGate — anonymous requests are rejected at the gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logoutOperator();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  const gatedReads = [
    "/api/clients",
    "/api/drafts",
    "/api/campaigns",
    "/api/personas",
    "/api/dashboard/stats",
  ];

  it.each(gatedReads)("returns 401 without a session: GET %s", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });

  it("returns 401 — not 422 — for an anonymous POST /api/clients", async () => {
    const res = await request(app)
      .post("/api/clients")
      .send({ name: "Attacker", slackChannel: "C0BK6NPBHKJ", mode: "draft" });

    // 422 here would mean the request passed the gate and only failed schema
    // validation, i.e. a valid body would have created the row.
    expect(res.status).toBe(401);
  });

  it("returns 401 for an anonymous DELETE /api/clients/:id", async () => {
    const res = await request(app).delete("/api/clients/1");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an anonymous PATCH /api/drafts/:id/action", async () => {
    const res = await request(app)
      .patch("/api/drafts/1/action")
      .send({ action: "send" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for an anonymous POST /api/webhooks/lemlist/simulate", async () => {
    const res = await request(app)
      .post("/api/webhooks/lemlist/simulate")
      .send({ campaignId: "1" });
    expect(res.status).toBe(401);
  });
});

describe("apiGate — routes with their own credential check stay reachable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logoutOperator();
  });

  it("GET /api/healthz answers without a session", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /api/auth/me is not gated — it answers 401 on its own", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("POST /api/early-access is not gated — a malformed body reaches the route's own 400", async () => {
    // An anonymous visitor is the intended caller. A 401 here would mean the
    // landing-page form is dead again; the route's own validation answering
    // proves the request got past the gate.
    const res = await request(app).post("/api/early-access").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Enter your name");
  });

  it("POST /api/webhooks/lemlist reaches its own secret check, not the gate", async () => {
    const res = await request(app).post("/api/webhooks/lemlist").send({});
    // requireWebhookSecret answers 401 with its own body — reaching it proves
    // the gate let the route through to its real credential check.
    expect(res.body).toHaveProperty("ok", false);
  });

  it.each(["meta", "whatsapp"])("POST /api/webhooks/%s/:clientId reaches its own secret check, not the gate", async (source) => {
    const res = await request(app).post(`/api/webhooks/${source}/1`).send({});
    // No secret supplied: requireClientWebhookSecret answers with `ok: false`,
    // which the gate's own 401 body does not carry.
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("ok", false);
  });
});

describe("apiGate — an authenticated operator passes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginAsOperator();
  });

  it("GET /api/clients is no longer 401 once logged in", async () => {
    const res = await request(app).get("/api/clients");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

/**
 * Self-service client settings.
 *
 * The interesting properties are all negative: a client changes their own two
 * fields and nothing else, sees their own row and no one else's, and never
 * reads back a saved API key.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

const { state, captured } = vi.hoisted(() => ({
  state: {
    client: {
      id: 3,
      name: "Up2Clean",
      company: "Up2Clean Pty",
      plan: "starter",
      slackChannel: null as string | null,
      lemlistApiKey: null as string | null,
      lemlistWebhookSecret: "s3cr3t",
      mode: "draft",
      isActive: true,
    } as Record<string, unknown>,
    counts: [1, 4, 37],
  },
  captured: { update: null as Record<string, unknown> | null, whereClientId: null as unknown },
}));

vi.mock("express-session", async () =>
  (await import("../testing/sessionMock")).expressSessionMock());

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((c: unknown, v: unknown) => ({ _eq: [c, v] })),
  ne: vi.fn((c: unknown, v: unknown) => ({ _ne: [c, v] })),
  and: vi.fn((...a: unknown[]) => ({ _and: a })),
  gte: vi.fn((c: unknown, v: unknown) => ({ _gte: [c, v] })),
  sql: Object.assign(vi.fn(() => ({ _sql: true })), { raw: vi.fn() }),
}));

vi.mock("@workspace/db", () => {
  const clientsTable = { _name: "clients" };
  const campaignsTable = { _name: "campaigns" };
  const draftsTable = { _name: "drafts" };
  let countCall = 0;
  return {
    clientsTable,
    campaignsTable,
    draftsTable,
    db: {
      select: (projection?: unknown) => ({
        from: (table: object) => ({
          where: (w: unknown) => {
            if (projection) {
              const seq = state.counts[countCall % state.counts.length] ?? 0;
              countCall++;
              return Promise.resolve([{ count: seq }]);
            }
            if (table === clientsTable) {
              captured.whereClientId = w;
              return Promise.resolve([state.client]);
            }
            return Promise.resolve([]);
          },
          orderBy: () => Promise.resolve([]),
        }),
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => ({
          where: () => ({
            returning: () => {
              captured.update = v;
              Object.assign(state.client, v);
              return Promise.resolve([state.client]);
            },
          }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    },
  };
});

vi.mock("../lib/lemlist", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return {
    ...actual,
    testConnection: vi.fn(async () => ({ ok: true })),
    getCampaigns: vi.fn(async () => [{ _id: "cam_1", name: "Q3 Outbound" }]),
  };
});

import request from "supertest";
import app from "../app";
import { loginAsClientUser, loginAsOperator, logoutOperator } from "../testing/sessionMock";

beforeEach(() => {
  state.client = {
    id: 3,
    name: "Up2Clean",
    company: "Up2Clean Pty",
    plan: "starter",
    slackChannel: null,
    lemlistApiKey: null,
    lemlistWebhookSecret: "s3cr3t",
    mode: "draft",
    isActive: true,
  };
  captured.update = null;
  vi.clearAllMocks();
});

describe("GET /api/me/settings", () => {
  it("is refused without a session", async () => {
    logoutOperator();
    const res = await request(app).get("/api/me/settings");
    expect(res.status).toBe(401);
  });

  it("never returns the saved Lemlist key, only that one exists", async () => {
    state.client["lemlistApiKey"] = "abcd1234efgh5678";
    loginAsClientUser(3);

    const res = await request(app).get("/api/me/settings");

    expect(res.status).toBe(200);
    expect(res.body.lemlist).toMatchObject({ hasApiKey: true, keyHint: "••••5678" });
    expect(JSON.stringify(res.body)).not.toContain("abcd1234efgh5678");
  });

  it("reports plan usage so the client can see what a slot costs them", async () => {
    loginAsClientUser(3);
    const res = await request(app).get("/api/me/settings");
    expect(res.body.usage).toMatchObject({
      activeCampaignLimit: 2,
      replyLimit: 100,
    });
  });

  it("makes an operator name a client rather than guessing", async () => {
    loginAsOperator();
    const res = await request(app).get("/api/me/settings");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must name a client/);
  });
});

describe("PATCH /api/me/settings", () => {
  it("saves a Lemlist key", async () => {
    loginAsClientUser(3);
    const res = await request(app).patch("/api/me/settings").send({ lemlistApiKey: "key_live_9999" });

    expect(res.status).toBe(200);
    expect(captured.update).toEqual({ lemlistApiKey: "key_live_9999" });
  });

  // The reason these routes exist instead of opening PATCH /clients/:id.
  it("ignores every field that is not one of the two it owns", async () => {
    loginAsClientUser(3);
    const res = await request(app).patch("/api/me/settings").send({
      lemlistApiKey: "key_live_9999",
      plan: "growth",
      isActive: false,
      mode: "auto",
      id: 99,
      name: "Renamed",
    });

    expect(res.status).toBe(200);
    expect(captured.update).toEqual({ lemlistApiKey: "key_live_9999" });
    expect(captured.update).not.toHaveProperty("plan");
    expect(captured.update).not.toHaveProperty("isActive");
    expect(captured.update).not.toHaveProperty("mode");
  });

  it("rejects a Slack channel name, which would post nowhere", async () => {
    loginAsClientUser(3);
    const res = await request(app).patch("/api/me/settings").send({ slackChannel: "#replies" });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/starts with C or G/);
    expect(captured.update).toBeNull();
  });

  it("accepts a real channel ID, and an empty string clears it", async () => {
    loginAsClientUser(3);

    const set = await request(app).patch("/api/me/settings").send({ slackChannel: "C0BK6NPBHKJ" });
    expect(set.status).toBe(200);
    expect(captured.update).toEqual({ slackChannel: "C0BK6NPBHKJ" });

    const clear = await request(app).patch("/api/me/settings").send({ slackChannel: "" });
    expect(clear.status).toBe(200);
    expect(captured.update).toEqual({ slackChannel: null });
  });

  it("refuses a body with nothing it can act on", async () => {
    loginAsClientUser(3);
    const res = await request(app).patch("/api/me/settings").send({ plan: "growth" });
    expect(res.status).toBe(400);
    expect(captured.update).toBeNull();
  });
});

describe("GET /api/me/lemlist/campaigns", () => {
  it("says so plainly when no key is saved yet", async () => {
    loginAsClientUser(3);
    const res = await request(app).get("/api/me/lemlist/campaigns");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/No Lemlist API key/);
  });

  it("marks which Lemlist campaigns are already mapped", async () => {
    state.client["lemlistApiKey"] = "key_live_9999";
    loginAsClientUser(3);

    const res = await request(app).get("/api/me/lemlist/campaigns");

    expect(res.status).toBe(200);
    expect(res.body.campaigns).toEqual([
      { id: "cam_1", name: "Q3 Outbound", mapped: false },
    ]);
  });
});

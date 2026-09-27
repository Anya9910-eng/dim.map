/**
 * The plan's campaign allowance counts campaigns that are *drafting*, not
 * campaigns that exist. Mapping is unlimited so a client can import their whole
 * Lemlist account; switching one on is what consumes a slot.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

const { state, capturedInsert } = vi.hoisted(() => ({
  state: {
    activeCount: 0,
    plan: "starter" as string,
    campaign: null as Record<string, unknown> | null,
  },
  capturedInsert: { value: null as Record<string, unknown> | null },
}));

vi.mock("express-session", async () =>
  (await import("../testing/sessionMock")).expressSessionMock());

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_c: unknown, _v: unknown) => ({ _eq: [_c, _v] })),
  ne: vi.fn((_c: unknown, _v: unknown) => ({ _ne: [_c, _v] })),
  and: vi.fn((...a: unknown[]) => ({ _and: a })),
  sql: Object.assign(vi.fn(() => ({ _sql: true })), { raw: vi.fn() }),
}));

vi.mock("@workspace/db", () => {
  const campaignsTable = { _name: "campaigns" };
  const clientsTable = { _name: "clients" };
  const draftsTable = { _name: "drafts" };

  const base = {
    id: 7,
    clientId: 1,
    personaId: null,
    name: "Q3 Outbound",
    lemlistCampaignId: "cam_abc",
    tone: null,
    replyRules: null,
    regionRules: null,
    isActive: true,
    replyCount: 0,
    createdAt: new Date("2026-08-01T00:00:00Z"),
  };

  return {
    campaignsTable,
    clientsTable,
    draftsTable,
    db: {
      select: (projection?: unknown) => ({
        from: (table: object) => ({
          // A projection means the count query; without one it is a row read.
          where: () => {
            if (projection) return Promise.resolve([{ count: state.activeCount }]);
            if (table === clientsTable) return Promise.resolve([{ id: 1, plan: state.plan }]);
            if (table === campaignsTable) return Promise.resolve(state.campaign ? [state.campaign] : []);
            return Promise.resolve([]);
          },
          orderBy: () => Promise.resolve([]),
        }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          capturedInsert.value = v;
          return { returning: () => Promise.resolve([{ ...base, ...v }]) };
        },
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => ({
          where: () => ({ returning: () => Promise.resolve([{ ...base, ...state.campaign, ...v }]) }),
        }),
      }),
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    },
  };
});

import request from "supertest";
import app from "../app";
import { loginAsOperator } from "../testing/sessionMock";

const newCampaign = { clientId: 1, name: "Q3 Outbound", lemlistCampaignId: "cam_abc" };

beforeEach(() => {
  loginAsOperator();
  state.activeCount = 0;
  state.plan = "starter";
  state.campaign = null;
  capturedInsert.value = null;
  vi.clearAllMocks();
});

describe("POST /api/campaigns — mapping is unlimited, activation is not", () => {
  it("creates an active campaign while a slot is free", async () => {
    state.activeCount = 1; // starter allows 2
    const res = await request(app).post("/api/campaigns").send(newCampaign);

    expect(res.status).toBe(201);
    expect(capturedInsert.value).toMatchObject({ isActive: true });
    expect(res.body.isActive).toBe(true);
  });

  it("still creates the mapping at the cap, but switched off", async () => {
    state.activeCount = 2; // starter is full

    const res = await request(app).post("/api/campaigns").send(newCampaign);

    // The import must not fail — the client keeps the mapping and can choose
    // which two campaigns are the live ones.
    expect(res.status).toBe(201);
    expect(capturedInsert.value).toMatchObject({ isActive: false });
    expect(res.body.isActive).toBe(false);
  });

  it("refuses when the caller explicitly asked for active at the cap", async () => {
    state.activeCount = 2;

    const res = await request(app)
      .post("/api/campaigns")
      .send({ ...newCampaign, isActive: true });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/starter plan runs 2 campaigns at a time/);
    expect(capturedInsert.value).toBeNull();
  });

  it("gives growth the larger allowance", async () => {
    state.plan = "growth";
    state.activeCount = 5;

    const res = await request(app).post("/api/campaigns").send(newCampaign);
    expect(res.status).toBe(201);
    expect(capturedInsert.value).toMatchObject({ isActive: true });
  });
});

describe("PATCH /api/campaigns/:id — switching on", () => {
  it("refuses to switch on a campaign when the plan is full", async () => {
    state.campaign = { id: 7, clientId: 1, isActive: false };
    state.activeCount = 2;

    const res = await request(app).patch("/api/campaigns/7").send({ isActive: true });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Switch one off to free a slot/);
  });

  it("allows it when a slot is free", async () => {
    state.campaign = { id: 7, clientId: 1, isActive: false };
    state.activeCount = 1;

    const res = await request(app).patch("/api/campaigns/7").send({ isActive: true });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
  });

  it("never blocks switching a campaign off", async () => {
    state.campaign = { id: 7, clientId: 1, isActive: true };
    state.activeCount = 2;

    const res = await request(app).patch("/api/campaigns/7").send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  // Saving an unrelated edit on an already-active campaign is not a request
  // for a second slot, and must not be refused just because the plan is full.
  it("allows an edit to an already-active campaign at the cap", async () => {
    state.campaign = { id: 7, clientId: 1, isActive: true };
    state.activeCount = 2;

    const res = await request(app)
      .patch("/api/campaigns/7")
      .send({ isActive: true, tone: "warmer" });

    expect(res.status).toBe(200);
  });
});

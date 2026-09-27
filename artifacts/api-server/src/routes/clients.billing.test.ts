/**
 * The operator's client list carries a computed billing status per client, so
 * the dashboard can badge who is trialling, subscribed, or lapsed. The status
 * comes from accessStateFor (exhaustively tested in lib/billing.test.ts); this
 * checks it actually reaches the API response for both the list and one client.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

const DAY = 24 * 60 * 60 * 1000;

const { rows } = vi.hoisted(() => ({ rows: { value: [] as Record<string, unknown>[] } }));

vi.mock("express-session", async () =>
  (await import("../testing/sessionMock")).expressSessionMock());
vi.mock("../middleware/requireOperator", () => ({
  requireOperator: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
}));
vi.mock("@workspace/db", () => ({
  clientsTable: { _name: "clients", id: {}, createdAt: {} },
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows.value),
        orderBy: () => Promise.resolve(rows.value),
      }),
    }),
  },
}));

import request from "supertest";
import app from "../app";
import { loginAsOperator } from "../testing/sessionMock";

function client(over: Record<string, unknown> = {}) {
  return {
    id: 1, name: "Acme", company: "Acme Co", slackChannel: null, slackWorkspaceId: null,
    slackBotToken: null, mode: "draft", plan: "starter", lemlistApiKey: null,
    lemlistWebhookSecret: null, n8nWebhookUrl: null, isActive: true, createdAt: new Date(),
    billingMode: "managed", trialEndsAt: null, subscriptionStatus: null,
    stripeCustomerId: null, stripeSubscriptionId: null, ...over,
  };
}

describe("GET /api/clients — billing status for the operator", () => {
  beforeEach(() => {
    loginAsOperator();
    rows.value = [];
  });

  it("labels a managed client 'managed' with no trial days", async () => {
    rows.value = [client()];
    const res = await request(app).get("/api/clients");
    expect(res.status).toBe(200);
    expect(res.body[0].billingStatus).toBe("managed");
    expect(res.body[0].trialDaysLeft).toBeNull();
  });

  it("labels a self-serve client inside its trial with days remaining", async () => {
    rows.value = [client({ billingMode: "self_serve", trialEndsAt: new Date(Date.now() + 2 * DAY) })];
    const res = await request(app).get("/api/clients");
    expect(res.body[0].billingStatus).toBe("trial");
    expect(res.body[0].trialDaysLeft).toBe(2);
  });

  it("labels a subscribed client 'active', a failed one 'past_due', a lapsed one 'locked'", async () => {
    rows.value = [
      client({ id: 1, billingMode: "self_serve", subscriptionStatus: "active", plan: "growth" }),
      client({ id: 2, billingMode: "self_serve", subscriptionStatus: "past_due" }),
      client({ id: 3, billingMode: "self_serve", trialEndsAt: new Date(Date.now() - DAY) }),
    ];
    const res = await request(app).get("/api/clients");
    const byId = Object.fromEntries(res.body.map((c: { id: number; billingStatus: string }) => [c.id, c.billingStatus]));
    expect(byId).toEqual({ 1: "active", 2: "past_due", 3: "locked" });
  });
});

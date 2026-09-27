/**
 * A locked self-serve tenant can sign in and pay, and do nothing else.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockRow } = vi.hoisted(() => ({ mockRow: { value: null as unknown } }));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => ({})) }));
vi.mock("@workspace/db", () => ({
  clientsTable: { id: {}, billingMode: {}, trialEndsAt: {}, subscriptionStatus: {}, plan: {} },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (mockRow.value ? [mockRow.value] : []),
        }),
      }),
    }),
  },
}));

import { billingGate } from "./billingGate";

let session: Record<string, unknown> = {};

function app() {
  const a = express();
  a.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = session;
    next();
  });
  a.use(billingGate);
  a.get("/drafts", (_req, res) => res.json({ reached: "drafts" }));
  a.get("/me/billing", (_req, res) => res.json({ reached: "billing" }));
  a.post("/me/billing/checkout", (_req, res) => res.json({ reached: "checkout" }));
  a.get("/auth/me", (_req, res) => res.json({ reached: "auth" }));
  return a;
}

const DAY = 24 * 60 * 60 * 1000;
const clientUser = { user: { id: "u@x.test", name: "U", email: "u@x.test", role: "client", clientId: 7 } };

describe("billingGate", () => {
  beforeEach(() => {
    session = {};
    mockRow.value = null;
  });

  it("operators pass without a lookup", async () => {
    session = { user: { id: "op", name: "Op", email: "op@x.test", role: "operator", clientId: null } };
    const res = await request(app()).get("/drafts");
    expect(res.body).toEqual({ reached: "drafts" });
  });

  it("anonymous requests pass — authentication is apiGate's job, not this one's", async () => {
    const res = await request(app()).get("/drafts");
    expect(res.body).toEqual({ reached: "drafts" });
  });

  it("a managed client passes", async () => {
    session = clientUser;
    mockRow.value = { billingMode: "managed", trialEndsAt: null, subscriptionStatus: null, plan: "starter" };
    const res = await request(app()).get("/drafts");
    expect(res.body).toEqual({ reached: "drafts" });
  });

  it("a self-serve client inside the trial passes", async () => {
    session = clientUser;
    mockRow.value = { billingMode: "self_serve", trialEndsAt: new Date(Date.now() + DAY), subscriptionStatus: null, plan: "starter" };
    const res = await request(app()).get("/drafts");
    expect(res.body).toEqual({ reached: "drafts" });
  });

  it("an expired trial is 402 with a machine-readable code", async () => {
    session = clientUser;
    mockRow.value = { billingMode: "self_serve", trialEndsAt: new Date(Date.now() - DAY), subscriptionStatus: null, plan: "starter" };
    const res = await request(app()).get("/drafts");
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("billing_locked");
    expect(res.body.error).toMatch(/trial has ended/);
  });

  it("a cancelled subscription is 402 with a different message", async () => {
    session = clientUser;
    mockRow.value = { billingMode: "self_serve", trialEndsAt: null, subscriptionStatus: "canceled", plan: "growth" };
    const res = await request(app()).get("/drafts");
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/subscription has ended/);
  });

  it.each(["/me/billing", "/auth/me"])("a locked client can still reach %s", async (path) => {
    session = clientUser;
    mockRow.value = { billingMode: "self_serve", trialEndsAt: new Date(Date.now() - DAY), subscriptionStatus: null, plan: "starter" };
    const res = await request(app()).get(path);
    expect(res.status).toBe(200);
  });

  it("a locked client can start checkout", async () => {
    session = clientUser;
    mockRow.value = { billingMode: "self_serve", trialEndsAt: new Date(Date.now() - DAY), subscriptionStatus: null, plan: "starter" };
    const res = await request(app()).post("/me/billing/checkout");
    expect(res.body).toEqual({ reached: "checkout" });
  });

  it("a client whose row is missing passes rather than being locked out", async () => {
    session = clientUser;
    mockRow.value = null;
    const res = await request(app()).get("/drafts");
    expect(res.body).toEqual({ reached: "drafts" });
  });
});

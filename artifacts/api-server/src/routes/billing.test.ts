/**
 * /me/billing — the caller's own tenant, never anyone else's — and the Stripe
 * webhook's routing of events to applySubscription.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockRow, mockUpdate, mockStripe, mockApply, mockConfigured } = vi.hoisted(() => ({
  mockRow: { value: null as unknown },
  mockUpdate: vi.fn(),
  mockStripe: {
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
    subscriptions: { retrieve: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
  },
  mockApply: vi.fn(),
  mockConfigured: { value: true },
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => ({})) }));
vi.mock("@workspace/db", () => ({
  clientsTable: { id: {}, stripeCustomerId: {} },
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (mockRow.value ? [mockRow.value] : []) }) }) }),
    update: () => ({ set: (v: unknown) => ({ where: async () => mockUpdate(v) }) }),
  },
}));
vi.mock("../lib/billing", async (importActual) => {
  const actual = await importActual<typeof import("../lib/billing")>();
  return {
    ...actual,
    isStripeConfigured: () => mockConfigured.value,
    stripeClient: () => mockStripe,
    applySubscription: mockApply,
    appBaseUrl: () => "https://draftfly.test",
  };
});

import billingRouter, { handleStripeEvent } from "./billing";

let session: Record<string, unknown> = {};
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = session;
    next();
  });
  a.use("/api", billingRouter);
  return a;
}

const DAY = 24 * 60 * 60 * 1000;
const asClient = { user: { id: "u@x.test", name: "U", email: "u@x.test", role: "client", clientId: 7 } };
const asOperator = { user: { id: "op", name: "Op", email: "op@x.test", role: "operator", clientId: null } };
const selfServe = (over = {}) => ({
  id: 7, name: "Acme", company: "Acme Co", plan: "starter", billingMode: "self_serve",
  trialEndsAt: new Date(Date.now() + 2 * DAY), subscriptionStatus: null, stripeCustomerId: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  session = asClient;
  mockRow.value = selfServe();
  mockConfigured.value = true;
  process.env["STRIPE_PRICE_STARTER"] = "price_starter";
  process.env["STRIPE_PRICE_GROWTH"] = "price_growth";
});

describe("GET /me/billing", () => {
  it("reports the caller's state, plan limits, and which plans can be bought", async () => {
    const res = await request(app()).get("/api/me/billing");
    expect(res.status).toBe(200);
    expect(res.body.state.kind).toBe("trial");
    expect(res.body.plan).toBe("starter");
    expect(res.body.limits).toEqual({ activeCampaigns: 2, repliesPerMonth: 100 });
    expect(res.body.plans.map((p: { key: string; available: boolean }) => [p.key, p.available])).toEqual([["starter", true], ["growth", true]]);
    expect(res.body.canManage).toBe(false);
  });

  it("an operator has no bill of their own", async () => {
    session = asOperator;
    const res = await request(app()).get("/api/me/billing");
    expect(res.status).toBe(400);
  });

  it("plans read as unavailable when Stripe is not configured", async () => {
    mockConfigured.value = false;
    const res = await request(app()).get("/api/me/billing");
    expect(res.body.plans.every((p: { available: boolean }) => !p.available)).toBe(true);
  });
});

describe("POST /me/billing/checkout", () => {
  it("creates a Stripe customer once, then a subscription checkout tagged with the client id", async () => {
    mockStripe.customers.create.mockResolvedValue({ id: "cus_123" });
    mockStripe.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
    const res = await request(app()).post("/api/me/billing/checkout").send({ plan: "growth" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "https://checkout.stripe.test/s" });
    expect(mockStripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({ email: "u@x.test", metadata: { clientId: "7" } }));
    expect(mockUpdate).toHaveBeenCalledWith({ stripeCustomerId: "cus_123" });
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      customer: "cus_123",
      mode: "subscription",
      line_items: [{ price: "price_growth", quantity: 1 }],
      subscription_data: { metadata: { clientId: "7" } },
      success_url: "https://draftfly.test/app/settings?billing=success",
    }));
  });

  it("reuses an existing Stripe customer", async () => {
    mockRow.value = selfServe({ stripeCustomerId: "cus_existing" });
    mockStripe.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
    await request(app()).post("/api/me/billing/checkout").send({ plan: "starter" });
    expect(mockStripe.customers.create).not.toHaveBeenCalled();
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_existing" }));
  });

  it("a managed client cannot check out — their bill lives elsewhere", async () => {
    mockRow.value = selfServe({ billingMode: "managed" });
    const res = await request(app()).post("/api/me/billing/checkout").send({ plan: "starter" });
    expect(res.status).toBe(400);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("503 when Stripe is not configured, with a message a person can act on", async () => {
    mockConfigured.value = false;
    const res = await request(app()).post("/api/me/billing/checkout").send({ plan: "starter" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not enabled/);
  });

  it("rejects an unknown plan", async () => {
    const res = await request(app()).post("/api/me/billing/checkout").send({ plan: "enterprise" });
    expect(res.status).toBe(400);
  });

  it("503 when the plan has no price configured", async () => {
    delete process.env["STRIPE_PRICE_GROWTH"];
    const res = await request(app()).post("/api/me/billing/checkout").send({ plan: "growth" });
    expect(res.status).toBe(503);
  });

  it("a Stripe failure is 502, never a fake URL", async () => {
    mockStripe.customers.create.mockRejectedValue(new Error("stripe down"));
    const res = await request(app()).post("/api/me/billing/checkout").send({ plan: "starter" });
    expect(res.status).toBe(502);
  });
});

describe("POST /me/billing/portal", () => {
  it("opens the portal for a client with a Stripe customer", async () => {
    mockRow.value = selfServe({ stripeCustomerId: "cus_1" });
    mockStripe.billingPortal.sessions.create.mockResolvedValue({ url: "https://portal.stripe.test/p" });
    const res = await request(app()).post("/api/me/billing/portal");
    expect(res.body).toEqual({ url: "https://portal.stripe.test/p" });
  });

  it("400 before any subscription exists", async () => {
    const res = await request(app()).post("/api/me/billing/portal");
    expect(res.status).toBe(400);
  });
});

describe("handleStripeEvent", () => {
  beforeEach(() => {
    process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test";
  });

  it("verifies the signature and applies subscription events", async () => {
    const sub = { id: "sub_1", status: "active" };
    mockStripe.webhooks.constructEvent.mockReturnValue({ type: "customer.subscription.updated", data: { object: sub } });
    await handleStripeEvent(Buffer.from("{}"), "sig");
    expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(expect.any(Buffer), "sig", "whsec_test");
    expect(mockApply).toHaveBeenCalledWith(sub);
  });

  it("on checkout completion, fetches the subscription and applies it", async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { mode: "subscription", subscription: "sub_9" } },
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({ id: "sub_9", status: "active" });
    await handleStripeEvent(Buffer.from("{}"), "sig");
    expect(mockApply).toHaveBeenCalledWith({ id: "sub_9", status: "active" });
  });

  it("ignores unrelated events", async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({ type: "invoice.paid", data: { object: {} } });
    await handleStripeEvent(Buffer.from("{}"), "sig");
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("a bad signature throws, so the route answers 400 and Stripe retries", async () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => { throw new Error("No signatures found"); });
    await expect(handleStripeEvent(Buffer.from("{}"), "bad")).rejects.toThrow(/signatures/);
  });
});

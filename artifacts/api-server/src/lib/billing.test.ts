/**
 * The one place that turns a client's billing columns into "may they use the
 * product". These are the rules the product decision of 2026-09-12 wrote
 * down: three-day trial, no card up front, locked afterwards.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, clientsTable: {} }));

import { accessStateFor, hasAccess, trialEndFrom, TRIAL_DAYS, planForPriceId, priceIdFor } from "./billing";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-12T12:00:00Z");

function client(over: Partial<Parameters<typeof accessStateFor>[0]> = {}) {
  return { billingMode: "self_serve" as const, trialEndsAt: null, subscriptionStatus: null, plan: "starter" as const, ...over };
}

describe("accessStateFor", () => {
  it("managed clients are never locked, whatever the other columns say", () => {
    const s = accessStateFor(client({ billingMode: "managed", trialEndsAt: new Date(now.getTime() - DAY), subscriptionStatus: "canceled" }), now);
    expect(s).toEqual({ kind: "managed" });
    expect(hasAccess(s)).toBe(true);
  });

  it("inside the trial: trial, with days left rounded up", () => {
    const s = accessStateFor(client({ trialEndsAt: new Date(now.getTime() + 2.2 * DAY) }), now);
    expect(s).toMatchObject({ kind: "trial", daysLeft: 3 });
    expect(hasAccess(s)).toBe(true);
  });

  it("the trial ends at the instant, not the day after", () => {
    const s = accessStateFor(client({ trialEndsAt: now }), now);
    expect(s).toEqual({ kind: "locked", reason: "trial_ended" });
    expect(hasAccess(s)).toBe(false);
  });

  it("no trial and no subscription is locked, not silently open", () => {
    expect(accessStateFor(client(), now)).toEqual({ kind: "locked", reason: "trial_ended" });
  });

  it.each(["active", "trialing"])("Stripe status %s is active on the client's plan", (status) => {
    expect(accessStateFor(client({ subscriptionStatus: status, plan: "growth" }), now)).toEqual({ kind: "active", plan: "growth" });
  });

  it("past_due keeps access while Stripe retries", () => {
    const s = accessStateFor(client({ subscriptionStatus: "past_due" }), now);
    expect(s).toEqual({ kind: "past_due", plan: "starter" });
    expect(hasAccess(s)).toBe(true);
  });

  it.each(["canceled", "unpaid", "incomplete_expired"])("Stripe status %s locks even inside a trial window", (status) => {
    const s = accessStateFor(client({ subscriptionStatus: status, trialEndsAt: new Date(now.getTime() + DAY) }), now);
    expect(s).toEqual({ kind: "locked", reason: "subscription_ended" });
  });

  it("an 'incomplete' checkout that never paid falls back to the trial", () => {
    const s = accessStateFor(client({ subscriptionStatus: "incomplete", trialEndsAt: new Date(now.getTime() + DAY) }), now);
    expect(s).toMatchObject({ kind: "trial" });
  });

  it("an unknown plan string on an active subscription resolves to starter, never growth", () => {
    const s = accessStateFor(client({ subscriptionStatus: "active", plan: "enterprise" as never }), now);
    expect(s).toEqual({ kind: "active", plan: "starter" });
  });
});

describe("trialEndFrom", () => {
  it(`is ${TRIAL_DAYS} days out`, () => {
    expect(trialEndFrom(now).getTime() - now.getTime()).toBe(TRIAL_DAYS * DAY);
  });
});

describe("price ↔ plan mapping", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env["STRIPE_PRICE_STARTER"] = "price_starter";
    process.env["STRIPE_PRICE_GROWTH"] = "price_growth";
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("maps the configured prices and nothing else", () => {
    expect(planForPriceId("price_starter")).toBe("starter");
    expect(planForPriceId("price_growth")).toBe("growth");
    expect(planForPriceId("price_made_up_in_dashboard")).toBeNull();
    expect(planForPriceId(null)).toBeNull();
  });

  it("an unset price is unavailable, not defaulted", () => {
    delete process.env["STRIPE_PRICE_GROWTH"];
    expect(priceIdFor("growth")).toBeNull();
    expect(priceIdFor("starter")).toBe("price_starter");
  });
});

/**
 * The allowances themselves, and the one rule that isn't obvious: an
 * unrecognised plan resolves *down*, never up.
 */

import { describe, it, expect } from "vitest";
import { PLAN_LIMITS, limitsFor, currentPeriodStart } from "./plans";

describe("plan allowances", () => {
  it("are the advertised numbers", () => {
    expect(PLAN_LIMITS.starter).toEqual({ activeCampaigns: 2, repliesPerMonth: 100 });
    expect(PLAN_LIMITS.growth).toEqual({ activeCampaigns: 10, repliesPerMonth: 500 });
  });

  it("resolves a known plan", () => {
    expect(limitsFor("growth").activeCampaigns).toBe(10);
  });

  // A row written before the column existed, or naming a plan a later version
  // introduced, must not be handed the larger allowance by accident.
  it("falls back to the smaller allowance for anything unrecognised", () => {
    for (const unknown of [null, undefined, "", "agency", "enterprise", "GROWTH"]) {
      expect(limitsFor(unknown)).toEqual(PLAN_LIMITS.starter);
    }
  });
});

describe("reply period", () => {
  it("starts at the first instant of the UTC month", () => {
    const start = currentPeriodStart(new Date("2026-08-19T13:45:12Z"));
    expect(start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("rolls over at the month boundary rather than 30 days later", () => {
    const endOfMonth = currentPeriodStart(new Date("2026-08-31T23:59:59Z"));
    const nextMonth = currentPeriodStart(new Date("2026-09-01T00:00:01Z"));
    expect(endOfMonth.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(nextMonth.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

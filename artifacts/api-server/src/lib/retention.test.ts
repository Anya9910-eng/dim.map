/**
 * Retention sweep: deletes prospect data past the window, keeps pending
 * drafts whatever their age, and can be switched off for a legal hold.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const { deletes } = vi.hoisted(() => ({
  deletes: [] as { table: string; where: unknown }[],
}));

vi.mock("drizzle-orm", () => ({
  lt: (col: { _n: string }, val: unknown) => ({ k: "lt", col: col._n, val }),
  ne: (col: { _n: string }, val: unknown) => ({ k: "ne", col: col._n, val }),
  and: (...parts: unknown[]) => ({ k: "and", parts }),
}));

vi.mock("@workspace/db", () => {
  const mk = (name: string) => ({ _name: name, createdAt: { _n: "createdAt" }, status: { _n: "status" }, id: { _n: "id" } });
  const draftsTable = mk("drafts"), activityTable = mk("activity"), logsTable = mk("logs");
  return {
    draftsTable, activityTable, logsTable,
    db: {
      delete: (t: { _name: string }) => ({
        where: (w: unknown) => ({
          returning: () => { deletes.push({ table: t._name, where: w }); return Promise.resolve([{ id: 1 }, { id: 2 }]); },
        }),
      }),
    },
  };
});

import { sweepExpiredData, retentionDays } from "./retention";

const ORIGINAL = process.env["DATA_RETENTION_DAYS"];
beforeEach(() => { deletes.length = 0; delete process.env["DATA_RETENTION_DAYS"]; });
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env["DATA_RETENTION_DAYS"];
  else process.env["DATA_RETENTION_DAYS"] = ORIGINAL;
});

describe("retention window", () => {
  it("defaults to twelve months", () => {
    expect(retentionDays()).toBe(365);
  });

  it("honours DATA_RETENTION_DAYS and rejects nonsense", () => {
    process.env["DATA_RETENTION_DAYS"] = "90";
    expect(retentionDays()).toBe(90);
    process.env["DATA_RETENTION_DAYS"] = "-5";
    expect(retentionDays()).toBe(365);
    process.env["DATA_RETENTION_DAYS"] = "soon";
    expect(retentionDays()).toBe(365);
  });
});

describe("sweepExpiredData", () => {
  it("cuts at exactly the retention window", async () => {
    const now = new Date("2026-09-12T12:00:00Z");
    const result = await sweepExpiredData(now);

    expect(result.cutoff?.toISOString()).toBe("2025-09-12T12:00:00.000Z");
    expect(deletes.map((d) => d.table)).toEqual(["activity", "logs", "drafts"]);
  });

  // The important negative: a pending draft is a lead the client has not
  // decided on yet. Age alone must not make it disappear from their inbox.
  it("never deletes a pending draft, however old", async () => {
    await sweepExpiredData();
    const drafts = deletes.find((d) => d.table === "drafts")!;
    expect(JSON.stringify(drafts.where)).toContain('"k":"ne","col":"status","val":"pending"');
  });

  it("deletes referencing rows before the drafts they reference", async () => {
    await sweepExpiredData();
    const order = deletes.map((d) => d.table);
    expect(order.indexOf("activity")).toBeLessThan(order.indexOf("drafts"));
    expect(order.indexOf("logs")).toBeLessThan(order.indexOf("drafts"));
  });

  it("is a no-op under a legal hold (DATA_RETENTION_DAYS=0)", async () => {
    process.env["DATA_RETENTION_DAYS"] = "0";
    const result = await sweepExpiredData();

    expect(result.cutoff).toBeNull();
    expect(deletes).toHaveLength(0);
  });
});

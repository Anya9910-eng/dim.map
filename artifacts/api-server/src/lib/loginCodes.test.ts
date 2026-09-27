/**
 * The limits that actually make a six-digit code safe.
 *
 * A 6-digit code is ~20 bits, so nothing about its length protects anyone —
 * expiry, the attempt cap and the send throttle do. Those are the assertions
 * here, against an in-memory stand-in for the table.
 *
 * The fake db interprets the same condition objects drizzle would build, so
 * "which row comes back" is exercised rather than assumed. `sanity checks`
 * below tests that interpreter itself, because a filter mock that silently
 * matches everything would make every other case in this file pass for the
 * wrong reason.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

interface Row {
  id: number;
  email: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

type Cond =
  | { k: "eq"; col: string; val: unknown }
  | { k: "gt"; col: string; val: unknown }
  | { k: "lt"; col: string; val: unknown }
  | { k: "isNull"; col: string }
  | { k: "and"; parts: (Cond | undefined)[] };

const store = vi.hoisted(() => ({ rows: [] as Row[], nextId: 1 }));

vi.mock("drizzle-orm", () => ({
  eq: (col: { _n: string }, val: unknown) => ({ k: "eq", col: col._n, val }),
  gt: (col: { _n: string }, val: unknown) => ({ k: "gt", col: col._n, val }),
  isNull: (col: { _n: string }) => ({ k: "isNull", col: col._n }),
  and: (...parts: unknown[]) => ({ k: "and", parts }),
  lt: (col: { _n: string }, val: unknown) => ({ k: "lt", col: col._n, val }),
  desc: (col: { _n: string }) => ({ k: "desc", col: col._n }),
  sql: () => ({ k: "sql" }),
}));

function matches(row: Row, cond: Cond | undefined): boolean {
  if (!cond) return true;
  switch (cond.k) {
    case "eq":
      return (row as unknown as Record<string, unknown>)[cond.col] === cond.val;
    case "gt": {
      const v = (row as unknown as Record<string, unknown>)[cond.col] as Date;
      return v.getTime() > (cond.val as Date).getTime();
    }
    case "lt": {
      const v = (row as unknown as Record<string, unknown>)[cond.col] as Date;
      return v.getTime() < (cond.val as Date).getTime();
    }
    case "isNull":
      return (row as unknown as Record<string, unknown>)[cond.col] == null;
    case "and":
      return cond.parts.every((p) => matches(row, p as Cond | undefined));
  }
}

vi.mock("@workspace/db", () => {
  const loginCodesTable = {
    id: { _n: "id" },
    email: { _n: "email" },
    codeHash: { _n: "codeHash" },
    expiresAt: { _n: "expiresAt" },
    consumedAt: { _n: "consumedAt" },
    attempts: { _n: "attempts" },
    createdAt: { _n: "createdAt" },
  };

  return {
    loginCodesTable,
    db: {
      select: (projection?: Record<string, unknown>) => ({
        from: () => ({
          where: (cond: Cond) => {
            const hits = store.rows.filter((r) => matches(r, cond));
            // The count query is the only projected select in this module.
            const result = projection
              ? [{ count: hits.length }]
              : hits;
            return Object.assign(Promise.resolve(result), {
              orderBy: () => ({
                limit: (n: number) =>
                  Promise.resolve(
                    [...hits].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, n),
                  ),
              }),
            });
          },
        }),
      }),
      delete: () => ({
        where: (cond: Cond) => {
          store.rows = store.rows.filter((r) => !matches(r, cond));
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (values: Partial<Row>) => ({
          where: (cond: Cond) => {
            for (const r of store.rows) if (matches(r, cond)) Object.assign(r, values);
            return Promise.resolve();
          },
        }),
      }),
      insert: () => ({
        values: (v: Omit<Row, "id" | "consumedAt" | "attempts" | "createdAt">) => {
          store.rows.push({
            id: store.nextId++,
            consumedAt: null,
            attempts: 0,
            createdAt: new Date(),
            ...v,
          });
          return Promise.resolve();
        },
      }),
    },
  };
});

import { issueLoginCode, verifyLoginCode, normalizeEmail } from "./loginCodes";

const EMAIL = "user@acme.com";

beforeEach(() => {
  store.rows = [];
  store.nextId = 1;
  process.env["SESSION_SECRET"] = "test-secret";
});

describe("sanity checks on the fake table", () => {
  it("filters by email rather than matching everything", async () => {
    await issueLoginCode(EMAIL);
    await issueLoginCode("other@acme.com");
    expect(store.rows).toHaveLength(2);

    // Issuing for EMAIL again must retire only EMAIL's outstanding code.
    await issueLoginCode(EMAIL);
    const otherRow = store.rows.find((r) => r.email === "other@acme.com");
    expect(otherRow?.consumedAt).toBeNull();
  });
});

describe("housekeeping on issue", () => {
  // A code row is a hashed credential plus an email address. Once expired it
  // has no further use, and rows kept forever ride along in every database
  // dump. Issuing a new code sweeps the dead ones out.
  it("deletes codes that expired more than a day ago, and nothing else", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    store.rows.push(
      { id: 90, email: "old@x.test", codeHash: "h", expiresAt: new Date(now - 2 * DAY), consumedAt: null, attempts: 0, createdAt: new Date(now - 2 * DAY) },
      { id: 91, email: "recent@x.test", codeHash: "h", expiresAt: new Date(now - 60_000), consumedAt: null, attempts: 0, createdAt: new Date(now - 60_000) },
      { id: 92, email: "live@x.test", codeHash: "h", expiresAt: new Date(now + 5 * 60_000), consumedAt: null, attempts: 0, createdAt: new Date(now) },
    );

    await issueLoginCode("someone@x.test");

    const ids = store.rows.map((r) => r.id);
    expect(ids).not.toContain(90);   // two days past expiry: gone
    expect(ids).toContain(91);       // expired a minute ago: still inside the retention window
    expect(ids).toContain(92);       // live: untouched
  });
});

describe("issueLoginCode", () => {
  it("returns a six-digit code and stores it hashed, never in the clear", async () => {
    const result = await issueLoginCode(EMAIL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.code).toMatch(/^\d{6}$/);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.codeHash).not.toContain(result.code);
    expect(store.rows[0]!.codeHash).toHaveLength(64);
  });

  it("supersedes the previous code, so only the newest one works", async () => {
    const first = await issueLoginCode(EMAIL);
    const second = await issueLoginCode(EMAIL);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(await verifyLoginCode(EMAIL, first.code)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyLoginCode(EMAIL, second.code)).toEqual({ ok: true });
  });

  it("throttles after 5 sends in the window", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await issueLoginCode(EMAIL)).ok).toBe(true);
    }
    expect(await issueLoginCode(EMAIL)).toEqual({ ok: false, reason: "throttled" });
  });

  it("throttles per address, so one person cannot block another", async () => {
    for (let i = 0; i < 5; i++) await issueLoginCode(EMAIL);
    expect((await issueLoginCode("someone.else@acme.com")).ok).toBe(true);
  });

  it("treats addresses case-insensitively", async () => {
    const issued = await issueLoginCode("User@ACME.com");
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(store.rows[0]!.email).toBe(EMAIL);
    expect(await verifyLoginCode(EMAIL, issued.code)).toEqual({ ok: true });
  });
});

describe("verifyLoginCode", () => {
  it("accepts the right code exactly once", async () => {
    const issued = await issueLoginCode(EMAIL);
    if (!issued.ok) throw new Error("expected a code");

    expect(await verifyLoginCode(EMAIL, issued.code)).toEqual({ ok: true });
    // Replaying it must not mint a second session.
    expect(await verifyLoginCode(EMAIL, issued.code)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a code that was never issued", async () => {
    expect(await verifyLoginCode(EMAIL, "123456")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an expired code and burns it", async () => {
    const issued = await issueLoginCode(EMAIL);
    if (!issued.ok) throw new Error("expected a code");

    store.rows[0]!.expiresAt = new Date(Date.now() - 1000);

    expect(await verifyLoginCode(EMAIL, issued.code)).toEqual({ ok: false, reason: "expired" });
    expect(store.rows[0]!.consumedAt).not.toBeNull();
  });

  it("dies after 5 wrong guesses instead of allowing 10^6", async () => {
    const issued = await issueLoginCode(EMAIL);
    if (!issued.ok) throw new Error("expected a code");
    const wrong = issued.code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 4; i++) {
      expect(await verifyLoginCode(EMAIL, wrong)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await verifyLoginCode(EMAIL, wrong)).toEqual({ ok: false, reason: "too_many_attempts" });

    // The real code is worthless now — this is the property that bounds guessing.
    expect(await verifyLoginCode(EMAIL, issued.code)).toEqual({ ok: false, reason: "invalid" });
  });

  it("counts wrong guesses on the row", async () => {
    const issued = await issueLoginCode(EMAIL);
    if (!issued.ok) throw new Error("expected a code");
    const wrong = issued.code === "000000" ? "111111" : "000000";

    await verifyLoginCode(EMAIL, wrong);
    await verifyLoginCode(EMAIL, wrong);
    expect(store.rows[0]!.attempts).toBe(2);

    // A wrong guess must not invalidate the real code before the cap.
    expect(await verifyLoginCode(EMAIL, issued.code)).toEqual({ ok: true });
  });

  it("ignores surrounding whitespace in the submitted code", async () => {
    const issued = await issueLoginCode(EMAIL);
    if (!issued.ok) throw new Error("expected a code");
    expect(await verifyLoginCode(EMAIL, `  ${issued.code} `)).toEqual({ ok: true });
  });

  it("does not accept one address's code for another address", async () => {
    const issued = await issueLoginCode(EMAIL);
    if (!issued.ok) throw new Error("expected a code");
    expect(await verifyLoginCode("attacker@evil.com", issued.code)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  User@ACME.com  ")).toBe(EMAIL);
  });
});

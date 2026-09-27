/**
 * Unit tests for GET /api/dashboard/reply-trends
 *
 * Verifies that the clientId and campaignId query parameters correctly narrow
 * the chart data returned by the endpoint:
 *
 *   - No params → aggregated data across all clients and campaigns
 *   - clientId  → only that client's drafts appear in the totals
 *   - clientId + campaignId → only that campaign's drafts appear
 *   - clientId for a client with no drafts → all-zero buckets
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted shared state ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  // Built in UTC to match how the route buckets. Using local midday instead
  // put "today" on tomorrow's UTC date for anyone east of UTC, so these tests
  // passed or failed depending on the machine's timezone and the hour of day —
  // they broke on their own overnight, having changed nothing.
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  // Three drafts across two clients and two campaigns
  //   draft 1 – client 10, campaign 100, sent,     today
  //   draft 2 – client 10, campaign 100, pending,  today
  //   draft 3 – client 10, campaign 200, discarded, yesterday
  //   draft 4 – client 20, campaign 300, sent,     today
  const draftRows: Array<{
    id: number;
    clientId: number;
    campaignId: number | null;
    status: string;
    createdAt: Date;
  }> = [
    { id: 1, clientId: 10, campaignId: 100, status: "sent",      createdAt: today },
    { id: 2, clientId: 10, campaignId: 100, status: "pending",   createdAt: today },
    { id: 3, clientId: 10, campaignId: 200, status: "discarded", createdAt: yesterday },
    { id: 4, clientId: 20, campaignId: 300, status: "sent",      createdAt: today },
  ];

  // Track the last where-condition so we can replicate Drizzle filtering
  let lastConditions: Array<{ _col: { _name?: string }; _val: unknown }> = [];

  return {
    draftRows,
    getLastConditions: () => lastConditions,
    setLastConditions: (c: typeof lastConditions) => { lastConditions = c; },
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Minimal drizzle-orm mock: eq/gte produce tagged objects that our fake db can
// interpret.  and() collects them into an array.
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(
    (col: { _name?: string }, val: unknown) => ({ _type: "eq", _col: col, _val: val })
  ),
  and: vi.fn((...args: unknown[]) => ({ _type: "and", _args: args })),
  gte: vi.fn(
    (col: { _name?: string }, val: unknown) => ({ _type: "gte", _col: col, _val: val })
  ),
  desc: vi.fn((col: unknown) => ({ _desc: col })),
}));

vi.mock("@workspace/db", () => {
  const draftsTable     = { _name: "drafts",    createdAt: { _name: "createdAt" }, status: { _name: "status" }, clientId: { _name: "clientId" }, campaignId: { _name: "campaignId" } };
  const clientsTable    = { _name: "clients" };
  const campaignsTable  = { _name: "campaigns" };
  const activityTable   = { _name: "activity" };
  const personasTable   = { _name: "personas" };
  const logsTable       = { _name: "logs" };

  type Condition =
    | { _type: "eq";  _col: { _name?: string }; _val: unknown }
    | { _type: "gte"; _col: { _name?: string }; _val: unknown }
    | { _type: "and"; _args: Condition[] };

  function applyConditions(
    rows: typeof mocks.draftRows,
    condition: Condition | undefined
  ): typeof mocks.draftRows {
    if (!condition) return rows;

    if (condition._type === "gte") {
      const since = condition._val as Date;
      return rows.filter((r) => r.createdAt >= since);
    }

    if (condition._type === "eq") {
      const val = condition._val;
      const col = condition._col._name;
      return rows.filter((r) => {
        const key = col as keyof typeof r;
        return r[key] === val;
      });
    }

    if (condition._type === "and") {
      let result = rows;
      for (const cond of condition._args) {
        result = applyConditions(result, cond as Condition);
      }
      return result;
    }

    return rows;
  }

  return {
    draftsTable,
    clientsTable,
    campaignsTable,
    activityTable,
    personasTable,
    logsTable,
    db: {
      select: () => ({
        from: (table: object) => ({
          where: (condition: Condition) => {
            if (table === draftsTable) {
              const filtered = applyConditions([...mocks.draftRows], condition);
              // Return only the shape the route needs
              return Promise.resolve(
                filtered.map((r) => ({ createdAt: r.createdAt, status: r.status }))
              );
            }
            return Promise.resolve([]);
          },
          orderBy: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    },
  };
});

// The /api router is gated by requireOperator, so these route tests need an
// operator session; the real store-backed session would need Postgres.
vi.mock("express-session", async () =>
  (await import("../testing/sessionMock")).expressSessionMock());

// ─── App import (after all vi.mock calls) ─────────────────────────────────────

import request from "supertest";
import app from "../app";
import { loginAsOperator } from "../testing/sessionMock";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TrendBucket {
  date: string;
  sent: number;
  edited: number;
  pending: number;
  discarded: number;
  send_failed: number;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function fetchTrends(query: Record<string, unknown>): Promise<TrendBucket[]> {
  const res = await request(app)
    .get("/api/dashboard/reply-trends")
    .query(query);
  expect(res.status).toBe(200);
  return res.body as TrendBucket[];
}

function bucketFor(trends: TrendBucket[], date: string): TrendBucket | undefined {
  return trends.find((b) => b.date === date);
}

function totalDrafts(trends: TrendBucket[]): number {
  return trends.reduce(
    (sum, b) => sum + b.sent + b.edited + b.pending + b.discarded + b.send_failed,
    0
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/dashboard/reply-trends — filter correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginAsOperator();
  });

  it("returns 30 date buckets regardless of filters", async () => {
    const trends = await fetchTrends({});
    expect(trends).toHaveLength(30);
    // Every entry has all required status keys
    for (const b of trends) {
      expect(b).toHaveProperty("date");
      expect(b).toHaveProperty("sent");
      expect(b).toHaveProperty("edited");
      expect(b).toHaveProperty("pending");
      expect(b).toHaveProperty("discarded");
      expect(b).toHaveProperty("send_failed");
    }
  });

  it("with no filters, includes drafts from all clients and campaigns", async () => {
    const trends = await fetchTrends({});
    // All 4 drafts are within the last 30 days → total count across all buckets = 4
    expect(totalDrafts(trends)).toBe(4);
  });

  it("filtering by clientId=10 includes only that client's drafts (3 of 4)", async () => {
    const trends = await fetchTrends({ clientId: 10 });
    // Client 10 has drafts 1, 2, 3 → total 3
    expect(totalDrafts(trends)).toBe(3);

    // Today's bucket: sent=1, pending=1 for client 10
    const today = bucketFor(trends, todayKey());
    expect(today?.sent).toBe(1);
    expect(today?.pending).toBe(1);
    expect(today?.discarded).toBe(0);

    // Yesterday's bucket: discarded=1 for client 10
    const yesterday = bucketFor(trends, yesterdayKey());
    expect(yesterday?.discarded).toBe(1);
    expect(yesterday?.sent).toBe(0);
  });

  it("filtering by clientId=20 includes only that client's drafts (1 of 4)", async () => {
    const trends = await fetchTrends({ clientId: 20 });
    expect(totalDrafts(trends)).toBe(1);

    const today = bucketFor(trends, todayKey());
    expect(today?.sent).toBe(1);
    expect(today?.pending).toBe(0);
    expect(today?.discarded).toBe(0);
  });

  it("filtering by clientId=10 + campaignId=100 narrows to that campaign only (2 drafts)", async () => {
    const trends = await fetchTrends({ clientId: 10, campaignId: 100 });
    // Campaign 100 has drafts 1 (sent) and 2 (pending) → total 2
    expect(totalDrafts(trends)).toBe(2);

    const today = bucketFor(trends, todayKey());
    expect(today?.sent).toBe(1);
    expect(today?.pending).toBe(1);
    expect(today?.discarded).toBe(0);
  });

  it("filtering by clientId=10 + campaignId=200 narrows to that campaign only (1 draft)", async () => {
    const trends = await fetchTrends({ clientId: 10, campaignId: 200 });
    // Campaign 200 has draft 3 (discarded, yesterday) → total 1
    expect(totalDrafts(trends)).toBe(1);

    const today = bucketFor(trends, todayKey());
    expect(today?.sent).toBe(0);
    expect(today?.pending).toBe(0);
    expect(today?.discarded).toBe(0);

    const yesterday = bucketFor(trends, yesterdayKey());
    expect(yesterday?.discarded).toBe(1);
    expect(yesterday?.sent).toBe(0);
  });

  it("filtering by a clientId that has no drafts yields all-zero buckets", async () => {
    // clientId=999 does not exist in our mock data
    const trends = await fetchTrends({ clientId: 999 });
    expect(totalDrafts(trends)).toBe(0);
    expect(trends).toHaveLength(30);
    for (const b of trends) {
      expect(b.sent).toBe(0);
      expect(b.pending).toBe(0);
      expect(b.discarded).toBe(0);
      expect(b.edited).toBe(0);
      expect(b.send_failed).toBe(0);
    }
  });

  it("selecting 'All clients' (no clientId param) resets campaign filter — shows all drafts", async () => {
    // Simulate what happens when the user resets to "All clients":
    // the frontend clears campaignId too, so the request has no params at all.
    const trends = await fetchTrends({});
    expect(totalDrafts(trends)).toBe(4);
  });

  it("responds with 400 for an invalid (non-numeric) clientId", async () => {
    const res = await request(app)
      .get("/api/dashboard/reply-trends")
      .query({ clientId: "not-a-number" });
    expect(res.status).toBe(400);
  });

  it("responds with 400 for an invalid (non-numeric) campaignId", async () => {
    const res = await request(app)
      .get("/api/dashboard/reply-trends")
      .query({ campaignId: "bad" });
    expect(res.status).toBe(400);
  });

  it("the buckets are in chronological order (oldest first)", async () => {
    const trends = await fetchTrends({});
    for (let i = 1; i < trends.length; i++) {
      expect(trends[i].date >= trends[i - 1].date).toBe(true);
    }
  });
});

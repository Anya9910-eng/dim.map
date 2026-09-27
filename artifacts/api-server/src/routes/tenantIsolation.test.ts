/**
 * Tenant isolation across the real routers.
 *
 * Two things are checked here, on the real app with the real middleware chain:
 *
 *   1. Operator-only surfaces refuse a client user outright.
 *   2. Routes both populations share actually constrain their query to the
 *      caller's own client — asserted on the condition the route hands to the
 *      driver, because the failure being guarded against is a route that
 *      forgets to scope at all.
 *
 * The helpers themselves are unit-tested in middleware/scope.test.ts.
 */
import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

const CLIENT_A = 1;
const CLIENT_B = 2;

/** Every condition passed to a `.where()` during a request. */
const captured: unknown[] = [];

vi.mock("express-session", async () =>
  (await import("../testing/sessionMock")).expressSessionMock());

// Response schemas pass through: these tests assert on access, not on
// serialisation, and validating would mean a full fixture per table.
vi.mock("@workspace/api-zod", async (importOriginal) => {
  // Every schema becomes a pass-through. The real export names are taken from
  // the module itself so vitest can still resolve each named import.
  const actual = (await importOriginal()) as Record<string, unknown>;
  const permissive = {
    parse: (v: unknown) => v,
    safeParse: (v: unknown) => ({ success: true, data: v }),
  };
  return Object.fromEntries(Object.keys(actual).map((k) => [k, permissive]));
});

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  and: (...args: unknown[]) => ({ kind: "and", args: args.filter(Boolean) }),
  or: (...args: unknown[]) => ({ kind: "or", args: args.filter(Boolean) }),
  desc: (col: unknown) => col,
  gte: () => ({ kind: "gte" }),
  lt: () => ({ kind: "lt" }),
  like: () => ({ kind: "like" }),
  inArray: () => ({ kind: "inArray" }),
  isNull: () => ({ kind: "isNull" }),
  isNotNull: () => ({ kind: "isNotNull" }),
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));

vi.mock("@workspace/db", () => {
  const table = (prefix: string) =>
    new Proxy({}, { get: (_t, key) => `${prefix}.${String(key)}` });

  const chain = (): Record<string, unknown> => {
    const result = Promise.resolve([]) as unknown as Record<string, unknown>;
    result.where = (c: unknown) => { captured.push(c); return chain(); };
    result.orderBy = () => chain();
    result.limit = () => chain();
    result.returning = () => Promise.resolve([]);
    result.set = () => chain();
    result.values = () => chain();
    return result;
  };

  return {
    draftsTable: table("drafts"),
    clientsTable: table("clients"),
    campaignsTable: table("campaigns"),
    personasTable: table("personas"),
    logsTable: table("logs"),
    activityTable: table("activity"),
    clientUsersTable: table("client_users"),
    setupItemsTable: table("setup_items"),
    epicgramDraftsTable: table("epicgram_drafts"),
    db: {
      select: () => ({ from: () => chain() }),
      insert: () => chain(),
      update: () => chain(),
      delete: () => chain(),
    },
  };
});

const { default: request } = await import("supertest");
const { default: app } = await import("../app");
const { loginAsOperator, loginAsClientUser, logoutOperator } =
  await import("../testing/sessionMock");

type Cond = { kind?: string; col?: unknown; val?: unknown; args?: Cond[] };

/** True when any captured condition pins `column` to `value`. */
function scopedTo(column: string, value: number): boolean {
  const walk = (c: Cond | undefined): boolean => {
    if (!c) return false;
    if (c.kind === "eq" && c.col === column && c.val === value) return true;
    return (c.args ?? []).some(walk);
  };
  return captured.some((c) => walk(c as Cond));
}

beforeEach(() => { captured.length = 0; });
afterAll(() => logoutOperator());

describe("a client user's queries are constrained to their own client", () => {
  beforeEach(() => loginAsClientUser(CLIENT_A));

  it("scopes the drafts list", async () => {
    await request(app).get("/api/drafts");
    expect(scopedTo("drafts.clientId", CLIENT_A)).toBe(true);
  });

  it("keeps its own scope even when asked for another client", async () => {
    // The caller's scope is appended, never replaced by the query string.
    await request(app).get(`/api/drafts?clientId=${CLIENT_B}`);
    expect(scopedTo("drafts.clientId", CLIENT_A)).toBe(true);
  });

  it("scopes pending drafts", async () => {
    await request(app).get("/api/drafts/pending");
    expect(scopedTo("drafts.clientId", CLIENT_A)).toBe(true);
  });

  it("scopes campaigns", async () => {
    await request(app).get("/api/campaigns");
    expect(scopedTo("campaigns.clientId", CLIENT_A)).toBe(true);
  });

  it("scopes personas", async () => {
    await request(app).get("/api/personas");
    expect(scopedTo("personas.clientId", CLIENT_A)).toBe(true);
  });

  it("scopes logs", async () => {
    await request(app).get("/api/logs");
    expect(scopedTo("logs.clientId", CLIENT_A)).toBe(true);
  });

  it("scopes the activity feed", async () => {
    await request(app).get("/api/dashboard/activity");
    expect(scopedTo("activity.clientId", CLIENT_A)).toBe(true);
  });

  it("scopes every aggregate on the dashboard", async () => {
    // An unscoped count still leaks how much data exists in total.
    await request(app).get("/api/dashboard/stats");
    expect(scopedTo("drafts.clientId", CLIENT_A)).toBe(true);
    expect(scopedTo("campaigns.clientId", CLIENT_A)).toBe(true);
    expect(scopedTo("personas.clientId", CLIENT_A)).toBe(true);
    expect(scopedTo("clients.id", CLIENT_A)).toBe(true);
  });

  it("scopes the client list to their own record", async () => {
    await request(app).get("/api/clients");
    expect(scopedTo("clients.id", CLIENT_A)).toBe(true);
  });

  it("scopes an update inside its WHERE", async () => {
    // A check performed after the write would run too late to stop it.
    await request(app).patch("/api/campaigns/99").send({ name: "x" });
    expect(scopedTo("campaigns.clientId", CLIENT_A)).toBe(true);
  });

  it("scopes a delete the same way", async () => {
    await request(app).delete("/api/personas/99");
    expect(scopedTo("personas.clientId", CLIENT_A)).toBe(true);
  });
});

describe("an operator's queries are not constrained", () => {
  beforeEach(() => loginAsOperator());

  it("adds no client condition to the drafts list", async () => {
    await request(app).get("/api/drafts");
    expect(scopedTo("drafts.clientId", CLIENT_A)).toBe(false);
    expect(scopedTo("drafts.clientId", CLIENT_B)).toBe(false);
  });

  it("adds no condition at all to the client list", async () => {
    await request(app).get("/api/clients");
    expect(captured.length).toBe(0);
  });
});

describe("operator-only surfaces refuse a client user", () => {
  beforeEach(() => loginAsClientUser(CLIENT_A));

  const forbidden: Array<[string, string]> = [
    ["post", "/api/clients"],
    ["patch", "/api/clients/1"],
    ["delete", "/api/clients/1"],
    ["get", "/api/clients/1/lemlist-webhook"],
    ["post", "/api/clients/1/lemlist-webhook/regenerate"],
    ["get", "/api/clients/1/users"],
    ["post", "/api/clients/1/users"],
    ["delete", "/api/clients/1/users/1"],
    ["get", "/api/integrations/status"],
    ["post", "/api/integrations/test/claude"],
    ["get", "/api/slack/channels"],
    ["get", "/api/slack/workspace"],
    ["post", "/api/slack/send-approval"],
    ["post", "/api/slack/test-message"],
    ["get", "/api/setup"],
  ];

  it.each(forbidden)("%s %s", async (method, path) => {
    const agent = request(app) as unknown as Record<
      string,
      (p: string) => Promise<{ status: number }>
    >;
    const res = await agent[method](path);
    expect([401, 403]).toContain(res.status);
  });
});

describe("without a session", () => {
  beforeEach(() => logoutOperator());

  it("every data route is refused before it reaches the database", async () => {
    for (const path of ["/api/drafts", "/api/clients", "/api/campaigns", "/api/dashboard/stats"]) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect(captured.length).toBe(0);
  });
});

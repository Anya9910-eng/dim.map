/**
 * Baseline HTTP security posture.
 *
 * CORS was `origin: true` with `credentials: true`, which tells the browser
 * that any site may make authenticated requests. Only SameSite=Lax on the
 * session cookie was preventing that — one unrelated setting away from account
 * takeover.
 */

import { vi, describe, it, expect } from "vitest";
import request from "supertest";

vi.mock("express-session", async () =>
  (await import("./testing/sessionMock")).expressSessionMock());

vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
  clientsTable: {}, campaignsTable: {}, draftsTable: {}, logsTable: {},
  activityTable: {}, personasTable: {}, loginCodesTable: {}, clientUsersTable: {},
  setupItemsTable: {}, repliesTable: {},
}));

// app.ts builds its CORS allowlist at module load, and `import` is hoisted
// above ordinary top-level code — so this has to run in a hoisted block or the
// allowlist is computed before the variable exists.
vi.hoisted(() => { process.env["APP_BASE_URL"] = "https://draftfly.app"; });

import app from "./app";

describe("CORS", () => {
  it("allows the app's own origin", async () => {
    const res = await request(app).get("/api/healthz").set("Origin", "https://draftfly.app");
    expect(res.headers["access-control-allow-origin"]).toBe("https://draftfly.app");
  });

  it("does not grant an arbitrary origin", async () => {
    const res = await request(app).get("/api/healthz").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // A near-miss hostname must not slip through a substring check.
  it("does not grant a lookalike origin", async () => {
    const res = await request(app).get("/api/healthz").set("Origin", "https://draftfly.app.evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("still serves same-origin and server-to-server callers with no Origin", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
  });
});

describe("security headers", () => {
  it("are present on responses", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=31536000/);
  });

  it("no longer advertises the framework", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

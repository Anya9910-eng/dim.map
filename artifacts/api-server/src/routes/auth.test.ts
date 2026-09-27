/**
 * Email code sign-in.
 *
 * The identity layer and the code store are mocked; what is under test is the
 * route behaviour that decides who gets a session — in particular the two
 * properties that are easy to lose in a refactor:
 *
 *   - `/auth/request-code` answers identically for a known and an unknown
 *     address, so the endpoint cannot be used to enumerate customers.
 *   - `/auth/verify-code` re-resolves the role after checking the code, so a
 *     revocation during the code's ten-minute life is honoured.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockResolveIdentity, mockIssue, mockVerify, mockSendEmail, mockSendWelcome, mockCreateAccount } = vi.hoisted(() => ({
  mockResolveIdentity: vi.fn(),
  mockIssue: vi.fn(),
  mockVerify: vi.fn(),
  mockSendEmail: vi.fn(),
  mockSendWelcome: vi.fn(),
  mockCreateAccount: vi.fn(),
}));

vi.mock("../lib/identity", () => ({
  resolveIdentity: mockResolveIdentity,
}));

vi.mock("../lib/loginCodes", () => ({
  issueLoginCode: mockIssue,
  verifyLoginCode: mockVerify,
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
}));

vi.mock("../lib/email", () => ({
  sendLoginCodeEmail: mockSendEmail,
  sendWelcomeEmail: mockSendWelcome,
}));

vi.mock("../lib/signup", () => ({
  createSelfServeAccount: mockCreateAccount,
}));

import authRouter from "./auth";

let currentSession: Record<string, unknown> = {};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const session = currentSession as Record<string, unknown> & {
      regenerate: (cb: (e?: Error) => void) => void;
      save: (cb: (e?: Error) => void) => void;
      destroy: (cb: (e?: Error) => void) => void;
    };
    // express-session's async callbacks, reduced to what these routes call.
    session.regenerate = (cb) => cb();
    session.save = (cb) => cb();
    session.destroy = (cb) => cb();
    (req as unknown as { session: unknown }).session = session;
    next();
  });
  app.use("/api", authRouter);
  return app;
}

const app = buildApp();

beforeEach(() => {
  vi.clearAllMocks();
  currentSession = {};
  mockSendEmail.mockResolvedValue({ delivered: true });
});

describe("POST /api/auth/request-code", () => {
  it("sends a code to an address that has access", async () => {
    mockResolveIdentity.mockResolvedValue({ role: "client", clientId: 3 });
    mockIssue.mockResolvedValue({ ok: true, code: "123456" });

    const res = await request(app).post("/api/auth/request-code").send({ email: "user@acme.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockSendEmail).toHaveBeenCalledWith("user@acme.com", "123456");
  });

  it("answers the same for an unknown address, and sends nothing", async () => {
    mockResolveIdentity.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/request-code").send({ email: "stranger@nowhere.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockIssue).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("answers the same when throttled, so repeated requests reveal nothing", async () => {
    mockResolveIdentity.mockResolvedValue({ role: "operator", clientId: null });
    mockIssue.mockResolvedValue({ ok: false, reason: "throttled" });

    const res = await request(app).post("/api/auth/request-code").send({ email: "op@draftfly.app" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("lowercases the address before looking it up", async () => {
    mockResolveIdentity.mockResolvedValue(null);

    await request(app).post("/api/auth/request-code").send({ email: "  User@ACME.com  " });

    expect(mockResolveIdentity).toHaveBeenCalledWith("user@acme.com");
  });

  it("rejects a malformed address without touching the store", async () => {
    const res = await request(app).post("/api/auth/request-code").send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(mockIssue).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/verify-code", () => {
  it("mints a scoped session for a client user", async () => {
    mockVerify.mockResolvedValue({ ok: true });
    mockResolveIdentity.mockResolvedValue({ role: "client", clientId: 7 });

    const res = await request(app)
      .post("/api/auth/verify-code")
      .send({ email: "user@acme.com", code: "123456" });

    expect(res.status).toBe(200);
    expect(currentSession["user"]).toMatchObject({
      email: "user@acme.com",
      role: "client",
      clientId: 7,
    });
  });

  it("mints an unscoped session for an operator", async () => {
    mockVerify.mockResolvedValue({ ok: true });
    mockResolveIdentity.mockResolvedValue({ role: "operator", clientId: null });

    await request(app).post("/api/auth/verify-code").send({ email: "op@draftfly.app", code: "123456" });

    expect(currentSession["user"]).toMatchObject({ role: "operator", clientId: null });
  });

  it("refuses a wrong code and creates no session", async () => {
    mockVerify.mockResolvedValue({ ok: false, reason: "invalid" });

    const res = await request(app)
      .post("/api/auth/verify-code")
      .send({ email: "user@acme.com", code: "000000" });

    expect(res.status).toBe(401);
    expect(currentSession["user"]).toBeUndefined();
    expect(mockResolveIdentity).not.toHaveBeenCalled();
  });

  it("says the code expired rather than that it was wrong", async () => {
    mockVerify.mockResolvedValue({ ok: false, reason: "expired" });

    const res = await request(app)
      .post("/api/auth/verify-code")
      .send({ email: "user@acme.com", code: "123456" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  it("refuses a valid code whose access was revoked while it was in flight", async () => {
    mockVerify.mockResolvedValue({ ok: true });
    mockResolveIdentity.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/verify-code")
      .send({ email: "removed@acme.com", code: "123456" });

    expect(res.status).toBe(403);
    expect(currentSession["user"]).toBeUndefined();
  });

  it("rejects a non-numeric code before consulting the store", async () => {
    const res = await request(app)
      .post("/api/auth/verify-code")
      .send({ email: "user@acme.com", code: "abcdef" });

    expect(res.status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/me", () => {
  it("answers 401 when signed out", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the session user when signed in", async () => {
    currentSession = { user: { id: "op@x.com", name: "Op", email: "op@x.com", role: "operator", clientId: null } };
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: "op@x.com", role: "operator" });
  });
});

describe("POST /auth/signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSession = {};
    mockIssue.mockResolvedValue({ ok: true, code: "123456" });
    mockSendEmail.mockResolvedValue({ delivered: true });
    mockSendWelcome.mockResolvedValue({ delivered: true });
  });

  const valid = { email: "new@agency.example", name: "Jane Doe", company: "Agency Co" };

  it("creates the account, then sends a sign-in code like any other login", async () => {
    mockCreateAccount.mockResolvedValue({ kind: "created", clientId: 42 });
    const res = await request(buildApp()).post("/api/auth/signup").send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockCreateAccount).toHaveBeenCalledWith({ email: "new@agency.example", name: "Jane Doe", company: "Agency Co" });
    expect(mockIssue).toHaveBeenCalledWith("new@agency.example");
    expect(mockSendEmail).toHaveBeenCalledWith("new@agency.example", "123456");
    expect(mockSendWelcome).toHaveBeenCalledWith("new@agency.example", "Jane Doe");
  });

  it("answers identically when the address already has access — and still sends a code", async () => {
    // Enumeration guard: a taken address must not be distinguishable from a new one.
    mockCreateAccount.mockResolvedValue({ kind: "existing" });
    const res = await request(buildApp()).post("/api/auth/signup").send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockSendEmail).toHaveBeenCalledWith("new@agency.example", "123456");
    expect(mockSendWelcome).not.toHaveBeenCalled();
  });

  it("lowercases the address before it touches anything", async () => {
    mockCreateAccount.mockResolvedValue({ kind: "created", clientId: 1 });
    await request(buildApp()).post("/api/auth/signup").send({ ...valid, email: "  New@Agency.EXAMPLE " });
    expect(mockCreateAccount).toHaveBeenCalledWith(expect.objectContaining({ email: "new@agency.example" }));
  });

  it.each([
    ["missing email", { name: "J", company: "C" }],
    ["malformed email", { ...valid, email: "nope" }],
    ["missing name", { email: valid.email, company: "C" }],
    ["blank company", { ...valid, company: "  " }],
    ["overlong name", { ...valid, name: "x".repeat(121) }],
  ])("rejects %s with 400 before creating anything", async (_label, body) => {
    const res = await request(buildApp()).post("/api/auth/signup").send(body);
    expect(res.status).toBe(400);
    expect(mockCreateAccount).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still answers ok when the code is throttled, without sending", async () => {
    mockCreateAccount.mockResolvedValue({ kind: "created", clientId: 1 });
    mockIssue.mockResolvedValue({ ok: false, reason: "throttled" });
    const res = await request(buildApp()).post("/api/auth/signup").send(valid);
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 500 when the account cannot be created — never a silent ok", async () => {
    mockCreateAccount.mockRejectedValue(new Error("db down"));
    const res = await request(buildApp()).post("/api/auth/signup").send(valid);
    expect(res.status).toBe(500);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

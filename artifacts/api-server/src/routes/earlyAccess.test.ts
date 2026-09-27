/**
 * The landing page's lead form.
 *
 * The storage layer is mocked; under test is the contract the form relies on:
 * a well-formed request is accepted and passed through unchanged, malformed
 * ones are refused before touching storage, and a storage failure surfaces as
 * an error the form can show — never a silent 2xx that loses the lead.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockRecord } = vi.hoisted(() => ({ mockRecord: vi.fn() }));

vi.mock("../lib/earlyAccess", () => ({
  recordEarlyAccessRequest: mockRecord,
}));

import earlyAccessRouter from "./earlyAccess";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", earlyAccessRouter);
  return app;
}

describe("POST /api/early-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecord.mockResolvedValue({ stored: true });
  });

  it("accepts a name and email and hands them to storage", async () => {
    const res = await request(buildApp())
      .post("/api/early-access")
      .send({ name: "Jane Doe", email: "jane@agency.example" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    expect(mockRecord).toHaveBeenCalledWith("Jane Doe", "jane@agency.example");
  });

  it("answers the same 202 for a duplicate as for a first request", async () => {
    mockRecord.mockResolvedValue({ stored: false });
    const res = await request(buildApp())
      .post("/api/early-access")
      .send({ name: "Jane Doe", email: "jane@agency.example" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
  });

  it.each([
    ["missing name", { email: "jane@agency.example" }],
    ["blank name", { name: "   ", email: "jane@agency.example" }],
    ["overlong name", { name: "x".repeat(121), email: "jane@agency.example" }],
    ["missing email", { name: "Jane" }],
    ["malformed email", { name: "Jane", email: "not-an-email" }],
    ["non-string email", { name: "Jane", email: 42 }],
  ])("rejects %s with 400 without touching storage", async (_label, body) => {
    const res = await request(buildApp()).post("/api/early-access").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("returns 500 with a fallback contact when storage fails — never a silent success", async () => {
    mockRecord.mockRejectedValue(new Error("connection refused"));
    const res = await request(buildApp())
      .post("/api/early-access")
      .send({ name: "Jane Doe", email: "jane@agency.example" });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain("outreach@draftfly.app");
  });
});

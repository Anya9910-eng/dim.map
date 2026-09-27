/**
 * Body size ceiling.
 *
 * express.json's 100kb default cost a live client four replies: a Lemlist
 * webhook carries the whole email thread, so a reply deep in a quoted chain
 * was rejected with 413 while a short one on the same campaign went through.
 * These tests pin the sizes on either side of that.
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

import app from "./app";

/** A reply thread of roughly the given size, as Lemlist would send it. */
function payloadOfSize(bytes: number) {
  return { campaignId: "cam_x", leadEmail: "a@b.com", replyText: "x".repeat(bytes) };
}

describe("request body limit", () => {
  // 300kb is comfortably over the old 100kb default and under the new 5mb —
  // the exact band that was silently failing.
  it("accepts a reply thread larger than the old 100kb default", async () => {
    const res = await request(app)
      .post("/api/webhooks/lemlist")
      .send(payloadOfSize(300 * 1024));

    // Whatever the route decides (401 without a secret, 200, 404), the point
    // is that the body parser did not reject it first.
    expect(res.status).not.toBe(413);
  });

  it("still refuses something absurd, rather than buffering it", async () => {
    const res = await request(app)
      .post("/api/webhooks/lemlist")
      .send(payloadOfSize(6 * 1024 * 1024));

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "Request body too large" });
  });

  it("answers a rejection as JSON, not an HTML error page", async () => {
    const res = await request(app)
      .post("/api/webhooks/lemlist")
      .send(payloadOfSize(6 * 1024 * 1024));

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

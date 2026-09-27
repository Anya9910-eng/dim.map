/**
 * Unit tests for sendReply — timeout behaviour
 *
 * Strategy: stub global `fetch` with a mock that honours the AbortSignal, then
 * pass a short `timeoutMs` override so tests complete in milliseconds rather
 * than waiting the full 30 s production timeout.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

// lemlist.ts loads @workspace/db for the per-client webhook middleware, and the
// real module throws without DATABASE_URL. `clientRowRef` lets each test choose
// which client row that middleware sees.
const { clientRowRef } = vi.hoisted(() => ({
  clientRowRef: { value: null as Record<string, unknown> | null },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _col, _val })),
}));

vi.mock("@workspace/db", () => ({
  clientsTable: { _name: "clients", id: { _name: "id" } },
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(clientRowRef.value ? [clientRowRef.value] : []),
      }),
    }),
  },
}));

import {
  sendReply,
  testConnection,
  getCampaigns,
  secretsMatch,
  generateWebhookSecret,
  resolveLemlistApiKey,
  isLemlistConfigured,
  requireClientWebhookSecret,
  getWebhookClient,
} from "./lemlist";

/** Builds a fetch mock that never resolves but rejects with AbortError when the
 * request's AbortSignal fires. */
function makeHangingFetchMock() {
  return (_url: string, options?: RequestInit): Promise<Response> =>
    new Promise<Response>((_resolve, reject) => {
      const signal = options?.signal;
      if (signal) {
        if (signal.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }
    });
}

/** Builds a fetch mock that resolves after `delayMs` but rejects with AbortError
 * if the signal fires first. */
/**
 * sendReply makes three calls: /team/senders and /user/channels to work out who
 * to send as, then /inbox/email. A mock that returned an empty body for all of
 * them made the JSON parse blow up, so it answers each path with the shape the
 * real API returns.
 */
function bodyForUrl(url: string): string | null {
  if (url.includes("/activities")) {
    // Newest first, and the newest rows carry no mailbox — mirrors the real
    // response, where "paused" and "conditionChosen" precede the sent email.
    return JSON.stringify([
      { type: "paused" },
      { type: "conditionChosen" },
      {
        type: "emailsSent",
        sendUserId: "usr_TEST",
        sendUserEmail: "sender@example.com",
        sendUserMailboxId: "usm_TEST",
      },
    ]);
  }
  return null;
}

function makeDelayedFetchMock(delayMs: number, status = 200) {
  return (url: string, options?: RequestInit): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(
        () => resolve(new Response(bodyForUrl(String(url)), { status })),
        delayMs,
      );
      const signal = options?.signal;
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }
    });
}

describe("sendReply — AbortSignal timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Each call below now passes the client's own key explicitly. These cases
    // are about the abort signal; they previously authenticated through the
    // global fallback that sendReply no longer honours.
    process.env.LEMLIST_API_KEY = "test-key-for-timeout-tests";
  });

  afterEach(() => {
    delete process.env.LEMLIST_API_KEY;
  });

  it("returns { ok: false, error: 'timeout' } when fetch hangs beyond timeoutMs", async () => {
    mockFetch.mockImplementation(makeHangingFetchMock());

    const result = await sendReply({
      leadId: "lead@example.com",
      campaignId: "cam_abc123",
      replyText: "Hi there",
      apiKey: "client-own-key",
      timeoutMs: 50,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("does NOT return 'timeout' when fetch resolves before timeoutMs", async () => {
    mockFetch.mockImplementation(makeDelayedFetchMock(0));

    const result = await sendReply({
      leadId: "lead@example.com",
      campaignId: "cam_abc123",
      replyText: "Hi there",
      apiKey: "client-own-key",
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns { ok: false, error: 'timeout' } when fetch resolves only after timeoutMs", async () => {
    mockFetch.mockImplementation(makeDelayedFetchMock(300));

    const result = await sendReply({
      leadId: "lead@example.com",
      campaignId: "cam_abc123",
      replyText: "Hi there",
      apiKey: "client-own-key",
      timeoutMs: 50,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("still throws non-abort errors rather than swallowing them", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      sendReply({
        leadId: "lead@example.com",
        campaignId: "cam_abc123",
        replyText: "Hi there",
      apiKey: "client-own-key",
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow("ECONNREFUSED");
  });
});

describe("testConnection — AbortSignal timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Each call below now passes the client's own key explicitly. These cases
    // are about the abort signal; they previously authenticated through the
    // global fallback that sendReply no longer honours.
    process.env.LEMLIST_API_KEY = "test-key-for-timeout-tests";
  });

  afterEach(() => {
    delete process.env.LEMLIST_API_KEY;
  });

  it("returns { ok: false, error: 'timeout' } when fetch hangs beyond timeoutMs", async () => {
    mockFetch.mockImplementation(makeHangingFetchMock());

    const result = await testConnection({ timeoutMs: 50 });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("returns { ok: true } when fetch resolves before timeoutMs", async () => {
    mockFetch.mockImplementation(makeDelayedFetchMock(0, 200));

    const result = await testConnection({ timeoutMs: 5_000 });

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns { ok: false, error: 'timeout' } when fetch resolves only after timeoutMs", async () => {
    mockFetch.mockImplementation(makeDelayedFetchMock(300, 200));

    const result = await testConnection({ timeoutMs: 50 });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("returns { ok: false } with HTTP error text on non-OK response", async () => {
    mockFetch.mockImplementation(makeDelayedFetchMock(0, 401));

    const result = await testConnection({ timeoutMs: 5_000 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
  });
});

describe("getCampaigns — AbortSignal timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Each call below now passes the client's own key explicitly. These cases
    // are about the abort signal; they previously authenticated through the
    // global fallback that sendReply no longer honours.
    process.env.LEMLIST_API_KEY = "test-key-for-timeout-tests";
  });

  afterEach(() => {
    delete process.env.LEMLIST_API_KEY;
  });

  it("throws 'timeout' when fetch hangs beyond timeoutMs", async () => {
    mockFetch.mockImplementation(makeHangingFetchMock());

    await expect(getCampaigns({ timeoutMs: 50 })).rejects.toThrow("timeout");
  });

  it("returns campaign array when fetch resolves before timeoutMs", async () => {
    const campaigns = [{ _id: "cam_1", name: "Q3 Outreach", status: "active" }];
    mockFetch.mockResolvedValue(new Response(JSON.stringify(campaigns), { status: 200 }));

    const result = await getCampaigns({ timeoutMs: 5_000 });

    expect(result).toEqual(campaigns);
  });

  it("throws 'timeout' when fetch resolves only after timeoutMs", async () => {
    mockFetch.mockImplementation(makeDelayedFetchMock(300, 200));

    await expect(getCampaigns({ timeoutMs: 50 })).rejects.toThrow("timeout");
  });

  it("still throws non-abort errors rather than swallowing them", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(getCampaigns({ timeoutMs: 5_000 })).rejects.toThrow("ECONNREFUSED");
  });
});

// ─── Per-client API key resolution ──────────────────────────────────────────

describe("resolveLemlistApiKey — per-client key with global fallback", () => {
  afterEach(() => {
    delete process.env.LEMLIST_API_KEY;
  });

  it("prefers the client's own key over the global env key", () => {
    process.env.LEMLIST_API_KEY = "global-key";
    expect(resolveLemlistApiKey("client-key")).toBe("client-key");
  });

  it("falls back to the global env key when the client has none", () => {
    process.env.LEMLIST_API_KEY = "global-key";
    expect(resolveLemlistApiKey(null)).toBe("global-key");
    expect(resolveLemlistApiKey(undefined)).toBe("global-key");
    expect(resolveLemlistApiKey("   ")).toBe("global-key");
  });

  it("reports unconfigured only when neither key exists", () => {
    expect(isLemlistConfigured(null)).toBe(false);
    expect(isLemlistConfigured("client-key")).toBe(true);
    process.env.LEMLIST_API_KEY = "global-key";
    expect(isLemlistConfigured(null)).toBe(true);
  });
});

describe("sendReply — authenticates as the client, not the global account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Answer each of sendReply's three calls with the shape it parses.
    mockFetch.mockImplementation((url: string | URL | Request) =>
      Promise.resolve(new Response(bodyForUrl(String(url)), { status: 200 })),
    );
  });

  afterEach(() => {
    delete process.env.LEMLIST_API_KEY;
  });

  function authHeaderFrom(call: unknown[]): string {
    const init = call[1] as RequestInit;
    return (init.headers as Record<string, string>)["Authorization"];
  }

  it("uses the client's key when one is supplied", async () => {
    process.env.LEMLIST_API_KEY = "global-key";

    await sendReply({
      leadId: "lead@example.com",
      campaignId: "cam_abc123",
      replyText: "Hi",
      apiKey: "client-b-key",
      timeoutMs: 5_000,
    });

    const expected = `Basic ${Buffer.from("any:client-b-key").toString("base64")}`;
    expect(authHeaderFrom(mockFetch.mock.calls[0] as unknown[])).toBe(expected);
  });

  // This previously asserted the opposite, as intended backward compatibility.
  // It is a cross-tenant hazard: sending is the one call with an irreversible
  // effect on someone else's inbox, and through the operator's account the lead
  // receives a reply from a mailbox they have never corresponded with, from a
  // business that is not the one they wrote to.
  it("refuses to fall back to the operator's key", async () => {
    process.env.LEMLIST_API_KEY = "global-key";

    const result = await sendReply({
      leadId: "lead@example.com",
      campaignId: "cam_abc123",
      replyText: "Hi",
      apiKey: null,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no Lemlist API key of their own/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports the missing key rather than sending unauthenticated", async () => {
    delete process.env.LEMLIST_API_KEY;

    const result = await sendReply({ leadId: "l@e.com", campaignId: "c", replyText: "Hi", apiKey: null });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no Lemlist API key of their own/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── Webhook secrets ────────────────────────────────────────────────────────

describe("secretsMatch — constant-time comparison", () => {
  it("matches identical secrets", () => {
    expect(secretsMatch("s3cret", "s3cret")).toBe(true);
  });

  it("rejects different secrets of equal length", () => {
    expect(secretsMatch("s3cretA", "s3cretB")).toBe(false);
  });

  it("rejects secrets of different length without throwing", () => {
    expect(secretsMatch("short", "a-much-longer-secret")).toBe(false);
    expect(secretsMatch("", "x")).toBe(false);
  });
});

describe("generateWebhookSecret", () => {
  it("returns a URL-safe high-entropy string", () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(encodeURIComponent(secret)).toBe(secret);
  });

  it("does not repeat", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateWebhookSecret()));
    expect(secrets.size).toBe(50);
  });
});

describe("requireClientWebhookSecret", () => {
  function makeReq(clientId: string, secret?: string, viaHeader = false) {
    return {
      params: { clientId },
      headers: viaHeader && secret ? { "x-webhook-secret": secret } : {},
      query: !viaHeader && secret ? { secret } : {},
      path: `/webhooks/lemlist/${clientId}`,
    } as never;
  }

  function makeRes() {
    const res = {
      locals: {} as Record<string, unknown>,
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res;
  }

  beforeEach(() => {
    clientRowRef.value = {
      id: 1,
      name: "Client A",
      lemlistApiKey: "key-a",
      lemlistWebhookSecret: "secret-a",
    };
  });

  it("accepts a client's own secret from the query string", async () => {
    const res = makeRes();
    const next = vi.fn();

    await requireClientWebhookSecret(makeReq("1", "secret-a"), res as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
    expect(getWebhookClient(res as never)?.id).toBe(1);
  });

  it("accepts the same secret from the X-Webhook-Secret header", async () => {
    const res = makeRes();
    const next = vi.fn();

    await requireClientWebhookSecret(makeReq("1", "secret-a", true), res as never, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects another client's secret with 401", async () => {
    const res = makeRes();
    const next = vi.fn();

    await requireClientWebhookSecret(makeReq("1", "secret-b"), res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.locals["lemlistWebhookClient"]).toBeUndefined();
  });

  it("rejects a request with no secret at all", async () => {
    const res = makeRes();
    const next = vi.fn();

    await requireClientWebhookSecret(makeReq("1"), res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("rejects a client that has no secret configured", async () => {
    clientRowRef.value = { id: 1, lemlistWebhookSecret: null };
    const res = makeRes();
    const next = vi.fn();

    await requireClientWebhookSecret(makeReq("1", "anything"), res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("answers 401 — not 404 — for an unknown client, so ids cannot be enumerated", async () => {
    clientRowRef.value = null;
    const res = makeRes();
    const next = vi.fn();

    await requireClientWebhookSecret(makeReq("999", "secret-a"), res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("rejects a non-numeric client id before touching the database", async () => {
    const res = makeRes();
    const next = vi.fn();

    await requireClientWebhookSecret(makeReq("simulate", "secret-a"), res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
  });
});

/**
 * The bug these guard against: sendReply used to POST
 * `/campaigns/{id}/leads/{id}/reply`, which is not a Lemlist route. It answers
 * 405 before authentication, so every approved reply failed identically and no
 * lead ever received one. A URL regression here is silent in production —
 * failures look like Lemlist's fault — so it is asserted directly.
 */
describe("sendReply — posts to the real Lemlist endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation((url: string | URL | Request) =>
      Promise.resolve(new Response(bodyForUrl(String(url)), { status: 200 })),
    );
  });

  function sendCall() {
    return (mockFetch.mock.calls as unknown[][]).find((c) =>
      String(c[0]).includes("/inbox/email"),
    );
  }

  it("sends to /inbox/email, never to the campaigns reply path", async () => {
    const result = await sendReply({
      leadId: "lea_abc",
      campaignId: "cam_abc123",
      replyText: "Hello",
      apiKey: "k",
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(sendCall()).toBeDefined();
    for (const call of mockFetch.mock.calls as unknown[][]) {
      expect(String(call[0])).not.toContain("/leads/");
      expect(String(call[0])).not.toContain("/reply");
    }
  });

  it("threads onto the existing conversation and identifies the sender", async () => {
    await sendReply({
      leadId: "lea_abc",
      campaignId: "cam_abc123",
      replyText: "Hello",
      apiKey: "k",
      timeoutMs: 5_000,
    });

    const body = JSON.parse((sendCall()![1] as RequestInit).body as string);
    expect(body).toMatchObject({
      leadId: "lea_abc",
      sendUserId: "usr_TEST",
      sendUserMailboxId: "usm_TEST",
      sendUserEmail: "sender@example.com",
      // "latest" makes it a reply in the lead's thread rather than a new email.
      replyToActivityId: "latest",
    });
  });

  it("sends the draft as HTML, since the endpoint requires it", async () => {
    await sendReply({
      leadId: "lea_abc",
      campaignId: "cam_abc123",
      replyText: "Line one\nstill one\n\nSecond para",
      apiKey: "k",
      timeoutMs: 5_000,
    });

    const body = JSON.parse((sendCall()![1] as RequestInit).body as string);
    expect(body.message).toBe("<p>Line one<br>still one</p><p>Second para</p>");
  });

  it("escapes HTML so a draft cannot inject markup into the email", async () => {
    await sendReply({
      leadId: "lea_abc",
      campaignId: "cam_abc123",
      replyText: "5 < 10 & <b>bold</b>",
      apiKey: "k",
      timeoutMs: 5_000,
    });

    const body = JSON.parse((sendCall()![1] as RequestInit).body as string);
    expect(body.message).toBe("<p>5 &lt; 10 &amp; &lt;b&gt;bold&lt;/b&gt;</p>");
  });

  // A campaign rotates across mailboxes to spread volume, so the reply has to
  // come from the one that emailed *this* lead. Replying from a sibling address
  // reaches them from someone they have never heard of, on a thread another
  // address started. Observed live: one campaign sending as both jashl@ and
  // jash@, which made "first mailbox" a coin flip.
  it("replies from the mailbox that emailed this lead, not another of the campaign's", async () => {
    mockFetch.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/activities")) {
        expect(u).toContain("leadId=lea_abc");
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { type: "paused" },
              {
                type: "emailsSent",
                sendUserId: "usr_TEST",
                sendUserEmail: "jashl@up2clean.co",
                sendUserMailboxId: "usm_THIS_LEAD",
              },
            ]),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    await sendReply({
      leadId: "lea_abc",
      campaignId: "cam_abc123",
      replyText: "Hello",
      apiKey: "k",
      timeoutMs: 5_000,
    });

    const body = JSON.parse((sendCall()![1] as RequestInit).body as string);
    expect(body.sendUserMailboxId).toBe("usm_THIS_LEAD");
    expect(body.sendUserEmail).toBe("jashl@up2clean.co");
  });

  it("refuses with a plain explanation when no activity names a mailbox", async () => {
    mockFetch.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/activities")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ type: "paused" }]), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(bodyForUrl(u), { status: 200 }));
    });

    const result = await sendReply({
      leadId: "lea_abc",
      campaignId: "cam_abc123",
      replyText: "Hello",
      apiKey: "k",
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not determine which mailbox/i);
    expect(sendCall()).toBeUndefined();
  });
});

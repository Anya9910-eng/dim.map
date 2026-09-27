/**
 * Unit tests for postFallbackFailureNotification
 *
 * Strategy: mock @slack/web-api's WebClient so chat.postMessage can be
 * controlled per-test. Each scenario verifies the exact sequence of targets
 * tried and that the function never throws.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mock ─────────────────────────────────────────────────────────────
// vi.mock factories are hoisted above imports; any variables they reference
// must be created via vi.hoisted() so they exist when the factory runs.

const { mockPostMessage, MockWebClient } = vi.hoisted(() => {
  const pm = vi.fn<() => Promise<{ ok: boolean; ts?: string }>>();
  // Use a regular function (not arrow) so it works as a `new` constructor.
  function MockWebClient(this: unknown) {
    return { chat: { postMessage: pm } };
  }
  return { mockPostMessage: pm, MockWebClient };
});

vi.mock("@slack/web-api", () => ({
  WebClient: MockWebClient,
}));

import { postFallbackFailureNotification } from "./slack";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_PARAMS = {
  userId: "U12345678",
  channelId: "C12345678",
  botToken: "xoxb-test-token",
  draftId: 42,
  prospectName: "Alice",
  prospectEmail: "alice@example.com",
  lemlistError: "rate_limited",
};

describe("postFallbackFailureNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure env vars don't interfere — botToken param is always supplied.
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
  });

  it("DM succeeds on first attempt — channel is never tried", async () => {
    mockPostMessage.mockResolvedValueOnce({ ok: true, ts: "111.222" });

    await postFallbackFailureNotification(BASE_PARAMS);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: BASE_PARAMS.userId }),
    );
  });

  it("DM fails, channel post succeeds — exactly two postMessage calls made", async () => {
    mockPostMessage
      .mockRejectedValueOnce(new Error("token_revoked"))
      .mockResolvedValueOnce({ ok: true, ts: "333.444" });

    await postFallbackFailureNotification(BASE_PARAMS);

    expect(mockPostMessage).toHaveBeenCalledTimes(2);
    expect(mockPostMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ channel: BASE_PARAMS.userId }),
    );
    expect(mockPostMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ channel: BASE_PARAMS.channelId }),
    );
  });

  it("both targets fail — function resolves without throwing", async () => {
    mockPostMessage
      .mockRejectedValueOnce(new Error("token_revoked"))
      .mockRejectedValueOnce(new Error("channel_not_found"));

    await expect(
      postFallbackFailureNotification(BASE_PARAMS),
    ).resolves.toBeUndefined();

    expect(mockPostMessage).toHaveBeenCalledTimes(2);
  });

  it("exits early (no API calls) when Slack is not configured and no botToken", async () => {
    await postFallbackFailureNotification({
      userId: "U12345678",
      channelId: "C12345678",
      draftId: 99,
      // botToken intentionally omitted; SLACK_BOT_TOKEN not set in env
    });

    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it("works with only userId (no channelId) — single attempt, resolves cleanly on success", async () => {
    mockPostMessage.mockResolvedValueOnce({ ok: true, ts: "555.666" });

    await postFallbackFailureNotification({
      userId: "U12345678",
      botToken: "xoxb-test-token",
      draftId: 7,
    });

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "U12345678" }),
    );
  });

  it("works with only userId (no channelId) — single attempt, resolves without throwing on failure", async () => {
    mockPostMessage.mockRejectedValueOnce(new Error("token_revoked"));

    await expect(
      postFallbackFailureNotification({
        userId: "U12345678",
        botToken: "xoxb-test-token",
        draftId: 8,
      }),
    ).resolves.toBeUndefined();

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
  });
});

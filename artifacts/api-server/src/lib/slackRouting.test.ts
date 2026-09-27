/**
 * Which channel a client's approval card goes to.
 *
 * This exists because the rule used to be "the client's channel, or else the
 * global SLACK_CHANNEL_ID". With one customer that was harmless. With several
 * it meant every client who had not set a channel had their prospect names,
 * email addresses and draft text posted into one shared channel — while the
 * dashboard was correctly scoped per client the whole time.
 */

import { describe, it, expect, afterEach } from "vitest";
import { resolveClientApprovalChannel, isRealSlackChannelId } from "./slack";

const GLOBAL = "C0BGD0Z578U";

afterEach(() => {
  delete process.env["SLACK_CHANNEL_ID"];
});

describe("resolveClientApprovalChannel", () => {
  it("uses the client's own channel", () => {
    expect(resolveClientApprovalChannel("C0BK6NPBHKJ")).toBe("C0BK6NPBHKJ");
  });

  it("returns null for a client with no channel, even when a global one is set", () => {
    process.env["SLACK_CHANNEL_ID"] = GLOBAL;
    expect(resolveClientApprovalChannel(null)).toBeNull();
    expect(resolveClientApprovalChannel("")).toBeNull();
    expect(resolveClientApprovalChannel(undefined)).toBeNull();
  });

  it("returns null for a placeholder or channel name rather than guessing", () => {
    process.env["SLACK_CHANNEL_ID"] = GLOBAL;
    expect(resolveClientApprovalChannel("general")).toBeNull();
    expect(resolveClientApprovalChannel("#sales")).toBeNull();
    expect(resolveClientApprovalChannel("your-channel-here")).toBeNull();
  });

  it("never returns the global channel for any input", () => {
    process.env["SLACK_CHANNEL_ID"] = GLOBAL;
    for (const input of [null, undefined, "", "general", "#x", "c012ab3cd45", "C012AB3CD45"]) {
      expect(resolveClientApprovalChannel(input)).not.toBe(GLOBAL);
    }
  });

  it("requires an uppercase C or G prefix, so a typo is not treated as a channel", () => {
    expect(resolveClientApprovalChannel("c012AB3CD45")).toBeNull();
    expect(isRealSlackChannelId("C012AB3CD45")).toBe(true);
    expect(isRealSlackChannelId("G012AB3CD45")).toBe(true);
  });
});

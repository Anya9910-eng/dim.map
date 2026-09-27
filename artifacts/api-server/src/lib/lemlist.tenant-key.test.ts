/**
 * Client-scoped Lemlist credentials.
 *
 * resolveLemlistApiKey falls back to the operator's LEMLIST_API_KEY. That is
 * right for the operator's own connection test and wrong for anything done on
 * behalf of a client: a client with no key would otherwise read the operator's
 * campaign list and send replies out of the operator's Lemlist account — the
 * same shape of mistake the global SLACK_CHANNEL_ID fallback made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// lemlist.ts pulls in the db module transitively, which refuses to load
// without DATABASE_URL. None of these assertions touch the database.
vi.mock("@workspace/db", () => ({
  db: {}, clientsTable: {}, campaignsTable: {}, draftsTable: {},
  logsTable: {}, activityTable: {}, personasTable: {},
}));

import {
  resolveLemlistApiKey,
  clientLemlistApiKey,
  isClientLemlistConfigured,
  isLemlistConfigured,
  sendReply,
} from "./lemlist";

const ORIGINAL = process.env["LEMLIST_API_KEY"];

beforeEach(() => { process.env["LEMLIST_API_KEY"] = "operator_global_key"; });
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env["LEMLIST_API_KEY"];
  else process.env["LEMLIST_API_KEY"] = ORIGINAL;
  vi.restoreAllMocks();
});

describe("client-scoped key resolution", () => {
  it("uses the client's own key when they have one", () => {
    expect(clientLemlistApiKey("client_own_key")).toBe("client_own_key");
  });

  it("never substitutes the operator's key for a client without one", () => {
    expect(resolveLemlistApiKey(null)).toBe("operator_global_key");
    expect(clientLemlistApiKey(null)).toBeUndefined();
    expect(clientLemlistApiKey("")).toBeUndefined();
    expect(clientLemlistApiKey("   ")).toBeUndefined();
  });

  it("reports a keyless client as unconfigured, not as configured with someone else's", () => {
    expect(isLemlistConfigured(null)).toBe(true);
    expect(isClientLemlistConfigured(null)).toBe(false);
    expect(isClientLemlistConfigured("client_own_key")).toBe(true);
  });
});

describe("sendReply", () => {
  it("refuses to send through the operator's account", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await sendReply({
      apiKey: null,
      leadId: "lea_x",
      campaignId: "cam_x",
      replyText: "hello",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no Lemlist API key of their own/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

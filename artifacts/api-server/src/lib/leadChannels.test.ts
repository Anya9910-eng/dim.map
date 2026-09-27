import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./lemlist", () => ({
  sendReply: vi.fn(() => Promise.resolve({ ok: true })),
}));

import {
  parseMetaPayload,
  parseWhatsAppPayload,
  normalizePhone,
  unsendableReason,
  sendApprovedReply,
  sendWhatsAppText,
  parseGooglePayload,
  isGoogleTestLead,
  channelLabel,
} from "./leadChannels";
import { sendReply } from "./lemlist";
import { parseQualification } from "./claude";

const WA_CLIENT = { whatsappPhoneNumberId: "1098765", whatsappAccessToken: "EAAG-token", lemlistApiKey: null };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("parseMetaPayload", () => {
  it("reads a Graph API lead with standard and custom questions", () => {
    const { leads, unresolvedLeadgenIds } = parseMetaPayload({
      id: "lead_1",
      form_id: "form_9",
      ad_id: "ad_7",
      campaign_id: "camp_3",
      field_data: [
        { name: "full_name", values: ["Omar Haddad"] },
        { name: "email", values: ["omar@example.com"] },
        { name: "phone_number", values: ["+971 50 123 4567"] },
        { name: "budget_range", values: ["AED 1.5M - 2M"] },
        { name: "when_do_you_plan_to_buy?", values: ["Within 3 months"] },
      ],
    });
    expect(unresolvedLeadgenIds).toEqual([]);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      channel: "meta",
      externalLeadId: "lead_1",
      firstName: "Omar",
      lastName: "Haddad",
      email: "omar@example.com",
      phone: "971501234567",
      campaignRefs: ["form_9", "ad_7", "camp_3"],
    });
    expect(leads[0].message).toContain("Budget range: AED 1.5M - 2M");
    expect(leads[0].message).toContain("When do you plan to buy?: Within 3 months");
  });

  it("reports native leadgen notifications that carry no answers instead of drafting them", () => {
    const { leads, unresolvedLeadgenIds } = parseMetaPayload({
      object: "page",
      entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "444", form_id: "form_9" } }] }],
    });
    expect(leads).toEqual([]);
    expect(unresolvedLeadgenIds).toEqual(["444"]);
  });

  it("accepts a flat payload from an automation", () => {
    const { leads } = parseMetaPayload({ name: "Lina Park", phone: "+44 7700 900123", formId: "f1", message: "2-bed please" });
    expect(leads[0]).toMatchObject({ firstName: "Lina", lastName: "Park", phone: "447700900123", campaignRefs: ["f1"], message: "2-bed please" });
  });

  it("ignores a body with nothing that identifies a person", () => {
    expect(parseMetaPayload({ hello: "world" }).leads).toEqual([]);
    expect(parseMetaPayload(null).leads).toEqual([]);
  });
});

describe("parseGooglePayload", () => {
  const googleLead = {
    lead_id: "TeSter-123",
    api_version: "1.0",
    form_id: 40000000,
    campaign_id: 12345,
    adgroup_id: 777,
    google_key: "secret",
    is_test: false,
    user_column_data: [
      { column_name: "Full Name", string_value: "Lina Park", column_id: "FULL_NAME" },
      { column_name: "User Email", string_value: "lina@example.com", column_id: "EMAIL" },
      { column_name: "User Phone", string_value: "+44 7700 900123", column_id: "PHONE_NUMBER" },
      { column_name: "What is your budget?", string_value: "AED 2M", column_id: "what_is_your_budget?" },
    ],
  };

  it("reads a Google Ads lead-form webhook", () => {
    expect(parseGooglePayload(googleLead, "google")).toEqual([expect.objectContaining({
      channel: "google",
      externalLeadId: "TeSter-123",
      firstName: "Lina",
      lastName: "Park",
      email: "lina@example.com",
      phone: "447700900123",
      campaignRefs: ["40000000", "12345", "777"],
    })]);
    expect(parseGooglePayload(googleLead, "google")[0].message).toContain("What is your budget?: AED 2M");
  });

  it("records the same form as a YouTube lead when it arrives on the YouTube URL", () => {
    const [lead] = parseGooglePayload(googleLead, "youtube");
    expect(lead.channel).toBe("youtube");
    expect(lead.message).toContain("YouTube ad");
    expect(channelLabel("youtube")).toBe("YouTube");
    expect(channelLabel("google")).toBe("Google Ads");
  });

  it("spots Google's test leads", () => {
    expect(isGoogleTestLead({ ...googleLead, is_test: true })).toBe(true);
    expect(isGoogleTestLead(googleLead)).toBe(false);
  });

  it("accepts a flat payload and ignores an empty one", () => {
    expect(parseGooglePayload({ name: "Ana Ruiz", phone: "+34 600 000 000", campaignId: "g1" }, "google")[0])
      .toMatchObject({ channel: "google", firstName: "Ana", phone: "34600000000", campaignRefs: ["g1"] });
    expect(parseGooglePayload({ user_column_data: [] }, "google")).toEqual([]);
  });
});

describe("parseWhatsAppPayload", () => {
  const cloudApi = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "1098765", display_phone_number: "971 4 000 0000" },
          contacts: [{ wa_id: "971501112222", profile: { name: "Sara Khan" } }],
          messages,
          ...extra,
        },
      }],
    }],
  });

  it("reads a text message from the Cloud API webhook", () => {
    const leads = parseWhatsAppPayload(cloudApi([
      { from: "971501112222", id: "wamid.1", type: "text", text: { body: "Is the 3-bed still available?" } },
    ]));
    expect(leads).toEqual([expect.objectContaining({
      channel: "whatsapp",
      externalLeadId: "971501112222",
      phone: "971501112222",
      firstName: "Sara",
      lastName: "Khan",
      email: "",
      message: "Is the 3-bed still available?",
      campaignRefs: ["1098765", "971 4 000 0000"],
    })]);
  });

  it("reads button and interactive replies", () => {
    const leads = parseWhatsAppPayload(cloudApi([
      { from: "971501112222", type: "button", button: { text: "Book a viewing" } },
      { from: "971501112222", type: "interactive", interactive: { type: "list_reply", list_reply: { title: "Payment plan" } } },
    ]));
    expect(leads.map((l) => l.message)).toEqual(["Book a viewing", "Payment plan"]);
  });

  it("yields nothing for delivery and read receipts", () => {
    expect(parseWhatsAppPayload(cloudApi([], { statuses: [{ status: "read" }] }))).toEqual([]);
  });

  it("accepts a flat payload", () => {
    expect(parseWhatsAppPayload({ phone: "+1 (555) 010-9999", name: "Ana", message: "hi", campaignId: "wa-main" })[0])
      .toMatchObject({ phone: "15550109999", firstName: "Ana", campaignRefs: ["wa-main"] });
  });
});

describe("normalizePhone", () => {
  it("keeps digits only", () => expect(normalizePhone("+971 (50) 123-4567")).toBe("971501234567"));
});

describe("unsendableReason", () => {
  const base = { lemlistLeadId: null, prospectEmail: "", prospectPhone: "971501112222" };

  it("allows a WhatsApp draft when the client has credentials", () => {
    expect(unsendableReason({ ...base, channel: "whatsapp" }, WA_CLIENT)).toBeNull();
  });

  it("refuses a WhatsApp draft without credentials", () => {
    expect(unsendableReason({ ...base, channel: "whatsapp" }, { whatsappPhoneNumberId: null, whatsappAccessToken: null }))
      .toMatch(/WhatsApp sending is not set up/);
  });

  it("sends a Google or YouTube lead with a number over WhatsApp", () => {
    expect(unsendableReason({ ...base, channel: "youtube" }, WA_CLIENT)).toBeNull();
    expect(unsendableReason({ ...base, channel: "google", prospectPhone: null, prospectEmail: "a@b.co" }, WA_CLIENT))
      .toMatch(/no phone number/);
  });

  it("refuses a Meta lead with no phone number", () => {
    expect(unsendableReason({ ...base, channel: "meta", prospectPhone: null, prospectEmail: "a@b.co" }, WA_CLIENT))
      .toMatch(/no phone number/);
  });

  it("treats a draft with no channel as Lemlist", () => {
    expect(unsendableReason({ lemlistLeadId: null, prospectEmail: "a@b.co" }, null)).toMatch(/predates Lemlist/);
    expect(unsendableReason({ lemlistLeadId: "lea_1", prospectEmail: "a@b.co" }, null)).toBeNull();
  });
});

describe("sendApprovedReply", () => {
  it("sends Lemlist drafts through Lemlist", async () => {
    await sendApprovedReply({
      draft: { channel: "lemlist", lemlistLeadId: "lea_1", prospectEmail: "a@b.co" },
      lemlistCampaignId: "cam_1",
      client: { ...WA_CLIENT, lemlistApiKey: "key" },
      replyText: "Hello",
    });
    expect(sendReply).toHaveBeenCalledWith({ leadId: "lea_1", campaignId: "cam_1", replyText: "Hello", apiKey: "key" });
  });

  it("sends WhatsApp drafts through the Cloud API from the client's number", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendApprovedReply({
      draft: { channel: "whatsapp", lemlistLeadId: null, prospectEmail: "", prospectPhone: "971501112222" },
      lemlistCampaignId: "wa",
      client: WA_CLIENT,
      replyText: "Yes, it is!",
    });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/1098765/messages");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer EAAG-token");
    expect(JSON.parse(String(init.body))).toMatchObject({ to: "971501112222", type: "text", text: { body: "Yes, it is!" } });
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("fails without a network call when WhatsApp is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendApprovedReply({
      draft: { channel: "meta", lemlistLeadId: null, prospectEmail: "", prospectPhone: "971501112222" },
      lemlistCampaignId: "form",
      client: { whatsappPhoneNumberId: null, whatsappAccessToken: null, lemlistApiKey: null },
      replyText: "Hi",
    });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendWhatsAppText", () => {
  it("surfaces Meta's error message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ error: { message: "Re-engagement message: more than 24 hours have passed" } }),
      { status: 400 },
    ))));
    const result = await sendWhatsAppText({ phoneNumberId: "1", accessToken: "t", to: "1", text: "x" });
    expect(result).toEqual({ ok: false, error: "WhatsApp HTTP 400: Re-engagement message: more than 24 hours have passed" });
  });
});

describe("parseQualification", () => {
  it("accepts the four grades in any case and rejects anything else", () => {
    expect(parseQualification("HOT")).toBe("hot");
    expect(parseQualification("unqualified")).toBe("unqualified");
    expect(parseQualification("lukewarm")).toBeNull();
    expect(parseQualification(undefined)).toBeNull();
  });
});

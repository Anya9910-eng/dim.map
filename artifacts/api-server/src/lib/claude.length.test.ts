/**
 * What happens when a reply does not fit in the output budget.
 *
 * The draft is wrapped in JSON, so a response cut off at max_tokens is both a
 * half-written message and half-written JSON. The parse then failed and the
 * raw text was returned *as the draft*, which put `{"draft": "Sure. We do…`
 * into the approval card as if it were a message ready to send to a lead.
 *
 * This matters most for non-Latin scripts: Ukrainian and Russian cost several
 * times more tokens per character than English, so they hit the ceiling first.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { generateDraftReply } from "./claude";

const PARAMS = {
  leadName: "Sam",
  leadEmail: "sam@example.com",
  leadCompany: "Acme",
  incomingReply: "Tell me more",
  personaName: "SDR",
  productDescription: "Cleaning",
  toneOfVoice: "Direct",
  cta: "Book a call",
};

function reply(text: string, stop_reason = "end_turn") {
  return {
    content: [{ type: "text", text }],
    stop_reason,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["ANTHROPIC_API_KEY"] = "test-key";
});

describe("generateDraftReply — output truncated", () => {
  it("refuses rather than drafting a half-written message", async () => {
    // Exactly what a cut-off response looks like: valid JSON so far, no closing.
    mockCreate.mockResolvedValue(
      reply('{"draft": "Sure. We do three things: exterior building', "max_tokens"),
    );

    await expect(generateDraftReply(PARAMS)).rejects.toThrow(/cut off/i);
  });

  it("never returns raw JSON as the draft body", async () => {
    mockCreate.mockResolvedValue(
      reply('{"draft": "Sure. We do three things: exterior building', "max_tokens"),
    );

    await expect(generateDraftReply(PARAMS)).rejects.toThrow();
    // The old behaviour resolved with draft === the raw string above.
  });

  it("rejects malformed JSON even when the model stopped normally", async () => {
    mockCreate.mockResolvedValue(reply('{"draft": "unterminated'));

    await expect(generateDraftReply(PARAMS)).rejects.toThrow(/malformed/i);
  });
});

describe("generateDraftReply — normal responses still work", () => {
  it("returns the parsed draft", async () => {
    mockCreate.mockResolvedValue(
      reply(
        JSON.stringify({
          draft: "Happy to help — what does the site look like?",
          confidence_score: 0.9,
          detected_intent: "interest",
          suggested_next_action: "schedule_call",
        }),
      ),
    );

    const result = await generateDraftReply(PARAMS);
    expect(result.draft).toBe("Happy to help — what does the site look like?");
    expect(result.confidenceScore).toBe(0.9);
  });

  it("accepts a plain-prose reply that is not JSON at all", async () => {
    mockCreate.mockResolvedValue(reply("Happy to help — when suits you?"));

    const result = await generateDraftReply(PARAMS);
    expect(result.draft).toBe("Happy to help — when suits you?");
  });

  it("still unwraps a ```json fenced response", async () => {
    mockCreate.mockResolvedValue(reply('```json\n{"draft": "Fenced reply"}\n```'));

    const result = await generateDraftReply(PARAMS);
    expect(result.draft).toBe("Fenced reply");
  });

  it("asks for enough room that a Cyrillic reply is not cut short", async () => {
    mockCreate.mockResolvedValue(reply(JSON.stringify({ draft: "Добрий день" })));

    await generateDraftReply(PARAMS);

    const { max_tokens } = mockCreate.mock.calls[0][0];
    expect(max_tokens).toBeGreaterThanOrEqual(4096);
  });
});

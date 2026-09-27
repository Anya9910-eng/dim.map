import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";

// ─── Configuration ─────────────────────────────────────────────────────────

export function isClaudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ─── Draft validation ──────────────────────────────────────────────────────

/** Minimum character length for a draft to be considered a real reply. */
export const MIN_DRAFT_LENGTH = 10;

/**
 * Returns true when `text` is long enough to be a genuine AI-generated reply.
 * Rejects empty strings, whitespace-only strings, and very short outputs that
 * are almost certainly a refusal, parse error, or incomplete generation.
 */
export function isValidDraftText(text: string): boolean {
  return text.trim().length > MIN_DRAFT_LENGTH;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DraftParams {
  leadName: string;
  leadEmail: string;
  leadCompany: string;
  leadRole?: string;
  leadCountry?: string;
  incomingReply: string;
  /** Where the lead wrote from. Shapes length and format; email when omitted. */
  channel?: "lemlist" | "meta" | "whatsapp";

  personaName: string;
  productDescription: string;
  toneOfVoice: string;
  commonObjections?: string;
  cta: string;
  qualificationRules?: string;
  regionRules?: string;

  replyRules?: string;

  /** Past exchanges with this same lead, oldest first. */
  conversationHistory?: string;
  /** Replies this client's operator sent untouched — the brand's real voice. */
  approvedExamples?: string;
  /** Drafted-versus-corrected pairs: what the operator keeps having to fix. */
  corrections?: string;
}

export type LeadQualification = "hot" | "warm" | "cold" | "unqualified";

const QUALIFICATIONS: ReadonlySet<string> = new Set(["hot", "warm", "cold", "unqualified"]);

/** Accepts only a known grade; anything else means the model did not grade the lead. */
export function parseQualification(value: unknown): LeadQualification | null {
  return typeof value === "string" && QUALIFICATIONS.has(value.toLowerCase())
    ? (value.toLowerCase() as LeadQualification)
    : null;
}

export interface DraftResult {
  draft: string;
  confidenceScore: number;
  detectedIntent: string;
  suggestedNextAction: string;
  /** Null when the model returned prose or an unknown grade. */
  qualification: LeadQualification | null;
  qualificationReason: string | null;
}

// ─── Draft generation ──────────────────────────────────────────────────────

export async function generateDraftReply(params: DraftParams): Promise<DraftResult> {
  if (!isClaudeConfigured()) {
    throw new Error("ANTHROPIC_API_KEY is not configured. Add it to Replit Secrets to enable AI draft generation.");
  }

  const systemPrompt = buildSystemPrompt(params);
  const userMessage = buildUserMessage(params);

  const client = getClient();
  const response = await client.messages.create({
    model: "claude-opus-5",
    // The reply is capped at 150 words by the prompt, but this budget also has
    // to cover the JSON wrapper — and non-Latin scripts cost several times more
    // tokens per character, so a Ukrainian or Russian reply needs far more room
    // than an English one of the same length. 1024 was tight enough that such a
    // reply could be cut off mid-sentence.
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  // A truncated response is a half-written reply wrapped in half-written JSON.
  // Failing here means no draft is created; the alternative was worse, because
  // the parse below would fail and hand the raw JSON back *as the draft*, so
  // the operator saw `{"draft": "Sure. We do three…` in the approval card.
  if (response.stop_reason === "max_tokens") {
    logger.error(
      { outputTokens: response.usage.output_tokens },
      "Claude hit the output limit — discarding the partial reply rather than drafting half a message",
    );
    throw new Error("Claude's reply was cut off by the output limit — no draft was created");
  }

  const raw = response.content.find((b) => b.type === "text")?.text ?? "";

  // Strip markdown code block wrapper if Claude returned ```json {...} ```
  const codeBlockMatch = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/);
  const jsonCandidate = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();

  try {
    const parsed = JSON.parse(jsonCandidate) as {
      draft?: string;
      confidence_score?: number;
      detected_intent?: string;
      suggested_next_action?: string;
      lead_qualification?: string;
      qualification_reason?: string;
    };
    return {
      draft: parsed.draft ?? jsonCandidate,
      confidenceScore: parsed.confidence_score ?? 0.8,
      detectedIntent: parsed.detected_intent ?? "interest",
      suggestedNextAction: parsed.suggested_next_action ?? "schedule_call",
      qualification: parseQualification(parsed.lead_qualification),
      qualificationReason: typeof parsed.qualification_reason === "string" && parsed.qualification_reason.trim()
        ? parsed.qualification_reason.trim()
        : null,
    };
  } catch {
    // Not valid JSON. If it does not even look like JSON the model simply
    // answered in prose, which is a usable draft. If it *does* look like JSON
    // it is malformed, and passing it through would show the operator raw
    // markup and escape sequences instead of a message.
    if (jsonCandidate.startsWith("{")) {
      logger.error(
        { preview: jsonCandidate.slice(0, 200) },
        "Claude returned malformed JSON — discarding rather than drafting raw markup",
      );
      throw new Error("Claude returned a malformed response — no draft was created");
    }
    return {
      draft: jsonCandidate,
      confidenceScore: 0.75,
      detectedIntent: "interest",
      suggestedNextAction: "schedule_call",
      qualification: null,
      qualificationReason: null,
    };
  }
}

export async function testConnection(): Promise<{ ok: boolean; tokens?: number; error?: string }> {
  if (!isClaudeConfigured()) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not configured" };
  }
  try {
    const client = getClient();
    const res = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 10,
      messages: [{ role: "user", content: "Reply with the word: ready" }],
    });
    const tokens = res.usage.input_tokens + res.usage.output_tokens;
    return { ok: true, tokens };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Claude connection test failed");
    return { ok: false, error: msg };
  }
}

// ─── Prompt builders ───────────────────────────────────────────────────────

const CHANNEL_GUIDANCE: Record<NonNullable<DraftParams["channel"]>, string> = {
  lemlist: "The lead replied to a cold email or LinkedIn campaign. Write an email-style reply.",
  meta: "The lead filled in a Meta (Facebook / Instagram) Lead Ads form, so they asked to be contacted but have not spoken to anyone yet. Write a short first message that thanks them, references what they asked about, and moves them to a viewing or a call. It will most likely be sent over WhatsApp.",
  whatsapp: "The lead is chatting on WhatsApp. Write like a person on WhatsApp: short, warm, plain text, no email sign-off, at most three short paragraphs.",
};

function buildSystemPrompt(p: DraftParams): string {
  return `You are a sales reply assistant for a property developer or real-estate brokerage, operating as the "${p.personaName}" persona.

${CHANNEL_GUIDANCE[p.channel ?? "lemlist"]}

Product: ${p.productDescription}
Tone of voice: ${p.toneOfVoice}
Primary CTA: ${p.cta}
${p.commonObjections ? `Common objections to handle: ${p.commonObjections}` : ""}
${p.leadCountry ? `The prospect is based in ${p.leadCountry}. Adapt tone, formality, and phrasing to fit business communication norms for that country — this outranks the default tone of voice above when the two conflict.` : ""}
${p.regionRules ? `Regional tone rules for this campaign: ${p.regionRules}` : ""}
${p.replyRules ? `Campaign reply rules: ${p.replyRules}` : ""}
${p.qualificationRules ? `Qualification criteria: ${p.qualificationRules}` : ""}

Write the draft in the same language the prospect wrote their reply in. The
persona and the rules above may be written in a different language than the
prospect uses — they describe how to write, not which language to write in. If
the prospect's language is genuinely unclear, use English.

${p.approvedExamples ? `
Replies this client approved and sent, unchanged. Match their voice, length and
level of formality — these are what the client actually sounds like, and they
outrank any description of tone above.

${p.approvedExamples}
` : ""}${p.corrections ? `
Drafts this client's operator had to correct before sending. Read what changed
and do not reproduce the mistake — these are the specific habits they keep
having to fix.

${p.corrections}
` : ""}
You must respond with a JSON object in this exact format:
{
  "draft": "<the reply email/message body>",
  "confidence_score": <0.0-1.0>,
  "detected_intent": "<interest|objection|pricing|timing|referral|not_interested|unsubscribe|complaint|unclear>",
  "suggested_next_action": "<schedule_call|send_info|handle_objection|discard|follow_up|escalate>",
  "lead_qualification": "<hot|warm|cold|unqualified>",
  "qualification_reason": "<one short sentence: which buying signals are present or missing>"
}

Qualifying the lead: judge only from what the lead has actually said. The
signals that matter for property are budget, timeline to buy, financing (cash,
mortgage, pre-approved), purpose (own use or investment), and the unit type or
location they want. "hot" = clear intent plus at least budget or timeline;
"warm" = real interest but key signals missing; "cold" = vague curiosity;
"unqualified" = not a buyer, wrong fit, or asked to stop. If qualification
criteria are given above, they outrank this rubric.

Rules:
- Write the draft as a natural, conversational message (no subject line, no greeting prefix "Hi [Name]," — start directly)
- Match the persona tone precisely
- Keep it concise — under 150 words
- Never mention AI or automation
- Never fabricate prices, availability, payment plans, handover dates or yields — if pricing is asked and no approved rates are available, set suggested_next_action to "escalate" and write a draft that says a manager will follow up with pricing
- The draft should feel like it was written personally by the sender
- If detected_intent is "unsubscribe": set draft to a brief polite acknowledgement (e.g. "Understood — removing you from our list. All the best."), set suggested_next_action to "discard", confidence_score to 0.99
- If detected_intent is "complaint": set suggested_next_action to "escalate", set confidence_score below 0.5, draft should be a neutral acknowledgement only — no promises, no specifics
- If the message is rude, aggressive, or contains offensive language: set suggested_next_action to "escalate"`;
}

function buildUserMessage(p: DraftParams): string {
  return `Lead: ${p.leadName} (${p.leadRole ?? "unknown role"})${p.leadCompany ? ` at ${p.leadCompany}` : ""}${p.leadCountry ? `, ${p.leadCountry}` : ""}
${p.leadEmail ? `Email: ${p.leadEmail}\n` : ""}${p.conversationHistory ? `Everything already exchanged with this lead, oldest first. Do not repeat what has been said or reintroduce yourself:\n${p.conversationHistory}\n` : ""}
Their latest reply: "${p.incomingReply}"

Generate the reply draft.`;
}

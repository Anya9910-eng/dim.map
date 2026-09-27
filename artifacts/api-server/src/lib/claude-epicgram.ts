import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";

export interface EpicgramMessage {
  from: string;
  text: string;
}

export interface EpicgramDraftParams {
  chatTitle?: string;
  messages: EpicgramMessage[];
  task: string;
}

export interface EpicgramDraftResult {
  draft: string;
  confidenceScore: number;
  detectedIntent: string;
  suggestedAction: string;
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export async function generateEpicgramDraft(
  params: EpicgramDraftParams,
): Promise<EpicgramDraftResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const conversationText = params.messages
    .map((m) => `[${m.from}]: ${m.text}`)
    .join("\n");

  const systemPrompt = `You are an AI operator assistant helping a Telegram operator draft replies.
You receive conversation context from a Telegram chat and a task description.
Your job is to draft a reply that the operator can review, edit, and approve before it is sent.

Rules:
- Write natural, conversational Telegram messages (not formal emails).
- Keep it concise — Telegram users prefer short replies.
- Never invent facts; if you lack context, ask a clarifying question instead.
- Do not mention that you are an AI in the draft.

Respond ONLY with a JSON object in this exact format:
{
  "draft": "<the reply message text>",
  "confidence_score": <0.0-1.0>,
  "detected_intent": "<one short phrase describing what the other party wants>",
  "suggested_action": "<send_reply | request_more_info | escalate_to_human>"
}`;

  const userMessage = `Chat: ${params.chatTitle ?? "Unknown"}

Conversation:
${conversationText}

Task: ${params.task}`;

  const client = getClient();
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText = response.content.find((b) => b.type === "text")?.text ?? "";
  const raw = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

  try {
    const parsed = JSON.parse(raw) as {
      draft?: string;
      confidence_score?: number;
      detected_intent?: string;
      suggested_action?: string;
    };
    return {
      draft: parsed.draft ?? raw,
      confidenceScore: parsed.confidence_score ?? 0.8,
      detectedIntent: parsed.detected_intent ?? "inquiry",
      suggestedAction: parsed.suggested_action ?? "send_reply",
    };
  } catch {
    logger.warn({ rawLength: raw.length }, "EpicGram: Claude response was not valid JSON, using raw");
    return {
      draft: raw,
      confidenceScore: 0.75,
      detectedIntent: "inquiry",
      suggestedAction: "send_reply",
    };
  }
}

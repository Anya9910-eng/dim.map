import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, draftsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Past drafts, fed back into the next one.
 *
 * Every generated draft, every operator edit and every send has been recorded
 * since day one, but nothing read it back: each reply was written from a blank
 * slate, so the same wording could be corrected a hundred times and come out
 * unchanged on the hundred-and-first.
 *
 * Three kinds of history, each answering a different question:
 *
 *   thread    — what has already been said to *this* lead, so a third reply
 *               does not read like a first contact
 *   approved  — replies the operator sent untouched: the brand's actual voice,
 *               which is more reliable than any description of it
 *   corrected — generated-versus-edited pairs: the only signal that says what
 *               was *wrong*, rather than what was right
 *
 * Everything is scoped to one client. Another client's voice is not a useful
 * example and their prospect data must not appear in someone else's prompt.
 */

/** Kept small on purpose: this rides on every draft, and tokens are billed. */
const THREAD_LIMIT = 6;
const APPROVED_LIMIT = 3;
const CORRECTED_LIMIT = 3;
const SNIPPET_CHARS = 600;

function truncate(text: string | null | undefined, max = SNIPPET_CHARS): string {
  const value = (text ?? "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export interface DraftHistory {
  thread?: string;
  approvedExamples?: string;
  corrections?: string;
}

/**
 * A correction is only worth showing when the operator actually rewrote
 * something. Slack's edit modal returns the full text, so a draft can be
 * marked edited while being byte-identical, and a "correction" that corrects
 * nothing teaches the model noise.
 */
function isRealEdit(generated: string, edited: string | null): edited is string {
  if (!edited) return false;
  return edited.trim() !== generated.trim();
}

export async function buildDraftHistory(params: {
  clientId: number;
  prospectEmail: string;
  /** Matches the lead by number instead when they have no address (WhatsApp). */
  prospectPhone?: string;
}): Promise<DraftHistory> {
  const { clientId, prospectEmail } = params;
  const prospectPhone = params.prospectPhone?.trim() ?? "";
  const byPhone = !prospectEmail.trim() && !!prospectPhone;
  const isThisLead = (d: { prospectEmail: string; prospectPhone?: string | null }) =>
    byPhone ? d.prospectPhone === prospectPhone : d.prospectEmail === prospectEmail;

  try {
    const [threadRows, approvedRows, correctedRows] = await Promise.all([
      // This lead's own history, whatever became of each draft — a discarded
      // one still tells us the thread reached that point.
      db
        .select()
        .from(draftsTable)
        .where(and(
          eq(draftsTable.clientId, clientId),
          byPhone ? eq(draftsTable.prospectPhone, prospectPhone) : eq(draftsTable.prospectEmail, prospectEmail),
        ))
        .orderBy(desc(draftsTable.createdAt))
        .limit(THREAD_LIMIT),

      // Sent untouched: the operator read it and changed nothing.
      db
        .select()
        .from(draftsTable)
        .where(and(eq(draftsTable.clientId, clientId), eq(draftsTable.status, "sent")))
        .orderBy(desc(draftsTable.createdAt))
        .limit(APPROVED_LIMIT * 2),

      db
        .select()
        .from(draftsTable)
        .where(
          and(
            eq(draftsTable.clientId, clientId),
            eq(draftsTable.status, "edited"),
            isNotNull(draftsTable.editedReplyText),
          ),
        )
        .orderBy(desc(draftsTable.createdAt))
        .limit(CORRECTED_LIMIT * 2),
    ]);

    const history: DraftHistory = {};

    // Oldest first, so the exchange reads in the order it happened.
    const thread = [...threadRows].reverse();
    if (thread.length > 0) {
      history.thread = thread
        .map((d) => {
          const sent = d.editedReplyText ?? d.replyText;
          const outcome = d.status === "discarded" ? " (discarded, not sent)" : "";
          return [
            `Them: ${truncate(d.conversationSnippet)}`,
            `Us${outcome}: ${truncate(sent)}`,
          ].join("\n");
        })
        .join("\n\n");
    }

    // A lead's own thread is already shown above; repeating it as an "example"
    // wastes tokens and over-weights one conversation.
    const approved = approvedRows
      .filter((d) => !isThisLead(d))
      .slice(0, APPROVED_LIMIT);
    if (approved.length > 0) {
      history.approvedExamples = approved
        .map((d, i) =>
          [
            `Example ${i + 1}`,
            `Their message: ${truncate(d.conversationSnippet)}`,
            `Reply that was approved: ${truncate(d.editedReplyText ?? d.replyText)}`,
          ].join("\n"),
        )
        .join("\n\n");
    }

    const corrected = correctedRows
      .filter((d) => isRealEdit(d.replyText, d.editedReplyText))
      .slice(0, CORRECTED_LIMIT);
    if (corrected.length > 0) {
      history.corrections = corrected
        .map((d, i) =>
          [
            `Correction ${i + 1}`,
            `Drafted: ${truncate(d.replyText)}`,
            `Corrected to: ${truncate(d.editedReplyText as string)}`,
          ].join("\n"),
        )
        .join("\n\n");
    }

    return history;
  } catch (err) {
    // History improves a draft; it is not required to produce one. A failure
    // here must not cost the client a reply.
    logger.warn({ err, clientId, prospectEmail }, "Could not load draft history — drafting without it");
    return {};
  }
}

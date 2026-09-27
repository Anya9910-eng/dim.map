import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * How many lines of a quote-less message we show before collapsing it. Chosen
 * so a normal short reply ("Please provide more details / Best, Olha") never
 * gets a toggle it doesn't need.
 */
const MAX_LINES = 8;

type Split = { head: string; quoted: string };

/**
 * Split an email body into the part the person actually just wrote and the
 * thread they were replying to.
 *
 * The anchor is the first `>`-quoted line, not the "On <date> X wrote:"
 * attribution above it — that sentence is localised (the reply that prompted
 * this was Ukrainian: "сб, 15 серп. 2026 р. о 20:45 ... пише:") and matching it
 * by language would break on the next locale. So we find the quote marker,
 * then walk back over blank lines and absorb one preceding line if it ends in
 * a colon, which is what every locale's attribution has in common.
 */
export function splitQuotedText(text: string): Split {
  const lines = text.split("\n");
  const firstQuote = lines.findIndex(l => l.trimStart().startsWith(">"));
  if (firstQuote === -1) return { head: text, quoted: "" };

  let start = firstQuote;
  let probe = firstQuote - 1;
  while (probe >= 0 && lines[probe].trim() === "") probe--;
  if (probe >= 0 && lines[probe].trimEnd().endsWith(":")) start = probe;

  const head = lines.slice(0, start).join("\n").trimEnd();
  // A reply that is *nothing but* quote gives us no useful split — showing an
  // empty body above a toggle would be worse than showing the raw text.
  if (head.trim() === "") return { head: text, quoted: "" };

  return { head, quoted: lines.slice(start).join("\n").trimEnd() };
}

/**
 * An incoming message, with the quoted thread folded away.
 *
 * Approving a draft means reading what the lead said, and on a deep thread
 * that sentence was buried under a screenful of `>` history. The new text is
 * always visible; the history is one click away and never expanded by default.
 */
export function ConversationMessage({ text, className = "" }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const { head, quoted } = splitQuotedText(text);

  // No quoted thread: fall back to plain line-count truncation so a long
  // unquoted paste doesn't run away either.
  const headLines = head.split("\n");
  const overflows = !quoted && headLines.length > MAX_LINES;
  const shown = overflows && !expanded ? headLines.slice(0, MAX_LINES).join("\n") : head;

  const hiddenCount = quoted ? quoted.split("\n").length : headLines.length - MAX_LINES;
  const canToggle = !!quoted || overflows;

  return (
    <div className={className}>
      <div className="whitespace-pre-wrap">{shown}</div>
      {canToggle && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {expanded
              ? "Hide earlier messages"
              : quoted
                ? `Show earlier messages (${hiddenCount} lines)`
                : `Show ${hiddenCount} more lines`}
          </button>
          {expanded && quoted && (
            <div className="mt-2 pt-2 border-t border-muted-foreground/20 whitespace-pre-wrap opacity-70">
              {quoted}
            </div>
          )}
        </>
      )}
    </div>
  );
}

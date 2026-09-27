import { db, draftsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * One-time migration: scan drafts where replyText or editedReplyText starts
 * with "{" and attempt to unwrap the JSON, storing just the plain text.
 *
 * Rows that cannot be parsed are left unchanged.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts run fix-raw-json-drafts
 */

function extractDraftText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of ["draft", "reply", "text", "message", "content"]) {
        if (typeof parsed[key] === "string") {
          return (parsed[key] as string).trim();
        }
      }
    } catch {
      // Not valid JSON — leave as-is
    }
  }
  return raw;
}

async function main() {
  console.log("Scanning drafts for raw JSON in replyText / editedReplyText…");

  const rows = await db.execute<{
    id: number;
    reply_text: string;
    edited_reply_text: string | null;
  }>(
    sql`SELECT id, reply_text, edited_reply_text
        FROM drafts
        WHERE reply_text LIKE '{%'
           OR edited_reply_text LIKE '{%'`,
  );

  const candidates = rows.rows;
  console.log(`Found ${candidates.length} candidate row(s).`);

  let updatedCount = 0;

  for (const row of candidates) {
    const cleanReply = extractDraftText(row.reply_text);
    const cleanEdited =
      row.edited_reply_text != null
        ? extractDraftText(row.edited_reply_text)
        : null;

    const replyChanged = cleanReply !== row.reply_text;
    const editedChanged = cleanEdited !== row.edited_reply_text;

    if (!replyChanged && !editedChanged) {
      console.log(`  Row ${row.id}: starts with "{" but could not be parsed — skipped.`);
      continue;
    }

    await db.execute(
      sql`UPDATE drafts
          SET reply_text        = ${cleanReply},
              edited_reply_text = ${cleanEdited}
          WHERE id = ${row.id}`,
    );

    const parts: string[] = [];
    if (replyChanged) parts.push("replyText");
    if (editedChanged) parts.push("editedReplyText");
    console.log(`  Row ${row.id}: cleaned ${parts.join(", ")}.`);
    updatedCount++;
  }

  console.log(`Done. Updated ${updatedCount} row(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

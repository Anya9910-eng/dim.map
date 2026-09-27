/**
 * Idempotent one-off: bind the EPICGRAM AI / EPIC STAR AI client to the
 * #draftfly-approvals Slack channel (C0BK6NPBHKJ).
 *
 * SAFE TO RE-RUN. It only touches a client whose name/company matches EPICGRAM /
 * EPIC STAR, and only when that client is NOT already on the target channel.
 * No other client is modified. Requires DATABASE_URL in the environment.
 *
 *   pnpm --filter @workspace/scripts exec tsx ./src/bind-epicgram-slack-channel.ts
 */
import { db, clientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const TARGET_CHANNEL_ID = "C0BK6NPBHKJ"; // #draftfly-approvals in EPIC STAR AI workspace
const MATCHERS = ["epicgram", "epic star"];

function matchesEpicgram(client: { name: string; company: string | null }): boolean {
  const haystack = `${client.name} ${client.company ?? ""}`.toLowerCase();
  return MATCHERS.some((m) => haystack.includes(m));
}

async function run() {
  const clients = await db.select().from(clientsTable);
  const matches = clients.filter(matchesEpicgram);

  if (matches.length === 0) {
    console.error(
      "[fail] No client matching EPICGRAM / EPIC STAR found. Nothing changed.\n" +
        "       Existing clients: " +
        clients.map((c) => c.name).join(", "),
    );
    process.exit(1);
  }

  if (matches.length > 1) {
    console.warn(
      `[warn] ${matches.length} clients matched EPICGRAM / EPIC STAR: ` +
        matches.map((c) => `${c.name} (#${c.id})`).join(", ") +
        " — binding all of them to the target channel.",
    );
  }

  for (const client of matches) {
    if (client.slackChannel === TARGET_CHANNEL_ID) {
      console.log(`[skip] ${client.name} (#${client.id}) already bound to ${TARGET_CHANNEL_ID}`);
      continue;
    }
    await db
      .update(clientsTable)
      .set({ slackChannel: TARGET_CHANNEL_ID })
      .where(eq(clientsTable.id, client.id));
    console.log(
      `[ok]   ${client.name} (#${client.id}) bound: "${client.slackChannel}" -> ${TARGET_CHANNEL_ID}`,
    );
  }

  console.log("Done.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Error binding EPICGRAM Slack channel:", err instanceof Error ? err.message : err);
  process.exit(1);
});

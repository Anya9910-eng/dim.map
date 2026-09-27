import { lt, and, ne } from "drizzle-orm";
import { db, draftsTable, activityTable, logsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Data retention for prospect data.
 *
 * Every draft holds a lead's name, email address and the text of what they
 * wrote; activity and log rows repeat the name and address. DIM Convert processes
 * that on the client's behalf, and the Privacy Policy says so. Nothing was
 * ever deleted, which meant every database dump carried every prospect who had
 * ever replied, for ever.
 *
 * Twelve months is long enough for any dispute about what was sent and when,
 * and short enough to be defensible as "no longer than necessary". Override
 * with DATA_RETENTION_DAYS. A value of 0 disables the sweep entirely, which is
 * the escape hatch if a client ever needs a legal hold.
 */

const DEFAULT_RETENTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Once a day. A missed run costs nothing; the next one catches up. */
export const SWEEP_INTERVAL_MS = DAY_MS;

export function retentionDays(): number {
  const raw = process.env["DATA_RETENTION_DAYS"];
  if (raw === undefined || raw === "") return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    logger.warn({ raw }, "retention: invalid DATA_RETENTION_DAYS — using the default");
    return DEFAULT_RETENTION_DAYS;
  }
  return n;
}

export interface SweepResult {
  cutoff: Date | null;
  drafts: number;
  activity: number;
  logs: number;
}

/**
 * Deletes prospect data older than the retention window.
 *
 * Drafts still pending are kept regardless of age. A pending draft is one the
 * client has not yet decided on; deleting it out from under them would make a
 * lead vanish from the inbox with no record of why. The stale-draft sweeper
 * is the tool for those, and it is the operator's call to run it.
 */
export async function sweepExpiredData(now: Date = new Date()): Promise<SweepResult> {
  const days = retentionDays();
  if (days === 0) {
    logger.info("retention: DATA_RETENTION_DAYS=0 — sweep disabled");
    return { cutoff: null, drafts: 0, activity: 0, logs: 0 };
  }
  const cutoff = new Date(now.getTime() - days * DAY_MS);

  // Rows that reference a draft go first, so a failure part-way through never
  // leaves activity pointing at a draft that no longer exists.
  const activity = await db.delete(activityTable).where(lt(activityTable.createdAt, cutoff)).returning({ id: activityTable.id });
  const logs = await db.delete(logsTable).where(lt(logsTable.createdAt, cutoff)).returning({ id: logsTable.id });
  const drafts = await db
    .delete(draftsTable)
    .where(and(lt(draftsTable.createdAt, cutoff), ne(draftsTable.status, "pending")))
    .returning({ id: draftsTable.id });

  const result = { cutoff, drafts: drafts.length, activity: activity.length, logs: logs.length };
  if (result.drafts + result.activity + result.logs > 0) {
    logger.info({ ...result, retentionDays: days }, "retention: swept expired prospect data");
  } else {
    logger.debug({ cutoff, retentionDays: days }, "retention: nothing to sweep");
  }
  return result;
}

/**
 * Runs the sweep shortly after start-up and then daily.
 *
 * The first run is delayed rather than immediate so a crash-looping process
 * does not hammer the database with deletes on every restart.
 */
export function startRetentionSweeper(): NodeJS.Timeout {
  const run = () =>
    sweepExpiredData().catch((err) => logger.error({ err }, "retention: sweep failed"));

  setTimeout(run, 5 * 60 * 1000).unref();
  const handle = setInterval(run, SWEEP_INTERVAL_MS);
  handle.unref();
  logger.info({ retentionDays: retentionDays() }, "retention: sweeper scheduled");
  return handle;
}

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db, loginCodesTable } from "@workspace/db";

/**
 * Issue and check the six-digit codes that sign a person in.
 *
 * A six-digit code is only ~20 bits, so the guessing limits here — not the code
 * length — are what make this safe. Three things bound an attacker:
 *   - a code lives 10 minutes,
 *   - a code dies after MAX_ATTEMPTS wrong guesses,
 *   - one address may only be sent MAX_SENDS_PER_WINDOW codes per window,
 *     so an attacker cannot mint fresh codes to widen the target.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * HMAC rather than a bare hash so a leaked table cannot be attacked offline:
 * with only a million possible codes, plain SHA-256 digests would be reversible
 * by brute force in milliseconds. The key is SESSION_SECRET, which app.ts
 * already requires at boot.
 */
function hashCode(email: string, code: string): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET is required to hash login codes");
  return createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Uniform over 000000–999999. `randomInt` avoids the modulo bias of `%`. */
function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: "throttled" };

/**
 * Creates a code for `email`, invalidating any earlier unused one.
 *
 * Superseding the previous code means only the newest email works, so a person
 * who requests twice and then types the first code is told plainly that it is
 * wrong instead of being signed in by a code they believe expired.
 */
/**
 * How long a spent code stays on disk after it can no longer be used.
 *
 * Long enough that the send-rate window above still sees it, and no longer.
 * A code row is a hashed credential plus an email address: there is nothing to
 * audit in it once it has expired, and rows kept forever are a data-retention
 * liability that a database dump would carry around.
 */
const RETAIN_AFTER_EXPIRY_MS = 24 * 60 * 60 * 1000;

export async function issueLoginCode(email: string): Promise<IssueResult> {
  const normalized = normalizeEmail(email);
  const now = new Date();
  const windowStart = new Date(now.getTime() - SEND_WINDOW_MS);

  // Housekeeping rides on the write path rather than a scheduler: every code
  // issued sweeps out the ones nobody can use any more. It cannot fall behind
  // the way a cron job that quietly stops would, and it costs one indexed
  // DELETE per sign-in.
  await db
    .delete(loginCodesTable)
    .where(lt(loginCodesTable.expiresAt, new Date(now.getTime() - RETAIN_AFTER_EXPIRY_MS)));

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginCodesTable)
    .where(and(eq(loginCodesTable.email, normalized), gt(loginCodesTable.createdAt, windowStart)));

  if (count >= MAX_SENDS_PER_WINDOW) return { ok: false, reason: "throttled" };

  // Retire outstanding codes: consumedAt is what verification filters on, so
  // stamping it here is what makes the older code stop working.
  await db
    .update(loginCodesTable)
    .set({ consumedAt: now })
    .where(and(eq(loginCodesTable.email, normalized), isNull(loginCodesTable.consumedAt)));

  const code = generateCode();
  await db.insert(loginCodesTable).values({
    email: normalized,
    codeHash: hashCode(normalized, code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });

  return { ok: true, code };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "too_many_attempts" };

/**
 * Checks a code and, on success, spends it.
 *
 * Every failure mode collapses to a single caller-visible message on purpose:
 * distinguishing "no code was requested for this address" from "wrong digits"
 * would turn this endpoint into a way to test whether an address has an account.
 */
export async function verifyLoginCode(email: string, code: string): Promise<VerifyResult> {
  const normalized = normalizeEmail(email);

  const [row] = await db
    .select()
    .from(loginCodesTable)
    .where(and(eq(loginCodesTable.email, normalized), isNull(loginCodesTable.consumedAt)))
    .orderBy(desc(loginCodesTable.createdAt))
    .limit(1);

  if (!row) return { ok: false, reason: "invalid" };

  if (row.expiresAt.getTime() <= Date.now()) {
    await db
      .update(loginCodesTable)
      .set({ consumedAt: new Date() })
      .where(eq(loginCodesTable.id, row.id));
    return { ok: false, reason: "expired" };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await db
      .update(loginCodesTable)
      .set({ consumedAt: new Date() })
      .where(eq(loginCodesTable.id, row.id));
    return { ok: false, reason: "too_many_attempts" };
  }

  if (!hashesMatch(row.codeHash, hashCode(normalized, code.trim()))) {
    const attempts = row.attempts + 1;
    await db
      .update(loginCodesTable)
      .set({
        attempts,
        // Burn the code on the last allowed miss, so the next request cannot
        // simply keep guessing against a row that is already at the limit.
        ...(attempts >= MAX_ATTEMPTS ? { consumedAt: new Date() } : {}),
      })
      .where(eq(loginCodesTable.id, row.id));
    return { ok: false, reason: attempts >= MAX_ATTEMPTS ? "too_many_attempts" : "invalid" };
  }

  await db
    .update(loginCodesTable)
    .set({ consumedAt: new Date() })
    .where(eq(loginCodesTable.id, row.id));

  return { ok: true };
}

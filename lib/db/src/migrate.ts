/**
 * Migration runner.
 *
 * Replaces `drizzle-kit push` at deploy time. push renders interactive
 * create-vs-rename prompts that need a TTY, so it can never run unattended in
 * a container — a stale push once silently skipped a schema change and took
 * the app down. This applies committed SQL files instead: deterministic, no
 * prompts, safe to re-run.
 *
 * Workflow: change the Drizzle schema, run `pnpm --filter @workspace/db
 * generate` locally (that is where any rename decision is made, with a human
 * at a TTY), commit the new `migrations/NNNN_*.sql`, deploy. This runner then
 * applies whatever has not been applied yet.
 *
 * Adoption: the production database predates this system — it was built by
 * `push`, so it already has the baseline schema. On first run against such a
 * database (migrations table absent, but `clients` present) the baseline is
 * marked applied without being re-run. A genuinely empty database instead
 * gets every file, baseline first.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const BASELINE = "0000_baseline.sql";

/** The slice of node-postgres this runner needs — enough to fake in a test. */
export interface MigrationClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}
export interface MigrationPool {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  connect(): Promise<MigrationClient>;
}

export interface MigrationSource {
  /** Sorted migration filenames. */
  list(): string[];
  /** The SQL for one filename. */
  read(file: string): string;
}

/** Reads the committed .sql files from the migrations directory. */
export const fileSource: MigrationSource = {
  list: () => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort(),
  read: (file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
};

export function splitStatements(sql: string): string[] {
  return sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
}

/**
 * Applies every migration the database has not seen, in filename order. Returns
 * the files it actually ran (excluding an adopted baseline). Idempotent: a
 * second call with nothing new applies nothing.
 */
export async function runMigrations(
  pool: MigrationPool,
  source: MigrationSource = fileSource,
  onLog: (msg: string) => void = () => {},
): Promise<{ applied: string[] }> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const applied = new Set<string>(
    (await pool.query("SELECT filename FROM schema_migrations")).rows.map((r) => String(r["filename"])),
  );

  // Adopt an existing push-built database: nothing recorded yet, but the schema
  // is already there. Mark the baseline applied rather than re-running it.
  if (applied.size === 0) {
    const { rows } = await pool.query("SELECT to_regclass('public.clients') AS exists");
    if (rows[0]?.["exists"]) {
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", [BASELINE]);
      applied.add(BASELINE);
      onLog(`adopted existing database — ${BASELINE} marked applied without running`);
    }
  }

  const ran: string[] = [];
  for (const file of source.list()) {
    if (applied.has(file)) continue;
    const statements = splitStatements(source.read(file));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const statement of statements) await client.query(statement);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      onLog(`applied ${file} (${statements.length} statement${statements.length === 1 ? "" : "s"})`);
      ran.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }

  onLog(ran.length === 0 ? "database is up to date — nothing to apply" : `done — applied ${ran.length} migration${ran.length === 1 ? "" : "s"}`);
  return { applied: ran };
}

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required to run migrations");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url });
  try {
    await runMigrations(pool as unknown as MigrationPool, fileSource, (m) => process.stdout.write(`[migrate] ${m}\n`));
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly (tsx src/migrate.ts), not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`[migrate] FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

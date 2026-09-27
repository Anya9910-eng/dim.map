/**
 * The deploy migration runner. No real Postgres here, so a fake pool records
 * the SQL it's asked to run — which is enough to pin the behaviour that broke
 * production once: what gets applied, in what order, and that an existing
 * database is adopted rather than rebuilt.
 */
import { describe, it, expect } from "vitest";
import { runMigrations, splitStatements, type MigrationPool, type MigrationSource } from "@workspace/db/migrate";

function fakePool(opts: { clientsExists?: boolean; alreadyApplied?: string[]; failOn?: string } = {}) {
  const log: string[] = [];
  const appliedRows = new Set(opts.alreadyApplied ?? []);
  const pool: MigrationPool = {
    async query(text: string, params?: unknown[]) {
      log.push(text.trim().split("\n")[0].trim());
      if (text.includes("SELECT filename FROM schema_migrations")) {
        return { rows: [...appliedRows].map((filename) => ({ filename })) };
      }
      if (text.includes("to_regclass")) {
        return { rows: [{ exists: opts.clientsExists ? "clients" : null }] };
      }
      if (text.startsWith("INSERT INTO schema_migrations") && params) {
        appliedRows.add(String(params[0]));
      }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(text: string, params?: unknown[]) {
          if (opts.failOn && text.includes(opts.failOn)) throw new Error("boom");
          log.push(text.trim().split("\n")[0].trim());
          if (text.startsWith("INSERT INTO schema_migrations") && params) appliedRows.add(String(params[0]));
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  return { pool, log, appliedRows };
}

const source: MigrationSource = {
  list: () => ["0000_baseline.sql", "0001_add_thing.sql"],
  read: (f) =>
    f === "0000_baseline.sql"
      ? 'CREATE TABLE "clients" ()'
      : 'ALTER TABLE "clients" ADD COLUMN a text;\n--> statement-breakpoint\nALTER TABLE "clients" ADD COLUMN b text;',
};

describe("runMigrations", () => {
  it("on a fresh database, applies the baseline then later migrations in order", async () => {
    const { pool, appliedRows } = fakePool({ clientsExists: false });
    const { applied } = await runMigrations(pool, source);
    expect(applied).toEqual(["0000_baseline.sql", "0001_add_thing.sql"]);
    expect([...appliedRows]).toEqual(["0000_baseline.sql", "0001_add_thing.sql"]);
  });

  it("adopts an existing push-built database: baseline recorded, not re-run", async () => {
    const { pool, log } = fakePool({ clientsExists: true });
    const { applied } = await runMigrations(pool, source);
    // Baseline is NOT applied (no CREATE TABLE runs), only the newer migration.
    expect(applied).toEqual(["0001_add_thing.sql"]);
    expect(log).not.toContain('CREATE TABLE "clients" ()');
    expect(log).toContain('ALTER TABLE "clients" ADD COLUMN a text;');
  });

  it("is idempotent — a second run with nothing new applies nothing", async () => {
    const { pool } = fakePool({ clientsExists: true, alreadyApplied: ["0000_baseline.sql", "0001_add_thing.sql"] });
    const { applied } = await runMigrations(pool, source);
    expect(applied).toEqual([]);
  });

  it("splits a multi-statement file on the drizzle breakpoint and runs each", async () => {
    const { pool, log } = fakePool({ clientsExists: true, alreadyApplied: ["0000_baseline.sql"] });
    await runMigrations(pool, source);
    expect(log.filter((l) => l.startsWith("ALTER TABLE"))).toHaveLength(2);
    expect(log).toContain("BEGIN");
    expect(log).toContain("COMMIT");
  });

  it("rolls back and stops if a statement fails", async () => {
    const { pool, log } = fakePool({ clientsExists: true, alreadyApplied: ["0000_baseline.sql"], failOn: "ADD COLUMN a" });
    await expect(runMigrations(pool, source)).rejects.toThrow(/0001_add_thing\.sql failed and was rolled back/);
    expect(log).toContain("ROLLBACK");
    expect(log).not.toContain("COMMIT");
  });

  it("splitStatements ignores blank trailing fragments", () => {
    expect(splitStatements("A;\n--> statement-breakpoint\nB;\n--> statement-breakpoint\n   ")).toEqual(["A;", "B;"]);
  });
});

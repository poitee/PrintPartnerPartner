import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { getTableConfig as getPgTableConfig, PgTable } from "drizzle-orm/pg-core";
import { getDb, SqliteDatabase } from "./client.js";
import { postgresPostInitMigrations } from "./client-postgres.js";
import { AppRepository } from "./repository.js";
import * as pgSchema from "./schema-pg.js";
import * as sqliteSchema from "./schema.js";
import { currentSchemaVersion, schemaMigrations } from "./schema.js";

/**
 * Regression tests for the schema v9-v13 migration set.
 *
 * The v9 slicer-profile tables and the v11/v12 print_jobs tables that the
 * get_farm_status / get_print_stats MCP tools read were added to the SQLite
 * migration list AND to schema-pg.ts (the Drizzle table declarations), but the
 * Postgres migration runner only executed drizzle/postgres/0000_init.sql — which
 * stops at v8 — while still stamping app_settings.schema_version ahead of DDL.
 * A saas (Postgres) install therefore reported a high schema version against a
 * database with no print_jobs table at all, and any query from those tools
 * failed at runtime. v13 adds profile-sync provenance columns that must exist
 * on both dialects for the profile library / profile-sync watcher.
 *
 * These tests pin both halves: the SQLite DB really contains the v9-v13 tables
 * after migrating, and the Postgres DDL actually creates every table/column
 * declared in schema-pg.ts.
 */

/** Tables introduced by schema v9 (slicer profiles) and v11 (job/telemetry/event log). */
const V9_TO_V12_TABLES = [
  "printer_profiles",
  "process_profiles",
  "filament_profiles",
  "printer_name_map",
  "print_jobs",
  "print_job_parts",
  "printer_telemetry",
  "app_events",
];

/** Profile-sync provenance columns (schema v13) on the three slicer profile tables. */
const PROFILE_PROVENANCE_COLUMNS = ["source_path", "synced_from_slicer_version", "last_synced_at"];

/** Columns get_farm_status / get_print_stats and the Discord digest read off print_jobs. */
const PRINT_JOBS_REQUIRED_COLUMNS = [
  "id",
  "tenant_id",
  "profile_id",
  "host_integration_id",
  "printer_id",
  "material",
  "filename",
  "status",
  "filament_consumed_g",
  "at",
  "completed_at",
  "link_id",
];

function withSqlite(fn: (sqlite: SqliteDatabase) => void) {
  const dir = mkdtempSync(join(tmpdir(), "pp-schema-v9-"));
  const sqlite = new SqliteDatabase(dir);
  sqlite.connect();
  try {
    fn(sqlite);
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** better-sqlite3 handle behind the SqliteDatabase wrapper (private field). */
function rawSqlite(sqlite: SqliteDatabase) {
  return (sqlite as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

function sqliteTableNames(sqlite: SqliteDatabase): string[] {
  return (
    rawSqlite(sqlite)
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function sqliteColumnNames(sqlite: SqliteDatabase, table: string): string[] {
  return (rawSqlite(sqlite).pragma(`table_info(${table})`) as { name: string }[]).map(
    (c) => c.name,
  );
}

describe("schema v9-v13 (SQLite)", () => {
  it("creates every v9-v12 table on a fresh database", () => {
    withSqlite((sqlite) => {
      const tables = sqliteTableNames(sqlite);
      for (const table of V9_TO_V12_TABLES) {
        expect(tables, `missing table ${table}`).toContain(table);
      }
    });
  });

  it("gives print_jobs every column the farm-status/print-stats tools read", () => {
    withSqlite((sqlite) => {
      const cols = sqliteColumnNames(sqlite, "print_jobs");
      for (const col of PRINT_JOBS_REQUIRED_COLUMNS) {
        expect(cols, `missing print_jobs.${col}`).toContain(col);
      }
    });
  });

  it("adds v13 profile-sync provenance columns on slicer profile tables", () => {
    withSqlite((sqlite) => {
      for (const table of ["printer_profiles", "process_profiles", "filament_profiles"]) {
        const cols = sqliteColumnNames(sqlite, table);
        for (const col of PROFILE_PROVENANCE_COLUMNS) {
          expect(cols, `missing ${table}.${col}`).toContain(col);
        }
      }
    });
  });

  it("indexes print_jobs by status and printer for the digest queries", () => {
    withSqlite((sqlite) => {
      const indexes = (
        rawSqlite(sqlite)
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'print_jobs'",
          )
          .all() as { name: string }[]
      ).map((r) => r.name);
      expect(indexes).toContain("idx_print_jobs_tenant_status");
      expect(indexes).toContain("idx_print_jobs_printer");
      expect(indexes).toContain("idx_print_jobs_tenant_profile");
    });
  });

  it("round-trips real print_jobs rows through every v9-v12 field", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-schema-v9-data-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    try {
      const repo = new AppRepository(
        getDb(sqlite),
        "default",
        sqlite.reposDir,
        sqliteSchema as unknown as ConstructorParameters<typeof AppRepository>[3],
      );
      const profile = repo.createProfile("Trident R2 LDO");

      // A completed overnight plate, an in-flight job, and a failure — the
      // three shapes get_farm_status / get_print_stats have to distinguish.
      repo.insertPrintJob({
        id: "job-done",
        profileId: profile.id,
        printerId: "prusa-xl",
        material: "PLA Galaxy Black",
        status: "completed",
        filamentConsumedG: 214,
        filename: "plate-01.gcode",
        at: "2026-08-16T03:10:00.000Z",
        completedAt: "2026-08-16T05:42:00.000Z",
      });
      repo.insertPrintJob({
        id: "job-running",
        profileId: profile.id,
        printerId: "coreone-1",
        material: "PETG Grey",
        status: "sent",
        at: "2026-08-16T06:00:00.000Z",
      });
      repo.insertPrintJob({
        id: "job-failed",
        profileId: profile.id,
        printerId: "coreone-1",
        material: "PETG Grey",
        status: "failed",
        filamentConsumedG: 12,
        at: "2026-08-16T02:00:00.000Z",
        completedAt: "2026-08-16T02:20:00.000Z",
      });

      const rows = repo.recentPrintJobs("2026-08-16T00:00:00.000Z", 100);
      expect(rows).toHaveLength(3);
      // Most recent first.
      expect(rows.map((r) => r.id)).toEqual(["job-running", "job-done", "job-failed"]);

      const done = rows.find((r) => r.id === "job-done")!;
      expect(done.printerId).toBe("prusa-xl");
      expect(done.material).toBe("PLA Galaxy Black");
      expect(done.status).toBe("completed");
      expect(done.filamentConsumedG).toBe(214);
      expect(done.completedAt).toBe("2026-08-16T05:42:00.000Z");

      // Completion rate + filament totals, the two aggregates get_print_stats reports.
      const completed = rows.filter((r) => r.status === "completed").length;
      const failed = rows.filter((r) => r.status === "failed").length;
      expect(completed).toBe(1);
      expect(failed).toBe(1);
      expect(rows.reduce((sum, r) => sum + (r.filamentConsumedG ?? 0), 0)).toBe(226);

      // Per-printer grouping, what get_farm_status keys off.
      expect(new Set(rows.map((r) => r.printerId))).toEqual(new Set(["prusa-xl", "coreone-1"]));

      // The time window must actually filter.
      expect(repo.recentPrintJobs("2026-08-16T04:00:00.000Z", 100).map((r) => r.id)).toEqual([
        "job-running",
      ]);
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records schema_version and re-migrates idempotently", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-schema-v9-rerun-"));
    try {
      const first = new SqliteDatabase(dir);
      first.connect();
      const version = (
        rawSqlite(first)
          .prepare("SELECT value FROM app_settings WHERE tenant_id = ? AND key = ?")
          .get("default", "schema_version") as { value?: string } | undefined
      )?.value;
      expect(Number(version)).toBe(currentSchemaVersion);
      first.close();

      // Second connect re-runs every migration against the populated DB. The
      // unconditional v12 ALTER TABLE ... ADD COLUMN statements must not throw.
      const second = new SqliteDatabase(dir);
      expect(() => second.connect()).not.toThrow();
      expect(sqliteColumnNames(second, "print_jobs")).toEqual(
        expect.arrayContaining(PRINT_JOBS_REQUIRED_COLUMNS),
      );
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upgrades a pre-v12 print_jobs table in place (legacy database)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-schema-v9-legacy-"));
    try {
      // The v11 CREATE TABLE print_jobs statement, i.e. the shape a database
      // created before v12 has on disk.
      const v11CreatePrintJobs = schemaMigrations.find((s) =>
        /CREATE TABLE IF NOT EXISTS print_jobs/.test(s),
      );
      expect(v11CreatePrintJobs).toBeDefined();
      expect(v11CreatePrintJobs).not.toMatch(/printer_id/);

      // Connect once so every ancillary table exists, then rebuild print_jobs
      // in its v11 shape to simulate a legacy database.
      const legacy = new SqliteDatabase(dir);
      legacy.connect();
      const raw = rawSqlite(legacy);
      raw.exec("DROP TABLE print_jobs");
      raw.exec(v11CreatePrintJobs!);
      expect(sqliteColumnNames(legacy, "print_jobs")).not.toContain("printer_id");
      legacy.close();

      // Reconnecting must apply the v12 columns to the existing table.
      const upgraded = new SqliteDatabase(dir);
      upgraded.connect();
      expect(sqliteColumnNames(upgraded, "print_jobs")).toEqual(
        expect.arrayContaining(PRINT_JOBS_REQUIRED_COLUMNS),
      );
      upgraded.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Static parity check for the Postgres side. A Postgres server cannot be spun
 * up in unit tests, so instead assert that the DDL the migration runner
 * executes covers every table and column the Drizzle schema declares. This is
 * exactly the check that would have caught print_jobs never being created on
 * saas installs.
 */
const POSTGRES_DDL = (() => {
  const initPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../drizzle/postgres/0000_init.sql",
  );
  return [readFileSync(initPath, "utf8"), ...postgresPostInitMigrations].join("\n");
})();

function pgTables(): { name: string; columns: string[] }[] {
  // schema-pg.ts also exports plain constants (DEFAULT_TENANT_ID, schemaVersionKey,
  // currentSchemaVersion) alongside the tables, hence the unknown[] widening.
  return (Object.values(pgSchema) as unknown[])
    .filter((v): v is PgTable => v instanceof PgTable)
    .map((t) => {
      const cfg = getPgTableConfig(t);
      return { name: cfg.name, columns: cfg.columns.map((c) => c.name) };
    });
}

/** Column names inside the CREATE TABLE body for `table`, if it is created at all. */
function pgCreatedColumns(table: string): string[] {
  const body = new RegExp(
    `CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+"?${table}"?\\s*\\(([\\s\\S]*?)\\n\\s*\\)`,
    "i",
  ).exec(POSTGRES_DDL)?.[1];
  if (!body) return [];
  return body
    .split("\n")
    .map((line) => /^\s*"?([a-z_]+)"?\s+[A-Za-z]/.exec(line)?.[1]?.toLowerCase())
    .filter((c): c is string => Boolean(c));
}

/** Column names added to `table` via ALTER TABLE ... ADD COLUMN. */
function pgAddedColumns(table: string): string[] {
  return [
    ...POSTGRES_DDL.matchAll(
      new RegExp(
        `ALTER TABLE\\s+"?${table}"?\\s+ADD COLUMN(?:\\s+IF NOT EXISTS)?\\s+"?([a-z_]+)"?`,
        "gi",
      ),
    ),
  ].map((m) => m[1]!.toLowerCase());
}

describe("schema v9-v13 (Postgres DDL parity)", () => {
  it("keeps SQLite and Postgres schema_version constants in lockstep", () => {
    expect(pgSchema.currentSchemaVersion).toBe(sqliteSchema.currentSchemaVersion);
  });

  it("creates every table declared in schema-pg.ts", () => {
    const declared = pgTables().map((t) => t.name);
    expect(declared.length).toBeGreaterThan(0);

    const created = new Set(
      [...POSTGRES_DDL.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([a-z_]+)"?/gi)].map((m) =>
        m[1]!.toLowerCase(),
      ),
    );
    const missing = declared.filter((name) => !created.has(name.toLowerCase()));
    expect(missing, `Postgres DDL never creates: ${missing.join(", ")}`).toEqual([]);
  });

  it("creates every column declared for the v9-v13 tables", () => {
    const byName = new Map(pgTables().map((t) => [t.name, t.columns]));
    for (const table of V9_TO_V12_TABLES) {
      const declaredCols = byName.get(table);
      expect(declaredCols, `schema-pg.ts declares no ${table}`).toBeDefined();

      const present = new Set([...pgCreatedColumns(table), ...pgAddedColumns(table)]);
      const missing = declaredCols!.filter((c) => !present.has(c.toLowerCase()));
      expect(missing, `Postgres DDL for ${table} is missing: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("adds v13 profile-sync provenance columns on slicer profile tables", () => {
    for (const table of ["printer_profiles", "process_profiles", "filament_profiles"]) {
      const present = new Set([...pgCreatedColumns(table), ...pgAddedColumns(table)]);
      for (const col of PROFILE_PROVENANCE_COLUMNS) {
        expect(present.has(col), `Postgres ${table} never gets column ${col}`).toBe(true);
      }
    }
  });

  it("gives print_jobs the columns the farm-status/print-stats tools read", () => {
    const present = new Set([...pgCreatedColumns("print_jobs"), ...pgAddedColumns("print_jobs")]);
    for (const col of PRINT_JOBS_REQUIRED_COLUMNS) {
      expect(present.has(col), `Postgres print_jobs never gets column ${col}`).toBe(true);
    }
  });

  it("keeps every post-init statement idempotent (safe to re-run on boot)", () => {
    for (const stmt of postgresPostInitMigrations) {
      const head = stmt.trim().slice(0, 60);
      if (/^\s*CREATE\s+(TABLE|(UNIQUE\s+)?INDEX)/i.test(stmt)) {
        expect(stmt, `not idempotent: ${head}`).toMatch(/IF NOT EXISTS/i);
      } else if (/^\s*ALTER TABLE/i.test(stmt)) {
        expect(stmt, `not idempotent: ${head}`).toMatch(/ADD COLUMN IF NOT EXISTS/i);
      } else {
        throw new Error(`unexpected non-DDL post-init statement: ${head}`);
      }
    }
  });
});

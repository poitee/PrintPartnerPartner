import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getTableConfig as getPgTableConfig, PgTable } from "drizzle-orm/pg-core";
import { SqliteDatabase } from "./client.js";
import { postgresPostInitMigrations } from "./client-postgres.js";
import * as pgSchema from "./schema-pg.js";
import { currentSchemaVersion, schemaMigrations } from "./schema.js";

/**
 * Regression tests for the schema v9-v12 migration set.
 *
 * The v9 slicer-profile tables and the v11/v12 print_jobs tables that the
 * get_farm_status / get_print_stats MCP tools read were added to the SQLite
 * migration list AND to schema-pg.ts (the Drizzle table declarations), but the
 * Postgres migration runner only executed drizzle/postgres/0000_init.sql — which
 * stops at v8 — while still stamping app_settings.schema_version = 12. A saas
 * (Postgres) install therefore reported "schema v12" against a database with no
 * print_jobs table at all, and any query from those tools failed at runtime.
 *
 * These tests pin both halves: the SQLite DB really contains the v9-v12 tables
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

describe("schema v9-v12 (SQLite)", () => {
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

  it("indexes print_jobs by status and printer for the digest queries", () => {
    withSqlite((sqlite) => {
      const indexes = (
        rawSqlite(sqlite)
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'print_jobs'")
          .all() as { name: string }[]
      ).map((r) => r.name);
      expect(indexes).toContain("idx_print_jobs_tenant_status");
      expect(indexes).toContain("idx_print_jobs_printer");
      expect(indexes).toContain("idx_print_jobs_tenant_profile");
    });
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
      // Simulate a v11-era database: print_jobs exists without the v12 columns.
      // Only run the migrations up to (but excluding) the v12 ALTER block.
      const v12Start = schemaMigrations.findIndex((s) =>
        /ALTER TABLE print_jobs ADD COLUMN printer_id/.test(s),
      );
      expect(v12Start).toBeGreaterThan(0);

      const legacy = new SqliteDatabase(dir);
      // Connect normally first so all the ancillary tables exist, then drop the
      // v12 columns by rebuilding print_jobs in its v11 shape.
      legacy.connect();
      const raw = rawSqlite(legacy);
      raw.exec("DROP TABLE print_jobs");
      raw.exec(schemaMigrations[v12Start - 3]!); // v11 CREATE TABLE print_jobs
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
 * Static parity check for the Postgres side. We cannot spin up a Postgres
 * server in unit tests, so instead assert that the DDL the migration runner
 * executes covers every table and column the Drizzle schema declares. This is
 * exactly the check that would have caught print_jobs never being created on
 * saas installs.
 */
describe("schema v9-v12 (Postgres DDL parity)", () => {
  const initSql = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return "";
  })();
  void initSql;

  /** All identifiers created by 0000_init.sql plus the post-init migration list. */
  function ddlText(): string {
    const initPath = join(
      dirname(new URL(import.meta.url).pathname),
      "../../drizzle/postgres/0000_init.sql",
    );
    // eslint-disable-next-line no-restricted-syntax
    const init = readFileSyncSafe(initPath);
    return [init, ...postgresPostInitMigrations].join("\n");
  }

  function readFileSyncSafe(path: string): string {
    // Imported lazily to keep the top-level import list dialect-focused.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return readFileSyncImpl(path);
  }

  it("creates every table declared in schema-pg.ts", () => {
    const sql = ddlText();
    const declared = Object.values(pgSchema)
      .filter((v): v is PgTable => v instanceof PgTable)
      .map((t) => getPgTableConfig(t).name);
    expect(declared.length).toBeGreaterThan(0);

    const created = new Set(
      [...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([a-z_]+)"?/gi)].map((m) =>
        m[1]!.toLowerCase(),
      ),
    );
    const missing = declared.filter((name) => !created.has(name.toLowerCase()));
    expect(missing, `Postgres DDL never creates: ${missing.join(", ")}`).toEqual([]);
  });

  it("creates every column declared for the v9-v12 tables", () => {
    const sql = ddlText();
    for (const table of V9_TO_V12_TABLES) {
      const drizzleTable = Object.values(pgSchema)
        .filter((v): v is PgTable => v instanceof PgTable)
        .find((t) => getPgTableConfig(t).name === table);
      expect(drizzleTable, `schema-pg.ts declares no ${table}`).toBeDefined();

      const declaredCols = getPgTableConfig(drizzleTable!).columns.map((c) => c.name);
      // Statement-level scan: the CREATE TABLE body plus any ADD COLUMN for it.
      const createBody =
        new RegExp(`CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+"?${table}"?\\s*\\(([\\s\\S]*?)\\n\\s*\\)`, "i").exec(
          sql,
        )?.[1] ?? "";
      const added = [
        ...sql.matchAll(
          new RegExp(`ALTER TABLE\\s+"?${table}"?\\s+ADD COLUMN(?:\\s+IF NOT EXISTS)?\\s+"?([a-z_]+)"?`, "gi"),
        ),
      ].map((m) => m[1]!.toLowerCase());
      const bodyCols = createBody
        .split("\n")
        .map((line) => /^\s*"?([a-z_]+)"?\s+[A-Z]/.exec(line)?.[1]?.toLowerCase())
        .filter((c): c is string => Boolean(c));
      const present = new Set([...bodyCols, ...added]);

      const missing = declaredCols.filter((c) => !present.has(c.toLowerCase()));
      expect(missing, `Postgres DDL for ${table} is missing: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("gives print_jobs the columns the farm-status/print-stats tools read", () => {
    const sql = ddlText();
    for (const col of PRINT_JOBS_REQUIRED_COLUMNS) {
      const created = new RegExp(`^\\s*"?${col}"?\\s+[A-Z]`, "im").test(
        new RegExp(`CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+"?print_jobs"?\\s*\\(([\\s\\S]*?)\\n\\s*\\)`, "i").exec(
          sql,
        )?.[1] ?? "",
      );
      const altered = new RegExp(
        `ALTER TABLE\\s+"?print_jobs"?\\s+ADD COLUMN(?:\\s+IF NOT EXISTS)?\\s+"?${col}"?`,
        "i",
      ).test(sql);
      expect(created || altered, `Postgres print_jobs never gets column ${col}`).toBe(true);
    }
  });

  it("keeps every post-init statement idempotent (safe to re-run on boot)", () => {
    for (const stmt of postgresPostInitMigrations) {
      const isCreate = /^\s*CREATE\s+(TABLE|(UNIQUE\s+)?INDEX)/i.test(stmt);
      const isAlter = /^\s*ALTER TABLE/i.test(stmt);
      if (isCreate) {
        expect(stmt, `not idempotent: ${stmt.slice(0, 60)}`).toMatch(/IF NOT EXISTS/i);
      } else if (isAlter) {
        expect(stmt, `not idempotent: ${stmt.slice(0, 60)}`).toMatch(
          /ADD COLUMN IF NOT EXISTS/i,
        );
      } else {
        throw new Error(`unexpected non-DDL post-init statement: ${stmt.slice(0, 60)}`);
      }
    }
  });
});

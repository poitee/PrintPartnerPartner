import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { getTableConfig as getPgTableConfig, PgTable } from "drizzle-orm/pg-core";
import Database from "better-sqlite3";
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

const V14_TABLES = [
  "printer_profile_assignments",
  "printer_filament_slot_assignments",
];

const V15_TABLES = ["slicer_instances"];

const V16_TABLES = [
  "source_revisions",
  "plan_revision_input_sets",
  "plan_revision_inputs",
];

const V18_TABLES = ["plan_accepted_input_sets"];

const V19_TABLES = ["plan_revisions", "plan_revision_parts"];

const V20_TABLES = ["plan_drafts", "plan_draft_inputs", "plan_draft_parts"];

const V20_COLUMNS: Record<string, string[]> = {
  plan_drafts: [
    "id",
    "tenant_id",
    "profile_id",
    "base_revision_id",
    "base_plan_version",
    "state",
    "digest_format",
    "snapshot_digest",
    "created_by",
    "idempotency_key",
    "created_at",
  ],
  plan_draft_inputs: [
    "id",
    "tenant_id",
    "draft_id",
    "source_id",
    "source_layer",
    "layer_order",
    "tracking_kind",
    "source_revision_id",
    "manifest_digest",
    "effective_naming_digest",
  ],
  plan_draft_parts: [
    "id",
    "tenant_id",
    "draft_id",
    "base_revision_part_id",
    "part_key",
    "relative_path",
    "filename",
    "source_layer",
    "status",
    "role_inferred",
    "role_override",
    "filament_color_id",
    "filament_custom_hex",
    "spoolman_spool_id",
    "quantity_inferred",
    "quantity_override",
    "quantity_effective",
    "included",
    "notes",
    "github_blob_url",
    "geometry_same",
    "requirement",
    "option_group_id",
    "manifest_source",
    "artifact_digest",
  ],
};

const V19_COLUMNS: Record<string, string[]> = {
  build_profiles: ["accepted_plan_revision_id", "accepted_plan_version"],
  plan_revisions: [
    "id",
    "tenant_id",
    "profile_id",
    "revision_number",
    "parent_revision_id",
    "input_set_id",
    "provenance_kind",
    "digest_format",
    "snapshot_digest",
    "created_by",
    "accepted_by",
    "created_at",
    "accepted_at",
  ],
  plan_revision_parts: [
    "id",
    "tenant_id",
    "revision_id",
    "projection_part_id",
    "part_key",
    "relative_path",
    "filename",
    "source_layer",
    "status",
    "role_inferred",
    "role_override",
    "filament_color_id",
    "filament_custom_hex",
    "spoolman_spool_id",
    "quantity_inferred",
    "quantity_override",
    "quantity_effective",
    "included",
    "notes",
    "github_blob_url",
    "geometry_same",
    "requirement",
    "option_group_id",
    "manifest_source",
    "artifact_digest",
  ],
};

const V18_COLUMNS: Record<string, string[]> = {
  plan_revision_input_sets: ["format_version"],
  plan_revision_inputs: [
    "source_id",
    "source_layer",
    "layer_order",
    "tracking_kind",
    "effective_naming_digest",
  ],
  plan_accepted_input_sets: ["tenant_id", "profile_id", "input_set_id", "accepted_at"],
};

const V16_COLUMNS: Record<string, string[]> = {
  source_revisions: [
    "id",
    "tenant_id",
    "project_id",
    "upstream_revision_key",
    "manifest_digest",
    "snapshot_locator",
    "synced_at",
    "completeness",
  ],
  plan_revision_input_sets: [
    "id",
    "tenant_id",
    "profile_id",
    "input_set_digest",
    "expected_input_count",
    "recorded_at",
    "published_at",
  ],
  plan_revision_inputs: [
    "id",
    "tenant_id",
    "input_set_id",
    "source_revision_id",
    "manifest_digest",
  ],
};

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

function replacePlanInputsWithV17Table(raw: Database.Database): void {
  raw.pragma("foreign_keys = OFF");
  raw.exec(`
    DROP TABLE plan_revision_inputs;
    CREATE TABLE plan_revision_inputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      input_set_id INTEGER NOT NULL REFERENCES plan_revision_input_sets(id) ON DELETE CASCADE,
      source_revision_id INTEGER NOT NULL REFERENCES source_revisions(id) ON DELETE RESTRICT,
      manifest_digest TEXT NOT NULL
    );
  `);
  raw.pragma("foreign_keys = ON");
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

  it("creates the v14 printer assignment tables", () => {
    withSqlite((sqlite) => {
      const tables = sqliteTableNames(sqlite);
      for (const table of V14_TABLES) {
        expect(tables, `missing table ${table}`).toContain(table);
      }
    });
  });

  it("creates the v15-v22 tables and records schema version 22", () => {
    withSqlite((sqlite) => {
      const tables = sqliteTableNames(sqlite);
      for (const table of [
        ...V15_TABLES,
        ...V16_TABLES,
        ...V18_TABLES,
        ...V19_TABLES,
        ...V20_TABLES,
      ]) {
        expect(tables, `missing table ${table}`).toContain(table);
      }
      expect(
        rawSqlite(sqlite)
          .prepare("SELECT value FROM app_settings WHERE tenant_id = ? AND key = ?")
          .get("default", "schema_version") as { value: string },
      ).toMatchObject({ value: "22" });
      expect(sqliteColumnNames(sqlite, "projects")).toContain(
        "current_source_revision_id",
      );
    });
  });

  it("creates every v16 revision column", () => {
    withSqlite((sqlite) => {
      for (const [table, expected] of Object.entries(V16_COLUMNS)) {
        expect(sqliteColumnNames(sqlite, table)).toEqual(expect.arrayContaining(expected));
      }
    });
  });

  it("creates every v18 accepted-input column", () => {
    withSqlite((sqlite) => {
      for (const [table, expected] of Object.entries(V18_COLUMNS)) {
        expect(sqliteColumnNames(sqlite, table)).toEqual(expect.arrayContaining(expected));
      }
    });
  });

  it("creates every v19 accepted-revision column", () => {
    withSqlite((sqlite) => {
      for (const [table, expected] of Object.entries(V19_COLUMNS)) {
        expect(sqliteColumnNames(sqlite, table)).toEqual(expect.arrayContaining(expected));
      }
    });
  });

  it("creates every v20 saved-draft column", () => {
    withSqlite((sqlite) => {
      for (const [table, expected] of Object.entries(V20_COLUMNS)) {
        expect(sqliteColumnNames(sqlite, table)).toEqual(expect.arrayContaining(expected));
      }
    });
  });

  it("adds v22 origin without changing lifecycle state or digest", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-schema-v21-"));
    const databasePath = join(dir, "print-partner.db");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE plan_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        profile_id INTEGER NOT NULL,
        base_revision_id INTEGER,
        base_plan_version INTEGER NOT NULL,
        state TEXT NOT NULL,
        digest_format TEXT NOT NULL,
        snapshot_digest TEXT NOT NULL,
        created_by TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO plan_drafts (
        tenant_id, profile_id, base_revision_id, base_plan_version, state,
        digest_format, snapshot_digest, created_by, idempotency_key, created_at
      ) VALUES
        ('default', 1, NULL, 0, 'open', 'plan-draft-v1', 'a', 'test', 'open', 'now'),
        ('default', 1, NULL, 0, 'abandoned', 'plan-draft-v1', 'b', 'test', 'abandoned', 'now'),
        ('default', 1, NULL, 0, 'consumed', 'plan-draft-v1', 'c', 'test', 'consumed', 'now');
    `);
    legacy.close();
    const upgraded = new SqliteDatabase(dir);
    upgraded.connect();
    try {
      expect(
        rawSqlite(upgraded)
          .prepare(
            `SELECT state, lifecycle_version, snapshot_digest,
                    rebased_from_draft_id, rebased_from_lifecycle_version,
                    rebased_from_snapshot_digest
               FROM plan_drafts ORDER BY id`,
          )
          .all(),
      ).toEqual([
        {
          state: "open",
          lifecycle_version: 0,
          snapshot_digest: "a",
          rebased_from_draft_id: null,
          rebased_from_lifecycle_version: null,
          rebased_from_snapshot_digest: null,
        },
        {
          state: "abandoned",
          lifecycle_version: 0,
          snapshot_digest: "b",
          rebased_from_draft_id: null,
          rebased_from_lifecycle_version: null,
          rebased_from_snapshot_digest: null,
        },
        {
          state: "consumed",
          lifecycle_version: 0,
          snapshot_digest: "c",
          rebased_from_draft_id: null,
          rebased_from_lifecycle_version: null,
          rebased_from_snapshot_digest: null,
        },
      ]);
      rawSqlite(upgraded)
        .prepare("INSERT INTO build_profiles (id, tenant_id, name) VALUES (1, 'default', 'Migrated')")
        .run();
      expect(() =>
        rawSqlite(upgraded)
          .prepare("UPDATE plan_drafts SET rebased_from_draft_id = 2 WHERE id = 1")
          .run(),
      ).toThrow(/lineage/i);
    } finally {
      upgraded.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates the v22 draft uniqueness, lifecycle, and origin declarations in SQLite", () => {
    withSqlite((sqlite) => {
      const raw = rawSqlite(sqlite);
      const creationKey = raw
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get("uq_plan_drafts_tenant_actor_profile_key") as { sql: string };
      expect(creationKey.sql).toMatch(
        /ON plan_drafts \(tenant_id, created_by, profile_id, idempotency_key\)/i,
      );
      const predecessor = raw
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get("uq_plan_draft_parts_tenant_draft_predecessor") as { sql: string };
      expect(predecessor.sql).toMatch(
        /ON plan_draft_parts \(tenant_id, draft_id, base_revision_part_id\)/i,
      );
      const lifecycle = raw
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_plan_drafts_state_transition'",
          )
          .get() as { sql: string };
      expect(lifecycle.sql).toMatch(/UPDATE OF state, lifecycle_version/i);
      expect(lifecycle.sql).toMatch(/NEW\.lifecycle_version = OLD\.lifecycle_version \+ 1/i);
      const table = raw
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'plan_drafts'")
        .get() as { sql: string };
      expect(table.sql).toMatch(/lifecycle_version >= 0 AND lifecycle_version <= 2147483647/i);
      expect(table.sql).toContain("rebased_from_draft_id");
      expect(
        raw
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get("uq_plan_drafts_tenant_profile_rebase_source_generation"),
      ).toBeDefined();
      expect(
        raw
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE ?")
          .all("trg_plan_drafts_lineage_%"),
      ).toHaveLength(3);
      const lineageInsert = raw
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_plan_drafts_lineage_insert'",
        )
        .get();
      if (
        !lineageInsert ||
        typeof lineageInsert !== "object" ||
        !("sql" in lineageInsert) ||
        typeof lineageInsert.sql !== "string"
      ) {
        throw new Error("Plan draft lineage insert trigger is missing");
      }
      expect(lineageInsert.sql).not.toMatch(
        /NEW\.rebased_from_draft_id\s*=\s*NEW\.id/i,
      );
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

  it("rejects orphaned v17 Plan inputs before rebuilding their table", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-schema-v18-orphan-"));
    const dbPath = join(dir, "print-partner.db");
    try {
      const legacy = new SqliteDatabase(dir);
      legacy.connect();
      const raw = rawSqlite(legacy);
      replacePlanInputsWithV17Table(raw);
      raw.pragma("foreign_keys = OFF");
      raw.prepare(
        `INSERT INTO plan_revision_inputs
          (tenant_id, input_set_id, source_revision_id, manifest_digest)
         VALUES ('default', 1, 999, ?)`,
      ).run("a".repeat(64));
      raw.pragma("foreign_keys = ON");
      legacy.close();

      const upgrade = new SqliteDatabase(dir);
      expect(() => upgrade.connect()).toThrow(/Source revision is missing/i);
      upgrade.close();

      const inspect = new Database(dbPath);
      expect(
        (inspect.pragma("table_info(plan_revision_inputs)") as { name: string; notnull: number }[])
          .find((column) => column.name === "source_revision_id")?.notnull,
      ).toBe(1);
      expect(
        inspect.prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'plan_revision_inputs_v17'",
        ).get(),
      ).toEqual({ count: 0 });
      inspect.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves duplicate Sources in v1 history while constraining v2 inputs", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-schema-v18-legacy-duplicates-"));
    try {
      const legacy = new SqliteDatabase(dir);
      legacy.connect();
      const raw = rawSqlite(legacy);
      replacePlanInputsWithV17Table(raw);
      const source = raw.prepare(
        `INSERT INTO projects (tenant_id, name, url, source_type, branch, source_kind, role)
         VALUES ('default', 'Legacy', '', 'git', 'main', 'github', 'unassigned')`,
      ).run();
      const profile = raw.prepare(
        "INSERT INTO build_profiles (tenant_id, name) VALUES ('default', 'Legacy plan')",
      ).run();
      const inputSet = raw.prepare(
        `INSERT INTO plan_revision_input_sets
          (tenant_id, profile_id, input_set_digest, expected_input_count, recorded_at, published_at, format_version)
         VALUES ('default', ?, ?, 2, ?, ?, 1)`,
      ).run(
        Number(profile.lastInsertRowid),
        "c".repeat(64),
        "2026-08-20T12:00:00.000Z",
        "2026-08-20T12:00:00.000Z",
      );
      const insertRevision = raw.prepare(
        `INSERT INTO source_revisions
          (tenant_id, project_id, upstream_revision_key, manifest_digest, snapshot_locator, synced_at, completeness)
         VALUES ('default', ?, ?, ?, ?, ?, 'complete')`,
      );
      const firstRevision = insertRevision.run(
        Number(source.lastInsertRowid),
        "legacy-a",
        "a".repeat(64),
        "1/revisions/legacy-a",
        "2026-08-20T12:00:00.000Z",
      );
      const secondRevision = insertRevision.run(
        Number(source.lastInsertRowid),
        "legacy-b",
        "b".repeat(64),
        "1/revisions/legacy-b",
        "2026-08-20T12:01:00.000Z",
      );
      const insertLegacyInput = raw.prepare(
        `INSERT INTO plan_revision_inputs
          (tenant_id, input_set_id, source_revision_id, manifest_digest)
         VALUES ('default', ?, ?, ?)`,
      );
      insertLegacyInput.run(
        Number(inputSet.lastInsertRowid),
        Number(firstRevision.lastInsertRowid),
        "a".repeat(64),
      );
      insertLegacyInput.run(
        Number(inputSet.lastInsertRowid),
        Number(secondRevision.lastInsertRowid),
        "b".repeat(64),
      );
      legacy.close();

      const upgraded = new SqliteDatabase(dir);
      expect(() => upgraded.connect()).not.toThrow();
      const upgradedRaw = rawSqlite(upgraded);
      expect(
        upgradedRaw.prepare(
          "SELECT count(*) AS count FROM plan_revision_inputs WHERE input_set_id = ?",
        ).get(Number(inputSet.lastInsertRowid)),
      ).toEqual({ count: 2 });
      const indexSql = upgradedRaw.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'uq_plan_revision_inputs_v2_set_source'",
      ).get() as { sql: string };
      expect(indexSql.sql).toMatch(/WHERE effective_naming_digest IS NOT NULL/i);
      upgraded.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rolls back the v17 Plan-input table rename when rebuilding fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-schema-v18-rollback-"));
    const dbPath = join(dir, "print-partner.db");
    try {
      const legacy = new SqliteDatabase(dir);
      legacy.connect();
      const raw = rawSqlite(legacy);
      replacePlanInputsWithV17Table(raw);
      raw.pragma("foreign_keys = OFF");
      const source = raw.prepare(
        `INSERT INTO projects (tenant_id, name, url, source_type, branch, source_kind, role)
         VALUES ('default', 'Legacy', '', 'git', 'main', 'github', 'unassigned')`,
      ).run();
      const revision = raw.prepare(
        `INSERT INTO source_revisions
          (tenant_id, project_id, upstream_revision_key, manifest_digest, snapshot_locator, synced_at, completeness)
         VALUES ('default', ?, 'legacy', ?, '1/revisions/legacy', ?, 'complete')`,
      ).run(Number(source.lastInsertRowid), "b".repeat(64), "2026-08-20T12:00:00.000Z");
      const profile = raw.prepare(
        "INSERT INTO build_profiles (tenant_id, name) VALUES ('default', 'Legacy plan')",
      ).run();
      const inputSet = raw.prepare(
        `INSERT INTO plan_revision_input_sets
          (tenant_id, profile_id, input_set_digest, expected_input_count, recorded_at, published_at, format_version)
         VALUES ('default', ?, ?, 1, ?, ?, 1)`,
      ).run(
        Number(profile.lastInsertRowid),
        "c".repeat(64),
        "2026-08-20T12:00:00.000Z",
        "2026-08-20T12:00:00.000Z",
      );
      raw.prepare(
        `INSERT INTO plan_revision_inputs
          (tenant_id, input_set_id, source_revision_id, manifest_digest)
         VALUES ('default', ?, ?, ?)`,
      ).run(Number(inputSet.lastInsertRowid), Number(revision.lastInsertRowid), "b".repeat(64));
      raw.exec(`
        CREATE TABLE migration_index_collision (id INTEGER PRIMARY KEY);
        CREATE UNIQUE INDEX uq_plan_revision_inputs_v2_set_source
          ON migration_index_collision (id);
      `);
      raw.pragma("foreign_keys = ON");
      legacy.close();

      const upgrade = new SqliteDatabase(dir);
      expect(() => upgrade.connect()).toThrow(/index uq_plan_revision_inputs_v2_set_source already exists/i);
      upgrade.close();

      const inspect = new Database(dbPath);
      const columns = inspect.pragma("table_info(plan_revision_inputs)") as {
        name: string;
        notnull: number;
      }[];
      expect(columns.find((column) => column.name === "source_revision_id")?.notnull).toBe(1);
      expect(inspect.prepare("SELECT count(*) AS count FROM plan_revision_inputs").get()).toEqual({
        count: 1,
      });
      expect(
        inspect.prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'plan_revision_inputs_v17'",
        ).get(),
      ).toEqual({ count: 0 });
      inspect.close();
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
    expect(sqliteSchema.currentSchemaVersion).toBe(22);
    expect(pgSchema.currentSchemaVersion).toBe(22);
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

  it("creates every v16 revision column in Postgres DDL", () => {
    for (const [table, expected] of Object.entries(V16_COLUMNS)) {
      const present = new Set([...pgCreatedColumns(table), ...pgAddedColumns(table)]);
      for (const column of expected) {
        expect(present.has(column), `Postgres ${table} never gets column ${column}`).toBe(true);
      }
    }
  });

  it("adds the v17 current revision pointer in Postgres DDL", () => {
    const present = new Set([
      ...pgCreatedColumns("projects"),
      ...pgAddedColumns("projects"),
    ]);
    expect(present).toContain("current_source_revision_id");
  });

  it("adds every v18 accepted-input column in Postgres DDL", () => {
    for (const [table, expected] of Object.entries(V18_COLUMNS)) {
      const present = new Set([...pgCreatedColumns(table), ...pgAddedColumns(table)]);
      for (const column of expected) {
        expect(present.has(column), `Postgres ${table} never gets column ${column}`).toBe(true);
      }
    }
  });

  it("adds every v19 accepted-revision column in Postgres DDL", () => {
    for (const [table, expected] of Object.entries(V19_COLUMNS)) {
      const present = new Set([...pgCreatedColumns(table), ...pgAddedColumns(table)]);
      for (const column of expected) {
        expect(present.has(column), `Postgres ${table} never gets column ${column}`).toBe(true);
      }
    }
  });

  it("enforces the v18 Plan-input identity constraints in Postgres", () => {
    expect(POSTGRES_DDL).toMatch(
      /ALTER TABLE plan_revision_inputs ALTER COLUMN source_id SET NOT NULL/i,
    );
    expect(POSTGRES_DDL).toMatch(
      /ALTER TABLE plan_revision_inputs ALTER COLUMN source_layer SET NOT NULL/i,
    );
    expect(POSTGRES_DDL).toMatch(/chk_plan_revision_inputs_tracking_kind/i);
    expect(POSTGRES_DDL).toMatch(/chk_plan_revision_inputs_revision_identity/i);
    expect(POSTGRES_DDL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_revision_inputs_v2_set_source[\s\S]*WHERE effective_naming_digest IS NOT NULL/i,
    );
  });

  it("enforces v19 accepted-revision ownership and immutability in Postgres", () => {
    for (const constraint of [
      "fk_plan_revisions_profile_owner",
      "fk_plan_revisions_parent_owner",
      "fk_plan_revisions_input_owner",
      "fk_plan_revision_parts_revision_owner",
      "fk_build_profiles_revision_owner",
    ]) {
      expect(POSTGRES_DDL).toContain(constraint);
    }
    expect(POSTGRES_DDL).toContain("trg_plan_revisions_immutable");
    expect(POSTGRES_DDL).toContain("trg_plan_revision_parts_immutable");
    expect(POSTGRES_DDL).toContain("trg_parts_invalidate_accepted_revision");
    expect(POSTGRES_DDL).toContain("trg_profile_layers_invalidate_accepted_revision");
    expect(POSTGRES_DDL).toContain("trg_plan_revision_part_projection_owner");
  });

  it("creates the v22 draft snapshot tables and lifecycle guards in Postgres", () => {
    for (const [table, expected] of Object.entries(V20_COLUMNS)) {
      expect(pgCreatedColumns(table)).toEqual(expect.arrayContaining(expected));
    }
    expect(POSTGRES_DDL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_drafts_tenant_actor_profile_key\s+ON plan_drafts \(tenant_id, created_by, profile_id, idempotency_key\)/i,
    );
    expect(POSTGRES_DDL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_draft_parts_tenant_draft_predecessor\s+ON plan_draft_parts \(tenant_id, draft_id, base_revision_part_id\)/i,
    );
    expect(POSTGRES_DDL).toMatch(
      /CREATE TRIGGER trg_plan_drafts_ownership_write\s+BEFORE INSERT OR UPDATE ON plan_drafts\s+FOR EACH ROW EXECUTE FUNCTION validate_plan_draft_ownership\(\)/i,
    );
    expect(POSTGRES_DDL).toMatch(
      /DROP TRIGGER IF EXISTS trg_plan_drafts_state_transition ON plan_drafts;[\s\S]*CREATE TRIGGER trg_plan_drafts_state_transition\s+BEFORE UPDATE OF state, lifecycle_version ON plan_drafts\s+FOR EACH ROW EXECUTE FUNCTION enforce_plan_draft_state_transition\(\)/i,
    );
    expect(POSTGRES_DDL).toMatch(/lifecycle_version >= 0 AND lifecycle_version <= 2147483647/i);
    expect(POSTGRES_DDL).toMatch(
      /DROP TRIGGER IF EXISTS trg_plan_drafts_identity_immutable ON plan_drafts;[\s\S]*CREATE TRIGGER trg_plan_drafts_identity_immutable\s+BEFORE UPDATE OF tenant_id, profile_id, base_revision_id, base_plan_version,\s+rebased_from_draft_id, rebased_from_lifecycle_version,\s+rebased_from_snapshot_digest\s+ON plan_drafts\s+FOR EACH ROW EXECUTE FUNCTION enforce_plan_draft_identity_immutable\(\)/i,
    );
    expect(POSTGRES_DDL).toMatch(
      /CREATE TRIGGER trg_plan_draft_inputs_ownership_write\s+BEFORE INSERT OR UPDATE ON plan_draft_inputs\s+FOR EACH ROW EXECUTE FUNCTION validate_plan_draft_input_ownership\(\)/i,
    );
    expect(POSTGRES_DDL).toMatch(
      /CREATE TRIGGER trg_plan_draft_parts_ownership_write\s+BEFORE INSERT OR UPDATE ON plan_draft_parts\s+FOR EACH ROW EXECUTE FUNCTION validate_plan_draft_part_ownership\(\)/i,
    );
    expect(POSTGRES_DDL).toMatch(
      /BEFORE UPDATE OF tenant_id, profile_id, base_revision_id, base_plan_version,\s+rebased_from_draft_id, rebased_from_lifecycle_version,\s+rebased_from_snapshot_digest\s+ON plan_drafts/i,
    );
    expect(POSTGRES_DDL).toContain("chk_plan_drafts_rebase_origin");
    expect(POSTGRES_DDL).toContain(
      "uq_plan_drafts_tenant_profile_rebase_source_generation",
    );
    expect(POSTGRES_DDL).toMatch(
      /source\.state = 'abandoned'[\s\S]*source\.lifecycle_version = NEW\.rebased_from_lifecycle_version[\s\S]*source\.snapshot_digest = NEW\.rebased_from_snapshot_digest/i,
    );
    expect(POSTGRES_DDL).toMatch(/source\.id <> NEW\.id/i);
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
        expect(stmt, `not idempotent: ${head}`).toMatch(
          /ADD COLUMN IF NOT EXISTS|ALTER COLUMN .* (DROP|SET) NOT NULL|DROP CONSTRAINT IF EXISTS|ADD CONSTRAINT chk_plan_revision_inputs_/i,
        );
      } else if (/^\s*UPDATE plan_revision_inputs/i.test(stmt)) {
        expect(stmt, `not idempotent: ${head}`).toMatch(
          /source_id IS NULL OR plan_revision_inputs\.source_layer IS NULL/i,
        );
      } else if (/^\s*CREATE OR REPLACE FUNCTION/i.test(stmt)) {
        expect(stmt, `not idempotent: ${head}`).toMatch(/CREATE OR REPLACE FUNCTION/i);
      } else if (/^\s*DO \$block\$/i.test(stmt)) {
        expect(stmt, `not idempotent: ${head}`).toMatch(/IF NOT EXISTS|DROP TRIGGER IF EXISTS/i);
      } else {
        throw new Error(`unexpected non-DDL post-init statement: ${head}`);
      }
    }
  });
});

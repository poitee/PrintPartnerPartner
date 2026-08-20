import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "./schema-pg.js";
import { currentSchemaVersion, schemaVersionKey } from "./schema-pg.js";
import {
  POSTGRES_SYNC_MAX_RESULT_BYTES,
  POSTGRES_SYNC_MAX_RESULT_ROWS,
  registerPostgresSyncQuery,
  unregisterPostgresSyncQuery,
  type PostgresSyncQuery,
  type PostgresSyncResult,
} from "./sync-db-bridge.js";

export type PostgresDrizzleDb = NodePgDatabase<typeof schema>;

const require = createRequire(import.meta.url);
const PG_MODULE_PATH = require.resolve("pg");
const SYNC_QUERY_SCRIPT = `
const { Client } = require(process.argv[1]);
const MAX_RESULT_ROWS = ${POSTGRES_SYNC_MAX_RESULT_ROWS};
const MAX_RESULT_BYTES = ${POSTGRES_SYNC_MAX_RESULT_BYTES};
let client;
(async () => {
  try {
    const input = JSON.parse(await new Promise((resolve, reject) => {
      let body = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { body += chunk; });
      process.stdin.on("end", () => resolve(body));
      process.stdin.on("error", reject);
    }));
    client = new Client({ connectionString: input.databaseUrl });
    await client.connect();
    const result = await client.query(
      input.arrayMode ? { text: input.sql, rowMode: "array" } : input.sql,
      input.params,
    );
    if (result.rows.length > MAX_RESULT_ROWS) {
      throw new Error(
        \`result row limit of \${MAX_RESULT_ROWS.toLocaleString("en-US")} exceeded (received \${result.rows.length.toLocaleString("en-US")})\`,
      );
    }
    const payload = JSON.stringify({
      ok: true,
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
    });
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    if (payloadBytes > MAX_RESULT_BYTES) {
      throw new Error(
        \`result byte limit of 8 MiB exceeded (received \${payloadBytes.toLocaleString("en-US")} bytes)\`,
      );
    }
    process.stdout.write(payload);
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
})();
`;

function runPostgresSyncQuery(
  databaseUrl: string,
  query: PostgresSyncQuery,
): PostgresSyncResult {
  const result = spawnSync(process.execPath, ["-e", SYNC_QUERY_SCRIPT, PG_MODULE_PATH], {
    cwd: process.cwd(),
    input: JSON.stringify({ databaseUrl, ...query }),
    encoding: "utf8",
    // The worker checks the 8 MiB payload before writing. Headroom carries the
    // protocol envelope and a useful error if a future worker violates that contract.
    maxBuffer: POSTGRES_SYNC_MAX_RESULT_BYTES + 64 * 1024,
    timeout: 30_000,
  });
  let payload: {
    ok?: boolean;
    rows?: unknown[];
    rowCount?: number;
    error?: string;
  } = {};
  try {
    payload = JSON.parse(result.stdout || "{}") as typeof payload;
  } catch {
    // The detailed process error below is more useful than a secondary JSON error.
  }
  if (result.status !== 0 || !payload.ok) {
    const spawnErrorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
    const detail =
      payload.error ||
      (spawnErrorCode === "ENOBUFS"
        ? "query worker output exceeded the configured 8 MiB result ceiling"
        : undefined) ||
      result.error?.message ||
      result.stderr.trim() ||
      `query worker exited with status ${String(result.status)}`;
    throw new Error(`Postgres synchronous query failed: ${detail}`);
  }
  return {
    rows: payload.rows ?? [],
    rowCount: payload.rowCount ?? 0,
  };
}

const MIGRATION_SQL = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle/postgres/0000_init.sql",
);

/**
 * DDL applied after drizzle/postgres/0000_init.sql, in order.
 *
 * Everything here must be idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
 * because it is re-run on every process start. Postgres, unlike SQLite, does
 * support ADD COLUMN IF NOT EXISTS, so no error swallowing is needed.
 *
 * Exported so schema-parity tests can assert that every table/column declared
 * in schema-pg.ts is actually created here — the Postgres deploy previously
 * stamped schema_version ahead of DDL while never creating the v9+ tables
 * (print_jobs, printer_telemetry, app_events, the slicer profile tables), so
 * saas installs reported a high schema version against a v8 database.
 */
export const postgresPostInitMigrations: string[] = [
  "ALTER TABLE parts ADD COLUMN IF NOT EXISTS spoolman_spool_id TEXT",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS tag TEXT",
  "ALTER TABLE build_profiles ADD COLUMN IF NOT EXISTS config_modified_at TEXT",
  "ALTER TABLE build_profiles ADD COLUMN IF NOT EXISTS last_recomputed_at TEXT",
  "ALTER TABLE build_profiles ADD COLUMN IF NOT EXISTS archived_at TEXT",
  "ALTER TABLE build_profiles ADD COLUMN IF NOT EXISTS last_used_at TEXT",
  "ALTER TABLE build_profiles ADD COLUMN IF NOT EXISTS special_request TEXT",
  // Assembly tracking: printed-but-not-yet-installed state per print_progress unit.
  // Mirrors the guarded ADD COLUMN in client.ts (SQLite) — defaults every existing
  // and new row to false/not-assembled.
  "ALTER TABLE print_progress ADD COLUMN IF NOT EXISTS assembled BOOLEAN NOT NULL DEFAULT FALSE",
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_identities (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identity_provider
    ON auth_identities (provider, provider_user_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS plan_shares (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    from_user_id TEXT NOT NULL REFERENCES users(id),
    plan_id INTEGER NOT NULL,
    plan_name TEXT NOT NULL,
    recipient_email TEXT,
    bundle_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS source_docs (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT,
    extract_status TEXT NOT NULL DEFAULT 'pending',
    extract_error TEXT,
    page_count INTEGER,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_source_docs_project_path
    ON source_docs (project_id, path)`,
  `CREATE TABLE IF NOT EXISTS source_notes (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    profile_id INTEGER REFERENCES build_profiles(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    body_markdown TEXT NOT NULL DEFAULT '',
    author_user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS plan_decisions (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    profile_id INTEGER NOT NULL REFERENCES build_profiles(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'assistant',
    kind TEXT NOT NULL,
    action_type TEXT,
    params_json TEXT NOT NULL DEFAULT '{}',
    label TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    rationale TEXT,
    result_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plan_decisions_profile
    ON plan_decisions (profile_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS plan_snapshots (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    profile_id INTEGER NOT NULL REFERENCES build_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    payload_json TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plan_snapshots_profile
    ON plan_snapshots (profile_id, created_at)`,
  // v9 — slicer profile tables. Mirrors the v9 block of schemaMigrations in schema.ts.
  `CREATE TABLE IF NOT EXISTS printer_profiles (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    slicer_format TEXT NOT NULL,
    slicer_version_at_import TEXT,
    printable_area TEXT,
    printable_height_mm TEXT,
    bed_exclude_area TEXT,
    nozzle_diameter_mm TEXT,
    extruder_count INTEGER NOT NULL DEFAULT 1,
    raw_json TEXT,
    raw_ini TEXT,
    resolved_flat_config TEXT,
    imported_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_printer_profiles_tenant_name
    ON printer_profiles (tenant_id, name)`,
  `CREATE TABLE IF NOT EXISTS process_profiles (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    slicer_format TEXT NOT NULL,
    compatible_printers TEXT,
    resolved_flat_config TEXT,
    imported_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_process_profiles_tenant_name
    ON process_profiles (tenant_id, name)`,
  `CREATE TABLE IF NOT EXISTS filament_profiles (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    material_type TEXT NOT NULL,
    material_tier INTEGER NOT NULL DEFAULT 1,
    nozzle_temp_c INTEGER,
    bed_temp_c INTEGER,
    fan_pct INTEGER,
    extrusion_multiplier TEXT,
    pressure_advance TEXT,
    retraction TEXT,
    raw_json TEXT,
    raw_ini TEXT,
    resolved_flat_config TEXT,
    imported_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_filament_profiles_tenant_name
    ON filament_profiles (tenant_id, name)`,
  `CREATE TABLE IF NOT EXISTS printer_name_map (
    id SERIAL PRIMARY KEY,
    slicer_name TEXT NOT NULL,
    pp_fleet_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_printer_name_map_slicer_name
    ON printer_name_map (slicer_name)`,
  // v11 — print_jobs, print_job_parts, printer_telemetry, app_events.
  // (v10 is the print_progress.assembled column, applied above.)
  // CREATE matches the historical v11 shape; the ALTER statements below add
  // v12 columns for saas databases that already have a v11-shaped print_jobs table.
  `CREATE TABLE IF NOT EXISTS print_jobs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    profile_id INTEGER NOT NULL REFERENCES build_profiles(id) ON DELETE CASCADE,
    host_integration_id TEXT,
    filename TEXT,
    at TEXT NOT NULL,
    link_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_profile
    ON print_jobs (tenant_id, profile_id, at)`,
  `CREATE TABLE IF NOT EXISTS print_job_parts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    job_id TEXT REFERENCES print_jobs(id) ON DELETE SET NULL,
    at TEXT NOT NULL,
    profile_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    unit_index INTEGER NOT NULL DEFAULT 0,
    result TEXT NOT NULL,
    reason TEXT,
    note TEXT,
    host_integration_id TEXT,
    filename TEXT,
    match_key TEXT,
    role TEXT,
    filament_display TEXT,
    link_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_print_job_parts_profile
    ON print_job_parts (profile_id, at)`,
  `CREATE TABLE IF NOT EXISTS printer_telemetry (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    at TEXT NOT NULL,
    printer_id TEXT,
    host_integration_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_printer_telemetry_at
    ON printer_telemetry (tenant_id, at)`,
  `CREATE TABLE IF NOT EXISTS app_events (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    actor_type TEXT,
    actor_id TEXT,
    payload_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_events_kind_at
    ON app_events (tenant_id, kind, at)`,
  // v12 — printer_id / material / status / filament_consumed_g / completed_at on print_jobs.
  // These are the columns get_farm_status and get_print_stats read; a saas
  // database created before v12 has a print_jobs table without them.
  "ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS printer_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS material TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent'",
  "ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS filament_consumed_g INTEGER",
  "ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS completed_at TEXT",
  `CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_status
    ON print_jobs (tenant_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_print_jobs_printer
    ON print_jobs (tenant_id, printer_id)`,
  // v13 — profile-sync provenance columns on the three slicer profile tables.
  // Mirrors schemaMigrations v13 in schema.ts (SQLite).
  "ALTER TABLE printer_profiles ADD COLUMN IF NOT EXISTS source_path TEXT",
  "ALTER TABLE printer_profiles ADD COLUMN IF NOT EXISTS synced_from_slicer_version TEXT",
  "ALTER TABLE printer_profiles ADD COLUMN IF NOT EXISTS last_synced_at TEXT",
  "ALTER TABLE process_profiles ADD COLUMN IF NOT EXISTS source_path TEXT",
  "ALTER TABLE process_profiles ADD COLUMN IF NOT EXISTS synced_from_slicer_version TEXT",
  "ALTER TABLE process_profiles ADD COLUMN IF NOT EXISTS last_synced_at TEXT",
  "ALTER TABLE filament_profiles ADD COLUMN IF NOT EXISTS source_path TEXT",
  "ALTER TABLE filament_profiles ADD COLUMN IF NOT EXISTS synced_from_slicer_version TEXT",
  "ALTER TABLE filament_profiles ADD COLUMN IF NOT EXISTS last_synced_at TEXT",
  `CREATE INDEX IF NOT EXISTS idx_printer_profiles_source_path
    ON printer_profiles (source_path)`,
  `CREATE INDEX IF NOT EXISTS idx_process_profiles_source_path
    ON process_profiles (source_path)`,
  `CREATE INDEX IF NOT EXISTS idx_filament_profiles_source_path
    ON filament_profiles (source_path)`,
  // v14 — per-printer machine profile and per-slot filament assignments.
  `CREATE TABLE IF NOT EXISTS printer_profile_assignments (
    printer_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    machine_profile_id INTEGER,
    profile_source TEXT NOT NULL DEFAULT 'auto_match',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS printer_filament_slot_assignments (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    printer_id TEXT NOT NULL,
    slot_index INTEGER NOT NULL,
    filament_profile_id INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_printer_filament_slot
    ON printer_filament_slot_assignments (tenant_id, printer_id, slot_index)`,
  // v15 — registered slicer GUI / sync targets (Slicer Hub). Docker columns reserved for Plan 3.
  `CREATE TABLE IF NOT EXISTS slicer_instances (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    dialect TEXT NOT NULL,
    gui_url TEXT NOT NULL DEFAULT '',
    watch_path TEXT NOT NULL DEFAULT '',
    docker_target TEXT NOT NULL DEFAULT 'local',
    docker_host TEXT,
    compose_service TEXT,
    image TEXT,
    container_name TEXT,
    ports_json TEXT NOT NULL DEFAULT '[]',
    volumes_json TEXT NOT NULL DEFAULT '[]',
    env_json TEXT NOT NULL DEFAULT '{}',
    status_cache TEXT NOT NULL DEFAULT 'unknown',
    status_message TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // v16 — immutable Source revision identities and atomically published Plan inputs.
  `CREATE TABLE IF NOT EXISTS source_revisions (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    upstream_revision_key TEXT NOT NULL,
    manifest_digest TEXT NOT NULL,
    snapshot_locator TEXT NOT NULL,
    synced_at TEXT NOT NULL,
    completeness TEXT NOT NULL DEFAULT 'complete' CHECK (completeness = 'complete')
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_source_revisions_tenant_source_upstream
    ON source_revisions (tenant_id, project_id, upstream_revision_key)`,
  `CREATE INDEX IF NOT EXISTS idx_source_revisions_tenant_source_synced
    ON source_revisions (tenant_id, project_id, synced_at)`,
  `CREATE TABLE IF NOT EXISTS plan_revision_input_sets (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    profile_id INTEGER NOT NULL REFERENCES build_profiles(id) ON DELETE CASCADE,
    input_set_digest TEXT NOT NULL,
    expected_input_count INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    published_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_revision_input_sets_tenant_plan_digest
    ON plan_revision_input_sets (tenant_id, profile_id, input_set_digest)`,
  `CREATE INDEX IF NOT EXISTS idx_plan_revision_input_sets_tenant_plan_published
    ON plan_revision_input_sets (tenant_id, profile_id, published_at)`,
  `CREATE TABLE IF NOT EXISTS plan_revision_inputs (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    input_set_id INTEGER NOT NULL REFERENCES plan_revision_input_sets(id) ON DELETE CASCADE,
    source_revision_id INTEGER NOT NULL REFERENCES source_revisions(id) ON DELETE RESTRICT,
    manifest_digest TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_revision_inputs_set_revision
    ON plan_revision_inputs (input_set_id, source_revision_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plan_revision_inputs_tenant_set
    ON plan_revision_inputs (tenant_id, input_set_id)`,
];

export class PostgresDatabase {
  private pool: pg.Pool | null = null;
  drizzle: PostgresDrizzleDb | null = null;
  readonly dataDir: string;
  readonly reposDir: string;
  readonly sourcesDir: string;

  constructor(
    readonly databaseUrl: string,
    dataDir: string,
  ) {
    this.dataDir = dataDir;
    this.reposDir = join(dataDir, "repos");
    this.sourcesDir = join(dataDir, "sources");
  }

  async connect(): Promise<void> {
    this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 10 });
    this.drizzle = drizzle(this.pool, { schema });
    registerPostgresSyncQuery(this.drizzle, (query) =>
      runPostgresSyncQuery(this.databaseUrl, query),
    );
    await this.runMigrations();
  }

  private async runMigrations(): Promise<void> {
    if (!this.pool) throw new Error("Database not connected");
    const sql = readFileSync(MIGRATION_SQL, "utf8");
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await this.pool.query(stmt);
    }
    for (const stmt of postgresPostInitMigrations) {
      await this.pool.query(stmt);
    }
    // Stamp the version LAST: if any DDL above throws, the recorded schema
    // version must not claim a migration level the database never reached.
    await this.pool.query(
      `INSERT INTO app_settings (tenant_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      ["default", schemaVersionKey, String(currentSchemaVersion)],
    );
  }

  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    await this.pool.query("SELECT 1");
    return true;
  }

  async close(): Promise<void> {
    if (this.drizzle) unregisterPostgresSyncQuery(this.drizzle);
    await this.pool?.end();
    this.pool = null;
    this.drizzle = null;
  }
}

export function getPgDb(db: PostgresDatabase): PostgresDrizzleDb {
  if (!db.drizzle) throw new Error("Database not connected");
  return db.drizzle;
}

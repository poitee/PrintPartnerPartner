import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "./schema-pg.js";
import { currentSchemaVersion, schemaVersionKey } from "./schema-pg.js";

export type PostgresDrizzleDb = NodePgDatabase<typeof schema>;

const MIGRATION_SQL = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle/postgres/0000_init.sql",
);

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
    await this.runMigrations();
  }

  private async runMigrations(): Promise<void> {
    if (!this.pool) throw new Error("Database not connected");
    const sql = readFileSync(MIGRATION_SQL, "utf8");
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await this.pool.query(stmt);
    }
    await this.pool.query("ALTER TABLE parts ADD COLUMN IF NOT EXISTS spoolman_spool_id TEXT");
    await this.pool.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS tag TEXT");
    await this.pool.query(
      "ALTER TABLE build_profiles ADD COLUMN IF NOT EXISTS config_modified_at TEXT",
    );
    await this.pool.query(
      "ALTER TABLE build_profiles ADD COLUMN IF NOT EXISTS last_recomputed_at TEXT",
    );
    await this.pool.query(
      `INSERT INTO app_settings (tenant_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      ["default", schemaVersionKey, String(currentSchemaVersion)],
    );
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT,
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TEXT NOT NULL
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS auth_identities (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL
      )`);
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identity_provider
      ON auth_identities (provider, provider_user_id)`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS plan_shares (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        from_user_id TEXT NOT NULL REFERENCES users(id),
        plan_id INTEGER NOT NULL,
        plan_name TEXT NOT NULL,
        recipient_email TEXT,
        bundle_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS source_docs (
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
      )`);
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_source_docs_project_path
      ON source_docs (project_id, path)`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS source_notes (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        profile_id INTEGER REFERENCES build_profiles(id) ON DELETE SET NULL,
        title TEXT NOT NULL DEFAULT '',
        body_markdown TEXT NOT NULL DEFAULT '',
        author_user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS plan_decisions (
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
      )`);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_plan_decisions_profile
      ON plan_decisions (profile_id, created_at)`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS plan_snapshots (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        profile_id INTEGER NOT NULL REFERENCES build_profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        payload_json TEXT NOT NULL DEFAULT '{}'
      )`);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_plan_snapshots_profile
      ON plan_snapshots (profile_id, created_at)`);
  }

  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    await this.pool.query("SELECT 1");
    return true;
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
    this.drizzle = null;
  }
}

export function getPgDb(db: PostgresDatabase): PostgresDrizzleDb {
  if (!db.drizzle) throw new Error("Database not connected");
  return db.drizzle;
}

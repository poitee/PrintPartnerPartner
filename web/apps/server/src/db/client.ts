import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as schema from "./schema.js";
import { currentSchemaVersion, schemaMigrations, schemaVersionKey } from "./schema.js";

export type DrizzleDb = BetterSQLite3Database<typeof schema>;

export class SqliteDatabase {
  private sqlite: Database.Database | null = null;
  readonly dbPath: string;
  readonly dataDir: string;
  readonly reposDir: string;
  readonly sourcesDir: string;

  drizzle: DrizzleDb | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.dbPath = join(dataDir, "print-partner.db");
    this.reposDir = join(dataDir, "repos");
    this.sourcesDir = join(dataDir, "sources");
  }

  connect(): void {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    mkdirSync(this.reposDir, { recursive: true });
    mkdirSync(this.sourcesDir, { recursive: true });
    mkdirSync(join(this.dataDir, "exports"), { recursive: true });
    mkdirSync(join(this.dataDir, "thumbs"), { recursive: true });
    mkdirSync(join(this.dataDir, "covers"), { recursive: true });

    this.sqlite = new Database(this.dbPath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.drizzle = drizzle(this.sqlite, { schema });
    this.runMigrations();
  }

  private runMigrations(): void {
    if (!this.sqlite) throw new Error("Database not connected");
    for (const stmt of schemaMigrations) {
      this.sqlite.exec(stmt);
    }
    const partCols = this.sqlite.pragma("table_info(parts)") as { name: string }[];
    if (!partCols.some((c) => c.name === "spoolman_spool_id")) {
      this.sqlite.exec("ALTER TABLE parts ADD COLUMN spoolman_spool_id TEXT");
    }
    const projectCols = this.sqlite.pragma("table_info(projects)") as { name: string }[];
    if (!projectCols.some((c) => c.name === "tag")) {
      this.sqlite.exec("ALTER TABLE projects ADD COLUMN tag TEXT");
    }
    const profileCols = this.sqlite.pragma("table_info(build_profiles)") as { name: string }[];
    if (!profileCols.some((c) => c.name === "config_modified_at")) {
      this.sqlite.exec("ALTER TABLE build_profiles ADD COLUMN config_modified_at TEXT");
    }
    if (!profileCols.some((c) => c.name === "last_recomputed_at")) {
      this.sqlite.exec("ALTER TABLE build_profiles ADD COLUMN last_recomputed_at TEXT");
    }
    if (!profileCols.some((c) => c.name === "archived_at")) {
      this.sqlite.exec("ALTER TABLE build_profiles ADD COLUMN archived_at TEXT");
    }
    if (!profileCols.some((c) => c.name === "last_used_at")) {
      this.sqlite.exec("ALTER TABLE build_profiles ADD COLUMN last_used_at TEXT");
    }
    if (!profileCols.some((c) => c.name === "special_request")) {
      this.sqlite.exec("ALTER TABLE build_profiles ADD COLUMN special_request TEXT");
    }
    const row = this.sqlite
      .prepare("SELECT value FROM app_settings WHERE tenant_id = ? AND key = ?")
      .get("default", schemaVersionKey) as { value?: string } | undefined;
    const version = row?.value ? Number(row.value) : 0;
    if (version < currentSchemaVersion) {
      this.sqlite
        .prepare(
          `INSERT INTO app_settings (tenant_id, key, value) VALUES (?, ?, ?)
           ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value`,
        )
        .run("default", schemaVersionKey, String(currentSchemaVersion));
    }
  }

  ping(): boolean {
    if (!this.sqlite) return false;
    this.sqlite.prepare("SELECT 1").get();
    return true;
  }

  close(): void {
    this.sqlite?.close();
    this.sqlite = null;
    this.drizzle = null;
  }

  /**
   * Backups the database file by reading it directly.
   * Use this when the database is open to get a consistent snapshot.
   */
  backupFileContent(): Buffer {
    if (!this.sqlite) throw new Error("Database not connected");
    return readFileSync(this.dbPath);
  }

  /**
   * Backups the database WAL file if it exists.
   */
  backupWalFileContent(): Buffer | null {
    try {
      return readFileSync(this.dbPath + "-wal");
    } catch {
      return null;
    }
  }
}

export function getDb(db: SqliteDatabase): DrizzleDb {
  if (!db.drizzle) throw new Error("Database not connected");
  return db.drizzle;
}

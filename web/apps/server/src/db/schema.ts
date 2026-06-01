import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const DEFAULT_TENANT_ID = "default";

export const projects = sqliteTable(
  "projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    name: text("name").notNull(),
    url: text("url").notNull(),
    sourceType: text("source_type").notNull().default("git"),
    branch: text("branch").notNull().default("main"),
    localPath: text("local_path"),
    lastSyncedAt: text("last_synced_at"),
    lastCommitSha: text("last_commit_sha"),
    docsUrl: text("docs_url"),
    importedPaths: text("imported_paths"),
    manifestCommunitySlug: text("manifest_community_slug"),
    sourceKind: text("source_kind").notNull().default("github"),
    role: text("role").notNull().default("unassigned"),
    metadataJson: text("metadata_json"),
  },
  (t) => [uniqueIndex("uq_projects_tenant_name").on(t.tenantId, t.name)],
);

export const buildProfiles = sqliteTable(
  "build_profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    name: text("name").notNull(),
    orderNumber: text("order_number"),
  },
  (t) => [uniqueIndex("uq_profiles_tenant_name").on(t.tenantId, t.name)],
);

export const profileLayers = sqliteTable("profile_layers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  profileId: integer("profile_id")
    .notNull()
    .references(() => buildProfiles.id, { onDelete: "cascade" }),
  layerOrder: integer("layer_order").notNull().default(0),
  layerType: text("layer_type").notNull(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
});

export const parts = sqliteTable("parts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  profileId: integer("profile_id")
    .notNull()
    .references(() => buildProfiles.id, { onDelete: "cascade" }),
  matchKey: text("match_key").notNull(),
  relativePath: text("relative_path").notNull().default(""),
  filename: text("filename").notNull().default(""),
  sourceLayer: text("source_layer").notNull().default(""),
  status: text("status").notNull().default("base"),
  role: text("role").notNull().default("primary"),
  filamentColorId: text("filament_color_id"),
  filamentCustomHex: text("filament_custom_hex"),
  spoolmanSpoolId: text("spoolman_spool_id"),
  quantityAuto: integer("quantity_auto").notNull().default(1),
  quantityOverride: integer("quantity_override"),
  quantityEffective: integer("quantity_effective").notNull().default(1),
  included: integer("included", { mode: "boolean" }).notNull().default(true),
  notes: text("notes").notNull().default(""),
  githubBlobUrl: text("github_blob_url"),
  geometrySame: integer("geometry_same", { mode: "boolean" }),
  requirement: text("requirement"),
  optionGroupId: text("option_group_id"),
  manifestSource: text("manifest_source"),
});

export const printProgress = sqliteTable(
  "print_progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    partId: integer("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    unitIndex: integer("unit_index").notNull().default(0),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("uq_print_progress_part_unit").on(t.partId, t.unitIndex),
  ],
);

export const appSettings = sqliteTable(
  "app_settings",
  {
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    key: text("key").notNull(),
    value: text("value").notNull().default(""),
  },
  (t) => [uniqueIndex("uq_app_settings_tenant_key").on(t.tenantId, t.key)],
);

export const schemaVersionKey = "schema_version";
export const currentSchemaVersion = 2;

export const schemaMigrations: string[] = [
  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'git',
    branch TEXT NOT NULL DEFAULT 'main',
    local_path TEXT,
    last_synced_at TEXT,
    last_commit_sha TEXT,
    docs_url TEXT,
    imported_paths TEXT,
    manifest_community_slug TEXT,
    source_kind TEXT NOT NULL DEFAULT 'github',
    role TEXT NOT NULL DEFAULT 'unassigned',
    metadata_json TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_tenant_name ON projects (tenant_id, name)`,
  `CREATE TABLE IF NOT EXISTS build_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    order_number TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_tenant_name ON build_profiles (tenant_id, name)`,
  `CREATE TABLE IF NOT EXISTS profile_layers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    profile_id INTEGER NOT NULL REFERENCES build_profiles(id) ON DELETE CASCADE,
    layer_order INTEGER NOT NULL DEFAULT 0,
    layer_type TEXT NOT NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    profile_id INTEGER NOT NULL REFERENCES build_profiles(id) ON DELETE CASCADE,
    match_key TEXT NOT NULL,
    relative_path TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL DEFAULT '',
    source_layer TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'base',
    role TEXT NOT NULL DEFAULT 'primary',
    filament_color_id TEXT,
    filament_custom_hex TEXT,
    quantity_auto INTEGER NOT NULL DEFAULT 1,
    quantity_override INTEGER,
    quantity_effective INTEGER NOT NULL DEFAULT 1,
    included INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    github_blob_url TEXT,
    geometry_same INTEGER,
    requirement TEXT,
    option_group_id TEXT,
    manifest_source TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS print_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    unit_index INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_print_progress_part_unit ON print_progress (part_id, unit_index)`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    tenant_id TEXT NOT NULL DEFAULT 'default',
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_tenant_key ON app_settings (tenant_id, key)`,
];

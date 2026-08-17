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
    tag: text("tag"),
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
    /** Quiet operator note shown on Plan + Progress. */
    specialRequest: text("special_request"),
    configModifiedAt: text("config_modified_at"),
    lastRecomputedAt: text("last_recomputed_at"),
    /** ISO timestamp when plan was archived as a reusable template; null = active. */
    archivedAt: text("archived_at"),
    /** ISO timestamp of last spine selection (picker / activate). */
    lastUsedAt: text("last_used_at"),
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
    /** Assembly tracking: true when a completed printed part has been physically installed. */
    assembled: integer("assembled", { mode: "boolean" }).notNull().default(false),
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

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const authIdentities = sqliteTable(
  "auth_identities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
  },
  (t) => [uniqueIndex("uq_auth_identity_provider").on(t.provider, t.providerUserId)],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
});

export const planShares = sqliteTable("plan_shares", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  fromUserId: text("from_user_id")
    .notNull()
    .references(() => users.id),
  planId: integer("plan_id").notNull(),
  planName: text("plan_name").notNull(),
  recipientEmail: text("recipient_email"),
  bundleJson: text("bundle_json").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
});

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Synced markdown/PDF docs under a source repo tree. */
export const sourceDocs = sqliteTable(
  "source_docs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    kind: text("kind").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    contentHash: text("content_hash"),
    extractStatus: text("extract_status").notNull().default("pending"),
    extractError: text("extract_error"),
    pageCount: integer("page_count"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("uq_source_docs_project_path").on(t.projectId, t.path)],
);

/** User-contributed markdown notes for a source (optionally plan-scoped). */
export const sourceNotes = sqliteTable("source_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  profileId: integer("profile_id").references(() => buildProfiles.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull().default(""),
  bodyMarkdown: text("body_markdown").notNull().default(""),
  authorUserId: text("author_user_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Durable per-plan assistant/user decision trail (Apply / Dismiss / notes). */
export const planDecisions = sqliteTable("plan_decisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  profileId: integer("profile_id")
    .notNull()
    .references(() => buildProfiles.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  actor: text("actor").notNull().default("assistant"),
  kind: text("kind").notNull(),
  actionType: text("action_type"),
  paramsJson: text("params_json").notNull().default("{}"),
  label: text("label").notNull().default(""),
  summary: text("summary").notNull().default(""),
  rationale: text("rationale"),
  resultJson: text("result_json"),
});

/** Point-in-time plan configuration snapshots (layers + kit + refs). */
export const planSnapshots = sqliteTable("plan_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  profileId: integer("profile_id")
    .notNull()
    .references(() => buildProfiles.id, { onDelete: "cascade" }),
  name: text("name").notNull().default(""),
  createdAt: text("created_at").notNull(),
  source: text("source").notNull().default("user"),
  payloadJson: text("payload_json").notNull().default("{}"),
});

/** Slicer printer profiles imported from Bambu / OrcaSlicer / PrusaSlicer. */
export const printerProfiles = sqliteTable(
  "printer_profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    name: text("name").notNull(),
    slicerFormat: text("slicer_format").notNull(),
    slicerVersionAtImport: text("slicer_version_at_import"),
    /** Polygon as JSON array of [x,y] pairs. */
    printableArea: text("printable_area"),
    printableHeightMm: text("printable_height_mm"),
    /** JSON array of exclusion polygons. */
    bedExcludeArea: text("bed_exclude_area"),
    nozzleDiameterMm: text("nozzle_diameter_mm"),
    extruderCount: integer("extruder_count").notNull().default(1),
    /** Verbatim source JSON (Bambu/Orca). */
    rawJson: text("raw_json"),
    /** Verbatim source INI (Prusa). */
    rawIni: text("raw_ini"),
    /** Merged, inheritance-resolved flat config as JSON. */
    resolvedFlatConfig: text("resolved_flat_config"),
    importedAt: text("imported_at").notNull(),
    /** Absolute path inside the container of the slicer-written source file (profile-sync watcher only). */
    sourcePath: text("source_path"),
    /** Slicer version string read from the slicer's own config at sync time, e.g. "2.3.2.60". */
    syncedFromSlicerVersion: text("synced_from_slicer_version"),
    /** ISO timestamp of the most recent profile-sync watcher upsert for this row. */
    lastSyncedAt: text("last_synced_at"),
  },
  (t) => [uniqueIndex("uq_printer_profiles_tenant_name").on(t.tenantId, t.name)],
);

/** Slicer process/print-settings profiles imported from slicers. */
export const processProfiles = sqliteTable(
  "process_profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    name: text("name").notNull(),
    slicerFormat: text("slicer_format").notNull(),
    /** JSON array of printer profile names this process is compatible with. */
    compatiblePrinters: text("compatible_printers"),
    /** Merged, inheritance-resolved flat config as JSON. */
    resolvedFlatConfig: text("resolved_flat_config"),
    importedAt: text("imported_at").notNull(),
    sourcePath: text("source_path"),
    syncedFromSlicerVersion: text("synced_from_slicer_version"),
    lastSyncedAt: text("last_synced_at"),
  },
  (t) => [uniqueIndex("uq_process_profiles_tenant_name").on(t.tenantId, t.name)],
);

/** Slicer filament profiles imported from slicers. */
export const filamentProfiles = sqliteTable(
  "filament_profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    name: text("name").notNull(),
    materialType: text("material_type").notNull(),
    /** 1=generic 2=brand 3=certified 4=optimal — aligns with PP material_tier scale. */
    materialTier: integer("material_tier").notNull().default(1),
    nozzleTempC: integer("nozzle_temp_c"),
    bedTempC: integer("bed_temp_c"),
    fanPct: integer("fan_pct"),
    extrusionMultiplier: text("extrusion_multiplier"),
    pressureAdvance: text("pressure_advance"),
    retraction: text("retraction"),
    /** Verbatim source JSON. */
    rawJson: text("raw_json"),
    /** Verbatim source INI. */
    rawIni: text("raw_ini"),
    /** Merged, inheritance-resolved flat config as JSON. */
    resolvedFlatConfig: text("resolved_flat_config"),
    importedAt: text("imported_at").notNull(),
    sourcePath: text("source_path"),
    syncedFromSlicerVersion: text("synced_from_slicer_version"),
    lastSyncedAt: text("last_synced_at"),
  },
  (t) => [uniqueIndex("uq_filament_profiles_tenant_name").on(t.tenantId, t.name)],
);

/** Global persistent mapping from slicer printer name to PP fleet printer id. */
export const printerNameMap = sqliteTable(
  "printer_name_map",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Exact printer name string as it appears in the slicer profile. */
    slicerName: text("slicer_name").notNull(),
    /** PP fleet printer id. */
    ppFleetId: text("pp_fleet_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("uq_printer_name_map_slicer_name").on(t.slicerName)],
);

export const printerProfileAssignments = sqliteTable("printer_profile_assignments", {
  printerId: text("printer_id").primaryKey(),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  machineProfileId: integer("machine_profile_id"),
  profileSource: text("profile_source").notNull().default("auto_match"),
  updatedAt: text("updated_at").notNull(),
});

export const printerFilamentSlotAssignments = sqliteTable(
  "printer_filament_slot_assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    printerId: text("printer_id").notNull(),
    slotIndex: integer("slot_index").notNull(),
    filamentProfileId: integer("filament_profile_id"),
  },
  (t) => [
    uniqueIndex("uq_printer_filament_slot").on(t.tenantId, t.printerId, t.slotIndex),
  ],
);

/** One print job container (keyed by checkoff link when available). */
export const printJobs = sqliteTable("print_jobs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  profileId: integer("profile_id")
    .notNull()
    .references(() => buildProfiles.id, { onDelete: "cascade" }),
  hostIntegrationId: text("host_integration_id"),
  /** PP fleet printer id (from checkoff link or send queue). */
  printerId: text("printer_id").notNull().default(""),
  /** Filament colour/material label (filament_color_id or filament_display). */
  material: text("material").notNull().default(""),
  filename: text("filename"),
  /** sent | completed | failed */
  status: text("status").notNull().default("sent"),
  /** Estimated filament consumed in grams (from telemetry or slicer metadata). */
  filamentConsumedG: integer("filament_consumed_g"),
  at: text("at").notNull(),
  completedAt: text("completed_at"),
  linkId: text("link_id"),
});

/** One outcome row per part/unit within a print job (replaces printer.print_outcomes blob). */
export const printJobParts = sqliteTable("print_job_parts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  jobId: text("job_id").references(() => printJobs.id, { onDelete: "set null" }),
  at: text("at").notNull(),
  profileId: integer("profile_id").notNull(),
  partId: integer("part_id").notNull(),
  unitIndex: integer("unit_index").notNull().default(0),
  result: text("result").notNull(),
  reason: text("reason"),
  note: text("note"),
  hostIntegrationId: text("host_integration_id"),
  filename: text("filename"),
  matchKey: text("match_key"),
  role: text("role"),
  filamentDisplay: text("filament_display"),
  linkId: text("link_id"),
});

/** Printer health / telemetry events (for Prometheus metrics and the stats page). */
export const printerTelemetry = sqliteTable("printer_telemetry", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  at: text("at").notNull(),
  printerId: text("printer_id"),
  hostIntegrationId: text("host_integration_id"),
  eventType: text("event_type").notNull(),
  payloadJson: text("payload_json"),
});

/** General application event log (Discord daily digest, analytics). */
export const appEvents = sqliteTable("app_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  at: text("at").notNull(),
  kind: text("kind").notNull(),
  actorType: text("actor_type"),
  actorId: text("actor_id"),
  payloadJson: text("payload_json"),
});

export const schemaVersionKey = "schema_version";
export const currentSchemaVersion = 14;

export const schemaMigrations: string[] = [
  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'git',
    branch TEXT NOT NULL DEFAULT 'main',
    tag TEXT,
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
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identity_provider ON auth_identities (provider, provider_user_id)`,
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_source_docs_project_path ON source_docs (project_id, path)`,
  `CREATE TABLE IF NOT EXISTS source_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  `CREATE INDEX IF NOT EXISTS idx_plan_decisions_profile ON plan_decisions (profile_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS plan_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    profile_id INTEGER NOT NULL REFERENCES build_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    payload_json TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plan_snapshots_profile ON plan_snapshots (profile_id, created_at)`,
  // v9 — slicer profile tables
  `CREATE TABLE IF NOT EXISTS printer_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_printer_profiles_tenant_name ON printer_profiles (tenant_id, name)`,
  `CREATE TABLE IF NOT EXISTS process_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    slicer_format TEXT NOT NULL,
    compatible_printers TEXT,
    resolved_flat_config TEXT,
    imported_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_process_profiles_tenant_name ON process_profiles (tenant_id, name)`,
  `CREATE TABLE IF NOT EXISTS filament_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_filament_profiles_tenant_name ON filament_profiles (tenant_id, name)`,
  `CREATE TABLE IF NOT EXISTS printer_name_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slicer_name TEXT NOT NULL,
    pp_fleet_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_printer_name_map_slicer_name ON printer_name_map (slicer_name)`,
  // v10 — assembly tracking column on print_progress.
  // NOTE: intentionally NOT an unconditional ALTER TABLE here (that fails with
  // "duplicate column name" on every restart once applied once). The guarded
  // add-if-missing logic for this column lives in db/client.ts runMigrations(),
  // alongside the other conditional column migrations.
  // v11 — print_jobs, print_job_parts, printer_telemetry, app_events
  `CREATE TABLE IF NOT EXISTS print_jobs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    profile_id INTEGER NOT NULL REFERENCES build_profiles(id) ON DELETE CASCADE,
    host_integration_id TEXT,
    filename TEXT,
    at TEXT NOT NULL,
    link_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_profile ON print_jobs (tenant_id, profile_id, at)`,
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
  `CREATE INDEX IF NOT EXISTS idx_print_job_parts_profile ON print_job_parts (profile_id, at)`,
  `CREATE TABLE IF NOT EXISTS printer_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    at TEXT NOT NULL,
    printer_id TEXT,
    host_integration_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_printer_telemetry_at ON printer_telemetry (tenant_id, at)`,
  `CREATE TABLE IF NOT EXISTS app_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    actor_type TEXT,
    actor_id TEXT,
    payload_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_events_kind_at ON app_events (tenant_id, kind, at)`,
  // v12 — add printer_id / material / status / filament_consumed_g / completed_at to print_jobs
  `ALTER TABLE print_jobs ADD COLUMN printer_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE print_jobs ADD COLUMN material TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE print_jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'`,
  `ALTER TABLE print_jobs ADD COLUMN filament_consumed_g INTEGER`,
  `ALTER TABLE print_jobs ADD COLUMN completed_at TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_status ON print_jobs (tenant_id, status)`,
  // v13 — profile-sync provenance columns on the three slicer profile tables.
  // Populated by the chokidar-based profile-sync watcher (services/profile-sync.ts)
  // when a profile file changes on disk in the shared slicer config volumes.
  // NULL on rows that were manually imported or PP-native starters (never synced).
  `ALTER TABLE printer_profiles ADD COLUMN source_path TEXT`,
  `ALTER TABLE printer_profiles ADD COLUMN synced_from_slicer_version TEXT`,
  `ALTER TABLE printer_profiles ADD COLUMN last_synced_at TEXT`,
  `ALTER TABLE process_profiles ADD COLUMN source_path TEXT`,
  `ALTER TABLE process_profiles ADD COLUMN synced_from_slicer_version TEXT`,
  `ALTER TABLE process_profiles ADD COLUMN last_synced_at TEXT`,
  `ALTER TABLE filament_profiles ADD COLUMN source_path TEXT`,
  `ALTER TABLE filament_profiles ADD COLUMN synced_from_slicer_version TEXT`,
  `ALTER TABLE filament_profiles ADD COLUMN last_synced_at TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_printer_profiles_source_path ON printer_profiles (source_path)`,
  `CREATE INDEX IF NOT EXISTS idx_process_profiles_source_path ON process_profiles (source_path)`,
  `CREATE INDEX IF NOT EXISTS idx_filament_profiles_source_path ON filament_profiles (source_path)`,
  `CREATE INDEX IF NOT EXISTS idx_print_jobs_printer ON print_jobs (tenant_id, printer_id)`,
  // v14 — per-printer machine profile and per-slot filament assignments.
  `CREATE TABLE IF NOT EXISTS printer_profile_assignments (
    printer_id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    machine_profile_id INTEGER,
    profile_source TEXT NOT NULL DEFAULT 'auto_match',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS printer_filament_slot_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    printer_id TEXT NOT NULL,
    slot_index INTEGER NOT NULL,
    filament_profile_id INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_printer_filament_slot
    ON printer_filament_slot_assignments (tenant_id, printer_id, slot_index)`,
];

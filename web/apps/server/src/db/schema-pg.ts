import {
  type AnyPgColumn,
  boolean,
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const DEFAULT_TENANT_ID = "default";

export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
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
    currentSourceRevisionId: integer("current_source_revision_id").references(
      (): AnyPgColumn => sourceRevisions.id,
      { onDelete: "restrict" },
    ),
  },
  (t) => [uniqueIndex("uq_projects_tenant_name").on(t.tenantId, t.name)],
);

export const buildProfiles = pgTable(
  "build_profiles",
  {
    id: serial("id").primaryKey(),
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

export const profileLayers = pgTable("profile_layers", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  profileId: integer("profile_id")
    .notNull()
    .references(() => buildProfiles.id, { onDelete: "cascade" }),
  layerOrder: integer("layer_order").notNull().default(0),
  layerType: text("layer_type").notNull(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
});

export const sourceRevisions = pgTable(
  "source_revisions",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    upstreamRevisionKey: text("upstream_revision_key").notNull(),
    manifestDigest: text("manifest_digest").notNull(),
    snapshotLocator: text("snapshot_locator").notNull(),
    syncedAt: text("synced_at").notNull(),
    completeness: text("completeness").notNull().default("complete"),
  },
  (t) => [
    uniqueIndex("uq_source_revisions_tenant_source_upstream").on(
      t.tenantId,
      t.projectId,
      t.upstreamRevisionKey,
    ),
  ],
);

export const planRevisionInputSets = pgTable(
  "plan_revision_input_sets",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    profileId: integer("profile_id")
      .notNull()
      .references(() => buildProfiles.id, { onDelete: "cascade" }),
    inputSetDigest: text("input_set_digest").notNull(),
    expectedInputCount: integer("expected_input_count").notNull(),
    recordedAt: text("recorded_at").notNull(),
    publishedAt: text("published_at"),
  },
  (t) => [
    uniqueIndex("uq_plan_revision_input_sets_tenant_plan_digest").on(
      t.tenantId,
      t.profileId,
      t.inputSetDigest,
    ),
  ],
);

export const planRevisionInputs = pgTable(
  "plan_revision_inputs",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    inputSetId: integer("input_set_id")
      .notNull()
      .references(() => planRevisionInputSets.id, { onDelete: "cascade" }),
    sourceRevisionId: integer("source_revision_id")
      .notNull()
      .references(() => sourceRevisions.id, { onDelete: "restrict" }),
    manifestDigest: text("manifest_digest").notNull(),
  },
  (t) => [
    uniqueIndex("uq_plan_revision_inputs_set_revision").on(
      t.inputSetId,
      t.sourceRevisionId,
    ),
  ],
);

export const parts = pgTable("parts", {
  id: serial("id").primaryKey(),
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
  included: boolean("included").notNull().default(true),
  notes: text("notes").notNull().default(""),
  githubBlobUrl: text("github_blob_url"),
  geometrySame: boolean("geometry_same"),
  requirement: text("requirement"),
  optionGroupId: text("option_group_id"),
  manifestSource: text("manifest_source"),
});

export const printProgress = pgTable(
  "print_progress",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    partId: integer("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    unitIndex: integer("unit_index").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    assembled: boolean("assembled").notNull().default(false),
  },
  (t) => [uniqueIndex("uq_print_progress_part_unit").on(t.partId, t.unitIndex)],
);

export const appSettings = pgTable(
  "app_settings",
  {
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    key: text("key").notNull(),
    value: text("value").notNull().default(""),
  },
  (t) => [uniqueIndex("uq_app_settings_tenant_key").on(t.tenantId, t.key)],
);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
  },
  (t) => [uniqueIndex("uq_auth_identity_provider").on(t.provider, t.providerUserId)],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
});

export const planShares = pgTable("plan_shares", {
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

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Synced markdown/PDF docs under a source repo tree. */
export const sourceDocs = pgTable(
  "source_docs",
  {
    id: serial("id").primaryKey(),
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
export const sourceNotes = pgTable("source_notes", {
  id: serial("id").primaryKey(),
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
export const planDecisions = pgTable("plan_decisions", {
  id: serial("id").primaryKey(),
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
export const planSnapshots = pgTable("plan_snapshots", {
  id: serial("id").primaryKey(),
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
export const printerProfiles = pgTable(
  "printer_profiles",
  {
    id: serial("id").primaryKey(),
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
export const processProfiles = pgTable(
  "process_profiles",
  {
    id: serial("id").primaryKey(),
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
export const filamentProfiles = pgTable(
  "filament_profiles",
  {
    id: serial("id").primaryKey(),
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
export const printerNameMap = pgTable(
  "printer_name_map",
  {
    id: serial("id").primaryKey(),
    /** Exact printer name string as it appears in the slicer profile. */
    slicerName: text("slicer_name").notNull(),
    /** PP fleet printer id. */
    ppFleetId: text("pp_fleet_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("uq_printer_name_map_slicer_name").on(t.slicerName)],
);

export const printerProfileAssignments = pgTable("printer_profile_assignments", {
  printerId: text("printer_id").primaryKey(),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  machineProfileId: integer("machine_profile_id"),
  profileSource: text("profile_source").notNull().default("auto_match"),
  updatedAt: text("updated_at").notNull(),
});

export const printerFilamentSlotAssignments = pgTable(
  "printer_filament_slot_assignments",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    printerId: text("printer_id").notNull(),
    slotIndex: integer("slot_index").notNull(),
    filamentProfileId: integer("filament_profile_id"),
  },
  (t) => [
    uniqueIndex("uq_printer_filament_slot").on(t.tenantId, t.printerId, t.slotIndex),
  ],
);

/** Registered slicer GUI / sync targets (Slicer Hub). Docker fields reserved for Plan 3. */
export const slicerInstances = pgTable("slicer_instances", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  dialect: text("dialect").notNull(),
  guiUrl: text("gui_url").notNull().default(""),
  watchPath: text("watch_path").notNull().default(""),
  dockerTarget: text("docker_target").notNull().default("local"),
  dockerHost: text("docker_host"),
  composeService: text("compose_service"),
  image: text("image"),
  containerName: text("container_name"),
  portsJson: text("ports_json").notNull().default("[]"),
  volumesJson: text("volumes_json").notNull().default("[]"),
  envJson: text("env_json").notNull().default("{}"),
  statusCache: text("status_cache").notNull().default("unknown"),
  statusMessage: text("status_message"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** One print job container (keyed by checkoff link when available). */
export const printJobs = pgTable("print_jobs", {
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
export const printJobParts = pgTable("print_job_parts", {
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
export const printerTelemetry = pgTable("printer_telemetry", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  at: text("at").notNull(),
  printerId: text("printer_id"),
  hostIntegrationId: text("host_integration_id"),
  eventType: text("event_type").notNull(),
  payloadJson: text("payload_json"),
});

/** General application event log (Discord daily digest, analytics). */
export const appEvents = pgTable("app_events", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
  at: text("at").notNull(),
  kind: text("kind").notNull(),
  actorType: text("actor_type"),
  actorId: text("actor_id"),
  payloadJson: text("payload_json"),
});

export const schemaVersionKey = "schema_version";
export const currentSchemaVersion = 17;

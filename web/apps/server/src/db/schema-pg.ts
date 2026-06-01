import {
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

export const buildProfiles = pgTable(
  "build_profiles",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    name: text("name").notNull(),
    orderNumber: text("order_number"),
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

export const schemaVersionKey = "schema_version";
export const currentSchemaVersion = 2;

import {
  DEFAULT_NAMING_PROFILE,
  importRulesForProject,
  mergeLayers,
  MergeWouldWipeProfileError,
  parseSourceNamingMetadata,
  resolveNamingProfile,
  scanRepo,
  serializeImportRules,
  STL_NAMING_DEFAULTS_KEY,
  progressSummary,
  isFullyPrinted,
  filterPrintChecklistRows,
  toggleCheckoffUnit,
  ensureProgressRows,
  getPrintUnits,
  type MergePart,
  type ProgressRow,
  type StlNamingProfileDict,
  validateNamingProfile,
  parseProjectMetadata,
  resolveSourceCategory,
  SOURCE_CATEGORIES_KEY,
  loadSourceCategories,
  normalizeSourceCategories,
} from "@print-partner/domain";
import { inArray } from "drizzle-orm";
import { applyManifestToProfile } from "../services/manifest-apply.js";
import { loadKitManifest, saveKitManifest, type KitManifestRecord } from "../services/kit-manifest-store.js";
import { resolvePartStl } from "../services/part-paths.js";
import { getColorById, resolvePartFilamentHex } from "../services/filament-catalog.js";
import { REMOTE_CHECKED_AT_KEY, REMOTE_UPDATE_STATUS_KEY } from "../services/source-update-check.js";
import type { PartRow, ProfileSummary, SourceSummary } from "@print-partner/contracts";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { join } from "node:path";
import type { DrizzleDb } from "./client.js";
import { asSyncDb, type AppDrizzleDb } from "./sync-db-bridge.js";
import { getRequestTenantId } from "../middleware/tenant-context.js";
import * as defaultSchema from "./schema.js";
import { DEFAULT_TENANT_ID } from "./schema.js";

export type SchemaTables = Pick<
  typeof defaultSchema,
  "appSettings" | "buildProfiles" | "parts" | "printProgress" | "profileLayers" | "projects"
>;

export type ProjectRow = typeof defaultSchema.projects.$inferSelect;
export type ProfileRow = typeof defaultSchema.buildProfiles.$inferSelect;
export type LayerRow = typeof defaultSchema.profileLayers.$inferSelect;
export type PartDbRow = typeof defaultSchema.parts.$inferSelect;

function readSourceUpdateFields(metadata: Record<string, unknown> | null): {
  update_status: "up_to_date" | "updates_available" | "unknown" | null;
  update_checked_at: string | null;
} {
  const data = metadata ?? {};
  const status = data[REMOTE_UPDATE_STATUS_KEY];
  const valid: "up_to_date" | "updates_available" | "unknown" | null =
    status === "up_to_date" || status === "updates_available" || status === "unknown"
      ? status
      : null;
  const checked = data[REMOTE_CHECKED_AT_KEY];
  return {
    update_status: valid,
    update_checked_at: typeof checked === "string" ? checked : null,
  };
}

function sourceSummary(row: ProjectRow): SourceSummary {
  const metadata = parseProjectMetadata(row.metadataJson);
  const { useDefaults } = parseSourceNamingMetadata(metadata);
  const { update_status, update_checked_at } = readSourceUpdateFields(metadata);
  const sourceKind =
    row.sourceKind || (row.sourceType === "local" ? "local" : "github");
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    source_kind: sourceKind,
    source_type: row.sourceType ?? "git",
    role: row.role ?? "unassigned",
    category: resolveSourceCategory(row.metadataJson, row.role),
    branch: row.branch ?? "main",
    local_path: row.localPath,
    last_synced_at: row.lastSyncedAt,
    last_commit_sha: row.lastCommitSha,
    docs_url: row.docsUrl,
    manifest_community_slug: row.manifestCommunitySlug,
    metadata,
    naming_use_defaults: useDefaults,
    update_status,
    update_checked_at,
  };
}

function partRow(row: PartDbRow): PartRow {
  return {
    id: row.id,
    match_key: row.matchKey,
    relative_path: row.relativePath,
    filename: row.filename,
    source_layer: row.sourceLayer,
    status: row.status,
    role: row.role,
    requirement: row.requirement,
    option_group_id: row.optionGroupId,
    included: row.included,
    filament_color_id: row.filamentColorId,
    filament_custom_hex: row.filamentCustomHex,
    filament_display: "",
    filament_hex: row.filamentCustomHex,
    quantity_auto: row.quantityAuto,
    quantity_override: row.quantityOverride,
    quantity_effective: row.quantityEffective,
  };
}

export class AppRepository {
  readonly reposDir: string;

  private readonly schema: SchemaTables;

  constructor(
    db: AppDrizzleDb,
    private readonly defaultTenantId = DEFAULT_TENANT_ID,
    reposDir: string,
    schema: SchemaTables = defaultSchema,
  ) {
    this.db = asSyncDb(db);
    this.schema = schema;
    this.reposDir = reposDir;
  }

  private readonly db: DrizzleDb;

  private get tenantId(): string {
    return getRequestTenantId(this.defaultTenantId);
  }

  async ping(): Promise<boolean> {
    const db = this.db as DrizzleDb & {
      execute?: (query: ReturnType<typeof sql>) => { run: () => void };
    };
    if (typeof db.run === "function") {
      db.run(sql`SELECT 1`);
    } else if (typeof db.execute === "function") {
      db.execute(sql`SELECT 1`).run();
    } else {
      throw new Error("Database driver does not support ping");
    }
    return true;
  }

  getSetting(key: string, defaultValue: string | null = null): string | null {
    const row = this.db
      .select()
      .from(this.schema.appSettings)
      .where(and(eq(this.schema.appSettings.tenantId, this.tenantId), eq(this.schema.appSettings.key, key)))
      .all()[0];
    if (!row?.value) return defaultValue;
    return row.value;
  }

  setSetting(key: string, value: string): void {
    this.db
      .insert(this.schema.appSettings)
      .values({ tenantId: this.tenantId, key, value })
      .onConflictDoUpdate({
        target: [this.schema.appSettings.tenantId, this.schema.appSettings.key],
        set: { value },
      })
      .run();
  }

  getGlobalNaming(): StlNamingProfileDict {
    const raw = this.getSetting(STL_NAMING_DEFAULTS_KEY);
    if (!raw) return structuredClone(DEFAULT_NAMING_PROFILE);
    try {
      return validateNamingProfile(JSON.parse(raw));
    } catch {
      return structuredClone(DEFAULT_NAMING_PROFILE);
    }
  }

  saveGlobalNaming(profile: StlNamingProfileDict): StlNamingProfileDict {
    const normalized = validateNamingProfile(profile);
    this.setSetting(STL_NAMING_DEFAULTS_KEY, JSON.stringify(normalized));
    return normalized;
  }

  getSourceCategories(): string[] {
    return loadSourceCategories(this.getSetting(SOURCE_CATEGORIES_KEY));
  }

  saveSourceCategories(categories: string[]): string[] {
    const normalized = normalizeSourceCategories(categories);
    this.setSetting(SOURCE_CATEGORIES_KEY, JSON.stringify(normalized));
    return normalized;
  }

  listSources(): SourceSummary[] {
    const rows = this.db
      .select()
      .from(this.schema.projects)
      .where(eq(this.schema.projects.tenantId, this.tenantId))
      .orderBy(asc(this.schema.projects.name))
      .all();
    return rows.map(sourceSummary);
  }

  getSource(id: number): SourceSummary | null {
    const row = this.db
      .select()
      .from(this.schema.projects)
      .where(and(eq(this.schema.projects.tenantId, this.tenantId), eq(this.schema.projects.id, id)))
      .get();
    return row ? sourceSummary(row) : null;
  }

  getPartRow(id: number): PartDbRow | null {
    return (
      this.db
        .select()
        .from(this.schema.parts)
        .where(and(eq(this.schema.parts.tenantId, this.tenantId), eq(this.schema.parts.id, id)))
        .get() ?? null
    );
  }

  getProjectRow(id: number): ProjectRow | null {
    return (
      this.db
        .select()
        .from(this.schema.projects)
        .where(and(eq(this.schema.projects.tenantId, this.tenantId), eq(this.schema.projects.id, id)))
        .get() ?? null
    );
  }

  createSource(input: {
    name: string;
    url?: string;
    branch?: string;
    source_kind?: string;
    source_type?: string;
    role?: string;
    local_path?: string;
    metadata?: Record<string, unknown>;
  }): SourceSummary {
    const name = input.name.trim();
    if (!name) throw new Error("Source name is required");
    const sourceKind = (input.source_kind ?? "github").toLowerCase();
    const sourceType =
      input.source_type ?? (sourceKind === "local" ? "local" : "git");
    const existing = this.db
      .select()
      .from(this.schema.projects)
      .where(and(eq(this.schema.projects.tenantId, this.tenantId), eq(this.schema.projects.name, name)))
      .get();
    if (existing) throw new Error(`Source already exists: ${name}`);

    const localPath =
      input.local_path ??
      (sourceKind === "local" ? join(this.reposDir, "pending") : null);

    const inserted = this.db
      .insert(this.schema.projects)
      .values({
        tenantId: this.tenantId,
        name,
        url: input.url ?? "",
        branch: input.branch ?? "main",
        sourceKind,
        sourceType,
        role: input.role ?? "unassigned",
        localPath,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      })
      .returning()
      .get();

    if (!inserted) throw new Error("Failed to create source");

    const repoPath = join(this.reposDir, String(inserted.id));
    if (!inserted.localPath || inserted.localPath.includes("pending")) {
      this.db
        .update(this.schema.projects)
        .set({ localPath: repoPath })
        .where(eq(this.schema.projects.id, inserted.id))
        .run();
      inserted.localPath = repoPath;
    }

    return sourceSummary(inserted);
  }

  updateSource(
    id: number,
    patch: Partial<{
      name: string;
      url: string;
      branch: string;
      source_kind: string;
      source_type: string;
      role: string;
      local_path: string;
      metadata: Record<string, unknown>;
      last_synced_at: string | null;
      last_commit_sha: string | null;
      localPath: string;
    }>,
  ): SourceSummary {
    const row = this.getProjectRow(id);
    if (!row) throw new Error("Source not found");

    const updates: Partial<typeof this.schema.projects.$inferInsert> = {};
    if (patch.name != null) updates.name = patch.name.trim();
    if (patch.url != null) updates.url = patch.url;
    if (patch.branch != null) updates.branch = patch.branch;
    if (patch.source_kind != null) updates.sourceKind = patch.source_kind;
    if (patch.source_type != null) updates.sourceType = patch.source_type;
    if (patch.role != null) updates.role = patch.role;
    if (patch.local_path != null) updates.localPath = patch.local_path;
    if (patch.localPath != null) updates.localPath = patch.localPath;
    if (patch.last_synced_at !== undefined) updates.lastSyncedAt = patch.last_synced_at;
    if (patch.last_commit_sha !== undefined) updates.lastCommitSha = patch.last_commit_sha;
    if (patch.metadata != null) {
      const base = parseProjectMetadata(row.metadataJson) ?? {};
      updates.metadataJson = JSON.stringify({ ...base, ...patch.metadata });
    }

    this.db.update(this.schema.projects).set(updates).where(eq(this.schema.projects.id, id)).run();
    return this.getSource(id)!;
  }

  deleteSource(id: number): void {
    this.db
      .delete(this.schema.projects)
      .where(and(eq(this.schema.projects.tenantId, this.tenantId), eq(this.schema.projects.id, id)))
      .run();
  }

  listProfiles(): ProfileSummary[] {
    const rows = this.db
      .select({
        profile: this.schema.buildProfiles,
        partCount: count(this.schema.parts.id),
      })
      .from(this.schema.buildProfiles)
      .leftJoin(
        this.schema.parts,
        eq(this.schema.parts.profileId, this.schema.buildProfiles.id),
      )
      .where(eq(this.schema.buildProfiles.tenantId, this.tenantId))
      .groupBy(this.schema.buildProfiles.id)
      .orderBy(asc(this.schema.buildProfiles.name))
      .all();

    return rows.map(({ profile, partCount }) => ({
      id: profile.id,
      name: profile.name,
      order_number: profile.orderNumber,
      part_count: Number(partCount ?? 0),
    }));
  }

  getProfile(id: number): ProfileSummary | null {
    const profile = this.db
      .select()
      .from(this.schema.buildProfiles)
      .where(and(eq(this.schema.buildProfiles.tenantId, this.tenantId), eq(this.schema.buildProfiles.id, id)))
      .get();
    if (!profile) return null;
    const partCount = this.db
      .select({ c: count() })
      .from(this.schema.parts)
      .where(eq(this.schema.parts.profileId, id))
      .get();
    return {
      id: profile.id,
      name: profile.name,
      order_number: profile.orderNumber,
      part_count: Number(partCount?.c ?? 0),
    };
  }

  createProfile(name: string, baseProjectId?: number): ProfileSummary & {
    layers: Array<{
      id: number;
      layer_order: number;
      layer_type: string;
      project_id: number | null;
      project_name: string | null;
    }>;
  } {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Profile name is required");
    const dup = this.db
      .select()
      .from(this.schema.buildProfiles)
      .where(and(eq(this.schema.buildProfiles.tenantId, this.tenantId), eq(this.schema.buildProfiles.name, trimmed)))
      .get();
    if (dup) throw new Error(`Profile already exists: ${trimmed}`);

    const profile = this.db
      .insert(this.schema.buildProfiles)
      .values({ tenantId: this.tenantId, name: trimmed })
      .returning()
      .get();
    if (!profile) throw new Error("Failed to create profile");

    if (baseProjectId != null) {
      this.setBaseLayer(profile.id, baseProjectId);
    }

    return {
      ...this.getProfile(profile.id)!,
      layers: this.getProfileLayers(profile.id),
    };
  }

  deleteProfile(id: number): void {
    this.db
      .delete(this.schema.buildProfiles)
      .where(and(eq(this.schema.buildProfiles.tenantId, this.tenantId), eq(this.schema.buildProfiles.id, id)))
      .run();
  }

  renameProfile(id: number, name: string): ProfileSummary {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Profile name is required");
    const dup = this.db
      .select()
      .from(this.schema.buildProfiles)
      .where(
        and(
          eq(this.schema.buildProfiles.tenantId, this.tenantId),
          eq(this.schema.buildProfiles.name, trimmed),
        ),
      )
      .get();
    if (dup && dup.id !== id) throw new Error(`Profile already exists: ${trimmed}`);
    this.db
      .update(this.schema.buildProfiles)
      .set({ name: trimmed })
      .where(
        and(eq(this.schema.buildProfiles.tenantId, this.tenantId), eq(this.schema.buildProfiles.id, id)),
      )
      .run();
    const profile = this.getProfile(id);
    if (!profile) throw new Error("Profile not found");
    return profile;
  }

  duplicateProfile(id: number, newName: string): ProfileSummary & { layers: ReturnType<AppRepository["getProfileLayers"]> } {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error("Profile name is required");
    const dup = this.db
      .select()
      .from(this.schema.buildProfiles)
      .where(
        and(
          eq(this.schema.buildProfiles.tenantId, this.tenantId),
          eq(this.schema.buildProfiles.name, trimmed),
        ),
      )
      .get();
    if (dup) throw new Error(`Profile already exists: ${trimmed}`);
    const source = this.db
      .select()
      .from(this.schema.buildProfiles)
      .where(
        and(eq(this.schema.buildProfiles.tenantId, this.tenantId), eq(this.schema.buildProfiles.id, id)),
      )
      .get();
    if (!source) throw new Error("Profile not found");

    const newProfile = this.db
      .insert(this.schema.buildProfiles)
      .values({ tenantId: this.tenantId, name: trimmed, orderNumber: source.orderNumber })
      .returning()
      .get();
    if (!newProfile) throw new Error("Failed to duplicate profile");

    const layers = this.db
      .select()
      .from(this.schema.profileLayers)
      .where(eq(this.schema.profileLayers.profileId, id))
      .all();
    for (const layer of layers) {
      this.db
        .insert(this.schema.profileLayers)
        .values({
          tenantId: this.tenantId,
          profileId: newProfile.id,
          layerOrder: layer.layerOrder,
          layerType: layer.layerType,
          projectId: layer.projectId,
        })
        .run();
    }

    const oldParts = this.db
      .select()
      .from(this.schema.parts)
      .where(eq(this.schema.parts.profileId, id))
      .all();
    const oldToNew = new Map<number, number>();
    for (const old of oldParts) {
      const inserted = this.db
        .insert(this.schema.parts)
        .values({
          tenantId: this.tenantId,
          profileId: newProfile.id,
          matchKey: old.matchKey,
          relativePath: old.relativePath,
          filename: old.filename,
          sourceLayer: old.sourceLayer,
          status: old.status,
          role: old.role,
          filamentColorId: old.filamentColorId,
          filamentCustomHex: old.filamentCustomHex,
          quantityAuto: old.quantityAuto,
          quantityOverride: old.quantityOverride,
          quantityEffective: old.quantityEffective,
          included: old.included,
          notes: old.notes,
          githubBlobUrl: old.githubBlobUrl,
          geometrySame: old.geometrySame,
          requirement: old.requirement,
          optionGroupId: old.optionGroupId,
          manifestSource: old.manifestSource,
        })
        .returning()
        .get();
      if (inserted) oldToNew.set(old.id, inserted.id);
    }

    for (const [oldId, newId] of oldToNew) {
      const progress = this.db
        .select()
        .from(this.schema.printProgress)
        .where(eq(this.schema.printProgress.partId, oldId))
        .all();
      for (const row of progress) {
        this.db
          .insert(this.schema.printProgress)
          .values({
            tenantId: this.tenantId,
            partId: newId,
            unitIndex: row.unitIndex,
            completed: row.completed,
          })
          .run();
      }
    }

    return {
      ...this.getProfile(newProfile.id)!,
      layers: this.getProfileLayers(newProfile.id),
    };
  }

  removeLayer(layerId: number): void {
    const layer = this.db
      .select()
      .from(this.schema.profileLayers)
      .where(
        and(
          eq(this.schema.profileLayers.tenantId, this.tenantId),
          eq(this.schema.profileLayers.id, layerId),
        ),
      )
      .get();
    if (!layer) throw new Error("Layer not found");
    this.db
      .delete(this.schema.profileLayers)
      .where(eq(this.schema.profileLayers.id, layerId))
      .run();
  }

  replaceLayer(layerId: number, projectId: number): void {
    const layer = this.db
      .select()
      .from(this.schema.profileLayers)
      .where(
        and(
          eq(this.schema.profileLayers.tenantId, this.tenantId),
          eq(this.schema.profileLayers.id, layerId),
        ),
      )
      .get();
    if (!layer) throw new Error("Layer not found");
    const project = this.getProjectRow(projectId);
    if (!project) throw new Error("Project not found");
    this.db
      .update(this.schema.profileLayers)
      .set({ projectId })
      .where(eq(this.schema.profileLayers.id, layerId))
      .run();
  }

  getProfileLayers(profileId: number) {
    const layers = this.db
      .select()
      .from(this.schema.profileLayers)
      .where(eq(this.schema.profileLayers.profileId, profileId))
      .orderBy(asc(this.schema.profileLayers.layerOrder))
      .all();

    return layers.map((layer) => {
      let projectName: string | null = null;
      if (layer.projectId) {
        const proj = this.getProjectRow(layer.projectId);
        projectName = proj?.name ?? null;
      }
      return {
        id: layer.id,
        layer_order: layer.layerOrder,
        layer_type: layer.layerType,
        project_id: layer.projectId,
        project_name: projectName,
      };
    });
  }

  setBaseLayer(profileId: number, projectId: number): void {
    const project = this.getProjectRow(projectId);
    if (!project) throw new Error("Project not found");
    const existing = this.db
      .select()
      .from(this.schema.profileLayers)
      .where(and(eq(this.schema.profileLayers.profileId, profileId), eq(this.schema.profileLayers.layerType, "base")))
      .get();
    if (existing) {
      this.db
        .update(this.schema.profileLayers)
        .set({ projectId, layerOrder: 0 })
        .where(eq(this.schema.profileLayers.id, existing.id))
        .run();
    } else {
      this.db
        .insert(this.schema.profileLayers)
        .values({
          tenantId: this.tenantId,
          profileId,
          layerOrder: 0,
          layerType: "base",
          projectId,
        })
        .run();
    }
  }

  addAddonLayer(profileId: number, projectId: number): void {
    const project = this.getProjectRow(projectId);
    if (!project) throw new Error("Project not found");
    const maxOrder = this.db
      .select({ m: sql<number>`coalesce(max(${this.schema.profileLayers.layerOrder}), -1)` })
      .from(this.schema.profileLayers)
      .where(eq(this.schema.profileLayers.profileId, profileId))
      .get();
    this.db
      .insert(this.schema.profileLayers)
      .values({
        tenantId: this.tenantId,
        profileId,
        layerOrder: Number(maxOrder?.m ?? -1) + 1,
        layerType: "addon",
        projectId,
      })
      .run();
  }

  listParts(profileId: number, limit = 10000, offset = 0): {
    parts: PartRow[];
    total: number;
  } {
    const total = this.db
      .select({ c: count() })
      .from(this.schema.parts)
      .where(eq(this.schema.parts.profileId, profileId))
      .get();
    const rows = this.db
      .select()
      .from(this.schema.parts)
      .where(eq(this.schema.parts.profileId, profileId))
      .orderBy(asc(this.schema.parts.filename))
      .limit(limit)
      .offset(offset)
      .all();
    return { parts: rows.map(partRow), total: Number(total?.c ?? 0) };
  }

  private rowToMergePart(row: PartDbRow): MergePart {
    return {
      matchKey: row.matchKey,
      relativePath: row.relativePath,
      filename: row.filename,
      sourceLayer: row.sourceLayer,
      status: row.status,
      role: row.role,
      quantityAuto: row.quantityAuto,
      partSlug: row.filename,
      included: row.included,
      quantityOverride: row.quantityOverride,
      notes: row.notes ?? "",
      geometrySame: row.geometrySame,
      absolutePath: null,
    };
  }

  recomputeProfile(
    profileId: number,
    options?: { apply_manifest?: boolean },
  ): {
    merged: boolean;
    part_count?: number;
    reason?: string;
    message?: string;
    layer_debug: Array<Record<string, unknown>>;
    manifest_applied?: number;
    manifest_warnings?: Array<Record<string, unknown>>;
  } {
    const layers = this.db
      .select()
      .from(this.schema.profileLayers)
      .where(eq(this.schema.profileLayers.profileId, profileId))
      .orderBy(asc(this.schema.profileLayers.layerOrder))
      .all();

    const existingRows = this.db
      .select()
      .from(this.schema.parts)
      .where(eq(this.schema.parts.profileId, profileId))
      .all();
    const existing: Record<string, MergePart> = {};
    for (const row of existingRows) {
      existing[row.matchKey] = this.rowToMergePart(row);
    }

    const layerScans: Array<[string, ReturnType<typeof scanRepo>]> = [];
    const layerDebug: Array<Record<string, unknown>> = [];
    const globalNaming = this.getGlobalNaming();

    for (const layer of layers) {
      if (!layer.projectId) {
        layerDebug.push({ layer_type: layer.layerType, project_id: null, skipped: "no_project" });
        continue;
      }
      const proj = this.getProjectRow(layer.projectId);
      if (!proj?.localPath) {
        layerDebug.push({
          layer_type: layer.layerType,
          project_id: layer.projectId,
          skipped: "no_local_path",
        });
        continue;
      }
      const label = `${layer.layerType}:${proj.name}`;
      const rules = importRulesForProject(proj.importedPaths);
      const metadata = parseProjectMetadata(proj.metadataJson);
      const namingProfile = resolveNamingProfile(globalNaming, metadata);
      const scanned = scanRepo(proj.localPath, label, rules, namingProfile);
      layerScans.push([label, scanned]);
      layerDebug.push({
        label,
        local_path: proj.localPath,
        stl_count: scanned.length,
        scan_cached: false,
      });
    }

    if (!layerScans.length) {
      return { merged: false, reason: "no_layers", layer_debug: layerDebug };
    }

    const totalScanned = layerScans.reduce((n, [, s]) => n + s.length, 0);
    if (totalScanned === 0) {
      return {
        merged: false,
        reason: "no_stls",
        message:
          "No STL files matched import rules for any layer. Use Import files… on each source.",
        layer_debug: layerDebug,
      };
    }

    try {
      const result = mergeLayers(layerScans, existing, { geometryCompare: false });
      if (!result.parts.length && existingRows.length) {
        throw new MergeWouldWipeProfileError("Scan found no STL files.");
      }

      const newKeys = new Set(result.parts.map((p) => p.matchKey));
      for (const row of existingRows) {
        if (!newKeys.has(row.matchKey)) {
          this.db.delete(this.schema.printProgress).where(eq(this.schema.printProgress.partId, row.id)).run();
          this.db.delete(this.schema.parts).where(eq(this.schema.parts.id, row.id)).run();
        }
      }

      for (const mp of result.parts) {
        const prior = existingRows.find((r) => r.matchKey === mp.matchKey);
        const qty =
          mp.quantityOverride != null ? mp.quantityOverride : mp.quantityAuto;
        if (prior) {
          this.db
            .update(this.schema.parts)
            .set({
              relativePath: mp.relativePath,
              filename: mp.filename,
              sourceLayer: mp.sourceLayer,
              status: mp.status,
              quantityAuto: mp.quantityAuto,
              quantityEffective: qty,
              quantityOverride: mp.quantityOverride,
              included: mp.included,
              notes: mp.notes,
              geometrySame: mp.geometrySame,
              role: mp.role,
              filamentColorId: prior.filamentColorId,
              filamentCustomHex: prior.filamentCustomHex,
            })
            .where(eq(this.schema.parts.id, prior.id))
            .run();
        } else {
          this.db
            .insert(this.schema.parts)
            .values({
              tenantId: this.tenantId,
              profileId,
              matchKey: mp.matchKey,
              relativePath: mp.relativePath,
              filename: mp.filename,
              sourceLayer: mp.sourceLayer,
              status: mp.status,
              role: mp.role,
              quantityAuto: mp.quantityAuto,
              quantityOverride: mp.quantityOverride,
              quantityEffective: qty,
              included: mp.included,
              notes: mp.notes,
              geometrySame: mp.geometrySame,
            })
            .run();
        }
      }

      const out: {
        merged: boolean;
        part_count: number;
        layer_debug: Array<Record<string, unknown>>;
        manifest_applied?: number;
        manifest_warnings?: Array<Record<string, unknown>>;
      } = {
        merged: true,
        part_count: result.parts.length,
        layer_debug: layerDebug,
      };
      if (options?.apply_manifest) {
        const manifestResult = applyManifestToProfile(this, profileId, true);
        out.manifest_applied = manifestResult.applied_rules;
        out.manifest_warnings = manifestResult.warnings;
      }
      return out;
    } catch (e) {
      if (e instanceof MergeWouldWipeProfileError) {
        return {
          merged: false,
          reason: "would_wipe",
          message: e.message,
          layer_debug: layerDebug,
        };
      }
      throw e;
    }
  }

  markSourceSynced(id: number, commitSha: string | null): void {
    this.db
      .update(this.schema.projects)
      .set({
        lastSyncedAt: new Date().toISOString(),
        lastCommitSha: commitSha,
      })
      .where(eq(this.schema.projects.id, id))
      .run();
  }

  updateImportRules(id: number, rules: string[]): { rules: string[] } {
    const row = this.getProjectRow(id);
    if (!row) throw new Error("Source not found");
    const serialized = serializeImportRules(rules);
    this.db.update(this.schema.projects).set({ importedPaths: serialized }).where(eq(this.schema.projects.id, id)).run();
    const normalized = importRulesForProject(serialized) ?? [];
    return { rules: normalized };
  }

  listProjectIds(ids?: number[]): number[] {
    if (ids?.length) return ids;
    return this.db
      .select({ id: this.schema.projects.id })
      .from(this.schema.projects)
      .where(eq(this.schema.projects.tenantId, this.tenantId))
      .all()
      .map((r) => r.id);
  }

  getPartsGrouped(profileId: number, query = "") {
    const { parts: allParts } = this.listParts(profileId, 10000, 0);
    const q = query.trim().toLowerCase();
    const filtered = q
      ? allParts.filter(
          (p) =>
            p.filename.toLowerCase().includes(q) ||
            p.relative_path.toLowerCase().includes(q),
        )
      : allParts;

    const groups = new Map<string, PartRow[]>();
    for (const part of filtered) {
      const folder = part.relative_path.includes("/")
        ? part.relative_path.split("/").slice(0, -1).join("/")
        : "";
      const list = groups.get(folder) ?? [];
      list.push(part);
      groups.set(folder, list);
    }

    return {
      groups: [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([folder, partsList]) => ({ folder, parts: partsList })),
      total: filtered.length,
    };
  }

  private listPartRows(profileId: number): PartDbRow[] {
    return this.db
      .select()
      .from(this.schema.parts)
      .where(eq(this.schema.parts.profileId, profileId))
      .orderBy(asc(this.schema.parts.filename))
      .all();
  }

  private progressRowsForPart(partId: number): ProgressRow[] {
    return this.db
      .select()
      .from(this.schema.printProgress)
      .where(eq(this.schema.printProgress.partId, partId))
      .all()
      .map((r) => ({
        id: r.id,
        partId: r.partId,
        unitIndex: r.unitIndex,
        completed: r.completed,
      }));
  }

  private saveProgressRows(partId: number, rows: ProgressRow[]): void {
    this.db.delete(this.schema.printProgress).where(eq(this.schema.printProgress.partId, partId)).run();
    for (const row of rows) {
      this.db
        .insert(this.schema.printProgress)
        .values({
          tenantId: this.tenantId,
          partId,
          unitIndex: row.unitIndex,
          completed: row.completed,
        })
        .run();
    }
  }

  ensureProgressForPart(part: PartDbRow): void {
    const rows = this.progressRowsForPart(part.id);
    const qty = Math.max(1, part.quantityEffective);
    const ensured = ensureProgressRows(rows, part.id, qty);
    this.saveProgressRows(part.id, ensured);
  }

  printUnitsByPartId(profileId: number): Map<number, boolean[]> {
    const partRows = this.listPartRows(profileId);
    const partIds = partRows.map((p) => p.id);
    if (!partIds.length) return new Map();

    const allProgress = this.db
      .select()
      .from(this.schema.printProgress)
      .where(inArray(this.schema.printProgress.partId, partIds))
      .all();

    const byPart = new Map<number, ProgressRow[]>();
    for (const r of allProgress) {
      const list = byPart.get(r.partId) ?? [];
      list.push({
        id: r.id,
        partId: r.partId,
        unitIndex: r.unitIndex,
        completed: r.completed,
      });
      byPart.set(r.partId, list);
    }

    const out = new Map<number, boolean[]>();
    for (const part of partRows) {
      const qty = Math.max(1, part.quantityEffective);
      out.set(part.id, getPrintUnits(byPart.get(part.id) ?? [], qty));
    }
    return out;
  }

  getCheckoff(profileId: number) {
    const partRows = this.listPartRows(profileId);
    for (const part of partRows) {
      this.ensureProgressForPart(part);
    }
    const unitsById = this.printUnitsByPartId(profileId);
    const displayRows = partRows.map((p) => {
      const units = unitsById.get(p.id) ?? [];
      const printedCount = units.filter(Boolean).length;
      const color = p.filamentColorId ? getColorById(p.filamentColorId) : null;
      const hex = resolvePartFilamentHex(p);
      return {
        id: p.id,
        filename: p.filename,
        match_key: p.matchKey,
        relative_path: p.relativePath,
        source_layer: p.sourceLayer,
        role: p.role,
        quantity_effective: p.quantityEffective,
        printed_count: printedCount,
        print_units: units,
        missing: printedCount < Math.max(1, p.quantityEffective),
        filament_display: color?.combo_label ?? "",
        filament_hex: hex,
        included: p.included,
      };
    });
    const checklist = filterPrintChecklistRows(displayRows);
    return {
      profile_id: profileId,
      summary: progressSummary(checklist),
      parts: checklist.map(({ included: _, ...row }) => row),
    };
  }

  patchPartProgress(partId: number, unitIndex: number, completed: boolean) {
    const part = this.db.select().from(this.schema.parts).where(eq(this.schema.parts.id, partId)).get();
    if (!part) throw new Error("Part not found");
    const qty = Math.max(1, part.quantityEffective);
    if (unitIndex >= qty) throw new Error("unit_index out of range");
    this.ensureProgressForPart(part);
    const rows = this.progressRowsForPart(partId);
    const updated = toggleCheckoffUnit(rows, partId, qty, unitIndex, completed);
    this.saveProgressRows(partId, updated.filter((r) => r.partId === partId));
    const units = getPrintUnits(updated.filter((r) => r.partId === partId), qty);
    const printedCount = units.filter(Boolean).length;
    return {
      part_id: partId,
      printed_count: printedCount,
      print_units: units,
      missing: !isFullyPrinted({ quantity_effective: qty, printed_count: printedCount }),
    };
  }

  patchPart(
    partId: number,
    patch: {
      included?: boolean;
      filament_color_id?: string | null;
      quantity_override?: number;
      requirement?: string | null;
      option_group_id?: string | null;
      manifest_source?: string | null;
    },
  ): PartRow {
    const part = this.db.select().from(this.schema.parts).where(eq(this.schema.parts.id, partId)).get();
    if (!part) throw new Error("Part not found");
    const updates: Partial<typeof this.schema.parts.$inferInsert> = {};
    if (patch.included != null) updates.included = patch.included;
    if (patch.filament_color_id !== undefined) {
      updates.filamentColorId = patch.filament_color_id;
    }
    if (patch.quantity_override != null) {
      updates.quantityOverride = patch.quantity_override;
      updates.quantityEffective = patch.quantity_override;
      this.ensureProgressForPart({ ...part, quantityEffective: patch.quantity_override });
    }
    if (patch.requirement !== undefined) updates.requirement = patch.requirement;
    if (patch.option_group_id !== undefined) updates.optionGroupId = patch.option_group_id;
    if (patch.manifest_source !== undefined) updates.manifestSource = patch.manifest_source;
    if (Object.keys(updates).length) {
      this.db.update(this.schema.parts).set(updates).where(eq(this.schema.parts.id, partId)).run();
    }
    const updated = this.db.select().from(this.schema.parts).where(eq(this.schema.parts.id, partId)).get()!;
    const row = partRow(updated);
    const color = updated.filamentColorId ? getColorById(updated.filamentColorId) : null;
    row.filament_display = color?.combo_label ?? "";
    row.filament_hex = resolvePartFilamentHex(updated);
    return row;
  }

  buildMergePartsForProfile(profileId: number): {
    name: string;
    orderNumber: string | null;
    parts: MergePart[];
    completedByMatchKey: Record<string, boolean[]>;
  } {
    const profile = this.db.select().from(this.schema.buildProfiles).where(eq(this.schema.buildProfiles.id, profileId)).get();
    if (!profile) throw new Error("Profile not found");
    const partRows = this.listPartRows(profileId);
    const unitsById = this.printUnitsByPartId(profileId);
    const mergeParts: MergePart[] = [];
    const completedByMatchKey: Record<string, boolean[]> = {};

    for (const row of partRows) {
      const color = row.filamentColorId ? getColorById(row.filamentColorId) : null;
      const mp: MergePart & {
        quantityEffective?: number;
        filamentDisplay?: string;
        filamentHex?: string | null;
      } = {
        matchKey: row.matchKey,
        relativePath: row.relativePath,
        filename: row.filename,
        sourceLayer: row.sourceLayer,
        status: row.status,
        role: row.role,
        quantityAuto: row.quantityAuto,
        quantityOverride: row.quantityOverride,
        partSlug: row.filename,
        included: row.included,
        notes: row.notes ?? "",
        geometrySame: row.geometrySame,
        absolutePath: resolvePartStl(this, row),
        quantityEffective: row.quantityEffective,
        filamentDisplay: color?.combo_label ?? "",
        filamentHex: resolvePartFilamentHex(row),
      };
      mergeParts.push(mp);
      completedByMatchKey[row.matchKey] = unitsById.get(row.id) ?? [];
    }
    return {
      name: profile.name,
      orderNumber: profile.orderNumber,
      parts: mergeParts,
      completedByMatchKey,
    };
  }

  getRoleFilaments(profileId: number) {
    const partRows = this.listPartRows(profileId);
    const order = DEFAULT_NAMING_PROFILE.export_role_order as string[];
    const buckets = new Map<
      string,
      {
        role: string;
        part_count: number;
        filament_color_id: string | null;
        filament_custom_hex: string | null;
        filament_display: string;
        filament_hex: string | null;
        colorCounts: Map<string, number>;
      }
    >();

    for (const part of partRows) {
      if (!part.included) continue;
      const role = (part.role || "primary").trim() || "primary";
      let row = buckets.get(role);
      if (!row) {
        row = {
          role,
          part_count: 0,
          filament_color_id: null,
          filament_custom_hex: null,
          filament_display: "",
          filament_hex: null,
          colorCounts: new Map(),
        };
        buckets.set(role, row);
      }
      row.part_count += 1;
      if (part.filamentColorId) {
        row.colorCounts.set(part.filamentColorId, (row.colorCounts.get(part.filamentColorId) ?? 0) + 1);
      }
      const color = part.filamentColorId ? getColorById(part.filamentColorId) : null;
      if (color?.combo_label && !row.filament_display) row.filament_display = color.combo_label;
      const hex = resolvePartFilamentHex(part);
      if (hex && !row.filament_hex) row.filament_hex = hex;
    }

    const roleSort = (role: string) => {
      const idx = order.indexOf(role);
      return idx >= 0 ? idx : order.length;
    };

    return [...buckets.values()]
      .sort((a, b) => roleSort(a.role) - roleSort(b.role) || a.role.localeCompare(b.role))
      .map((row) => {
        let colorId: string | null = null;
        if (row.colorCounts.size) {
          colorId = [...row.colorCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        }
        return {
          role: row.role,
          part_count: row.part_count,
          filament_color_id: colorId,
          filament_custom_hex: row.filament_custom_hex,
          filament_display: row.filament_display,
          filament_hex: row.filament_hex ?? (colorId ? getColorById(colorId)?.hex ?? null : null),
        };
      });
  }

  bulkSetRoleFilament(
    profileId: number,
    role: string,
    colorId: string | null,
    customHex?: string | null,
  ): number {
    const partRows = this.listPartRows(profileId);
    let updated = 0;
    for (const part of partRows) {
      if (!part.included || part.role !== role) continue;
      this.db
        .update(this.schema.parts)
        .set({
          filamentColorId: colorId,
          filamentCustomHex: customHex ?? null,
        })
        .where(eq(this.schema.parts.id, part.id))
        .run();
      updated += 1;
    }
    return updated;
  }

  buildKitBundle(profileId: number, includePrintProgress: boolean) {
    const { name, orderNumber, completedByMatchKey } =
      this.buildMergePartsForProfile(profileId);
    const layers = this.getProfileLayers(profileId);
    const layersOut = layers.map((layer) => {
      const proj = layer.project_id ? this.getProjectRow(layer.project_id) : null;
      return {
        layer_order: layer.layer_order,
        layer_type: layer.layer_type,
        project: proj
          ? {
              name: proj.name,
              url: proj.url,
              branch: proj.branch ?? "main",
              source_type: proj.sourceType ?? "git",
            }
          : null,
      };
    });

    const partRows = this.listPartRows(profileId);
    const partsOut = partRows.map((p) => {
      const row: Record<string, unknown> = {
        match_key: p.matchKey,
        relative_path: p.relativePath,
        filename: p.filename,
        source_layer: p.sourceLayer,
        status: p.status,
        role: p.role,
        filament_color_id: p.filamentColorId,
        filament_custom_hex: p.filamentCustomHex,
        quantity_auto: p.quantityAuto,
        quantity_override: p.quantityOverride,
        quantity_effective: p.quantityEffective,
        included: p.included,
        notes: p.notes ?? "",
        geometry_same: p.geometrySame,
        requirement: p.requirement,
        option_group_id: p.optionGroupId,
        manifest_source: p.manifestSource,
      };
      if (includePrintProgress && completedByMatchKey[p.matchKey]) {
        row.print_units = completedByMatchKey[p.matchKey];
      }
      return row;
    });

    const sourcesOut: Array<Record<string, unknown>> = [];
    const seen = new Set<number>();
    for (const layer of layers) {
      if (!layer.project_id || seen.has(layer.project_id)) continue;
      seen.add(layer.project_id);
      const proj = this.getProjectRow(layer.project_id);
      if (!proj) continue;
      const rules = importRulesForProject(proj.importedPaths);
      sourcesOut.push({
        name: proj.name,
        url: proj.url,
        branch: proj.branch ?? "main",
        source_kind: proj.sourceKind ?? "github",
        category: resolveSourceCategory(proj.metadataJson, proj.role),
        import_rules: rules ?? [],
      });
    }

    const kitManifest = loadKitManifest(this, profileId);

    return {
      profile: { name, orderNumber },
      data: {
        format: "print-partner-kit",
        version: 3,
        exported_at: new Date().toISOString(),
        profile: { name, order_number: orderNumber },
        layers: layersOut,
        parts: partsOut,
        kit_manifest: kitManifest,
        ...(sourcesOut.length ? { sources: sourcesOut } : {}),
      },
    };
  }

  importKitBundle(
    data: Record<string, unknown>,
    newName?: string | null,
  ): {
    profile_id: number;
    profile_name: string;
    parts_imported: number;
    layers_imported: number;
    warnings: string[];
    unmatched_sources: Array<{
      name: string;
      url: string;
      branch: string;
      source_kind: string;
      role: string;
      import_rules: string[];
    }>;
  } {
    const profileData = (data.profile as Record<string, unknown>) ?? {};
    const desired = (newName || profileData.name || "Imported kit").toString().trim() || "Imported kit";
    let name = desired;
    for (let n = 0; n < 100; n++) {
      const candidate = n === 0 ? desired : `${desired} (${n + 1})`;
      const dup = this.db
        .select()
        .from(this.schema.buildProfiles)
        .where(and(eq(this.schema.buildProfiles.tenantId, this.tenantId), eq(this.schema.buildProfiles.name, candidate)))
        .get();
      if (!dup) {
        name = candidate;
        break;
      }
    }

    const profile = this.db
      .insert(this.schema.buildProfiles)
      .values({
        tenantId: this.tenantId,
        name,
        orderNumber: (profileData.order_number as string) ?? null,
      })
      .returning()
      .get();
    if (!profile) throw new Error("Failed to create profile");

    const warnings: string[] = [];
    const unmatched_sources: Array<{
      name: string;
      url: string;
      branch: string;
      source_kind: string;
      role: string;
      import_rules: string[];
    }> = [];
    let layersImported = 0;

    const allProjects = this.db
      .select()
      .from(this.schema.projects)
      .where(eq(this.schema.projects.tenantId, this.tenantId))
      .all();

    const resolveProjectId = (ref: Record<string, unknown> | null): number | null => {
      if (!ref) return null;
      const refName = String(ref.name ?? "").trim();
      const refUrl = String(ref.url ?? "").trim();
      for (const p of allProjects) {
        if (refName && p.name === refName) return p.id;
      }
      for (const p of allProjects) {
        if (refUrl && p.url === refUrl) return p.id;
      }
      return null;
    };

    const rulesFromSourceEntry = (entry: Record<string, unknown>): string[] => {
      const raw = entry.import_rules;
      if (!Array.isArray(raw)) return [];
      return raw.map((r) => String(r)).filter(Boolean);
    };

    for (const sourceEntry of (data.sources as Array<Record<string, unknown>>) ?? []) {
      const ref = {
        name: sourceEntry.name,
        url: sourceEntry.url,
      };
      const projectId = resolveProjectId(ref);
      const importRules = rulesFromSourceEntry(sourceEntry);
      if (projectId != null) {
        if (importRules.length > 0) {
          this.updateImportRules(projectId, importRules);
        }
        continue;
      }
      unmatched_sources.push({
        name: String(sourceEntry.name ?? ""),
        url: String(sourceEntry.url ?? ""),
        branch: String(sourceEntry.branch ?? "main"),
        source_kind: String(sourceEntry.source_kind ?? "github"),
        role: String(sourceEntry.category ?? sourceEntry.role ?? "unassigned"),
        import_rules: importRules,
      });
    }

    const kitManifestRaw = data.kit_manifest;
    if (kitManifestRaw && typeof kitManifestRaw === "object") {
      saveKitManifest(this, profile.id, kitManifestRaw as Partial<KitManifestRecord>);
    }

    for (const layerData of (data.layers as Array<Record<string, unknown>>) ?? []) {
      const ref = (layerData.project as Record<string, unknown>) ?? null;
      const projectId = resolveProjectId(ref);
      if (ref && projectId == null) {
        warnings.push(`Layer ${layerData.layer_type}: no local repo "${ref.name ?? ref.url}".`);
        continue;
      }
      this.db
        .insert(this.schema.profileLayers)
        .values({
          tenantId: this.tenantId,
          profileId: profile.id,
          layerOrder: Number(layerData.layer_order ?? layersImported),
          layerType: String(layerData.layer_type ?? "addon"),
          projectId,
        })
        .run();
      layersImported += 1;
    }

    let partsImported = 0;
    for (const partData of (data.parts as Array<Record<string, unknown>>) ?? []) {
      const inserted = this.db
        .insert(this.schema.parts)
        .values({
          tenantId: this.tenantId,
          profileId: profile.id,
          matchKey: String(partData.match_key ?? ""),
          relativePath: String(partData.relative_path ?? ""),
          filename: String(partData.filename ?? ""),
          sourceLayer: String(partData.source_layer ?? ""),
          status: String(partData.status ?? "base"),
          role: String(partData.role ?? "primary"),
          filamentColorId: (partData.filament_color_id as string) ?? null,
          filamentCustomHex: (partData.filament_custom_hex as string) ?? null,
          quantityAuto: Number(partData.quantity_auto ?? 1),
          quantityOverride: (partData.quantity_override as number) ?? null,
          quantityEffective: Number(partData.quantity_effective ?? partData.quantity_auto ?? 1),
          included: Boolean(partData.included ?? true),
          notes: String(partData.notes ?? ""),
          geometrySame: (partData.geometry_same as boolean) ?? null,
          requirement: (partData.requirement as string) ?? null,
          optionGroupId: (partData.option_group_id as string) ?? null,
          manifestSource: (partData.manifest_source as string) ?? null,
        })
        .returning()
        .get();
      if (inserted) {
        partsImported += 1;
        const units = partData.print_units as boolean[] | undefined;
        if (Array.isArray(units)) {
          const rows: ProgressRow[] = units.map((completed, unitIndex) => ({
            partId: inserted.id,
            unitIndex,
            completed: Boolean(completed),
          }));
          this.saveProgressRows(inserted.id, rows);
        }
      }
    }

    return {
      profile_id: profile.id,
      profile_name: name,
      parts_imported: partsImported,
      layers_imported: layersImported,
      warnings,
      unmatched_sources,
    };
  }
}

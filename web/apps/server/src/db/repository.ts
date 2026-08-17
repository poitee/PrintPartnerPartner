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
  getAssembledUnits,
  setAssembledUnit,
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
import {
  collectKitBundleSourceRefs,
  kitLayerProjectExportRecord,
  kitMatchedSourcePatch,
  kitSourceRefFromProject,
  kitSourceRefToExportRecord,
  kitUnmatchedSourceFromRef,
  type KitBundleUnmatchedSource,
} from "../services/kit-bundle-share.js";
import { resolvePartStl } from "../services/part-paths.js";
import { normalizePartRole } from "../services/role-filament.js";
import {
  canonicalRoleOrder,
  loadRoleFilamentDefaults,
  roleFilamentSettingKey,
  saveRoleFilamentDefault,
  type RoleFilamentDefault,
} from "../services/role-filament-store.js";
import { getColorById, resolvePartFilamentHex } from "../services/filament-catalog.js";
import type { FilamentResolveContext } from "../services/filament-resolve.js";
import { formatSpoolSummaryBadge } from "../integrations/spoolman-client.js";
import { REMOTE_CHECKED_AT_KEY, REMOTE_UPDATE_STATUS_KEY } from "../services/source-update-check.js";
import type { PartRow, ProfileSummary, SourceSummary, PlanDecision, PlanSnapshot, PlanSnapshotSummary, PlanSnapshotSource, PlanDecisionActor, PlanDecisionKind } from "@print-partner/contracts";
import { and, asc, count, desc, eq, gte, ne, sql } from "drizzle-orm";
import { join, resolve, sep, basename } from "node:path";
import type { DrizzleDb } from "./client.js";
import {
  asSyncDb,
  isSyncSqliteDrizzle,
  runSerializedSettingsMutation,
  type AppDrizzleDb,
} from "./sync-db-bridge.js";
import { getRequestTenantId } from "../middleware/tenant-context.js";
import type { ProfileSourceMode } from "../services/printer-profile-assignments.js";
import { stockPresets } from "../services/slicer-instances.js";
import * as defaultSchema from "./schema.js";
import { DEFAULT_TENANT_ID } from "./schema.js";

function docTitleFromPath(path: string): string {
  const base = basename(path);
  if (/^readme\.md$/i.test(base)) return "README";
  return base;
}

export type SchemaTables = Pick<
  typeof defaultSchema,
  | "appSettings"
  | "buildProfiles"
  | "parts"
  | "printProgress"
  | "profileLayers"
  | "projects"
  | "sourceDocs"
  | "sourceNotes"
  | "planDecisions"
  | "planSnapshots"
  | "printJobs"
  | "printJobParts"
  | "printerTelemetry"
  | "appEvents"
  | "printerProfiles"
  | "processProfiles"
  | "filamentProfiles"
  | "printerNameMap"
  | "printerProfileAssignments"
  | "printerFilamentSlotAssignments"
  | "slicerInstances"
>;

export type ProjectRow = typeof defaultSchema.projects.$inferSelect;
export type ProfileRow = typeof defaultSchema.buildProfiles.$inferSelect;
export type LayerRow = typeof defaultSchema.profileLayers.$inferSelect;
export type PartDbRow = typeof defaultSchema.parts.$inferSelect;
export type SourceDocRow = typeof defaultSchema.sourceDocs.$inferSelect;
export type SourceNoteRow = typeof defaultSchema.sourceNotes.$inferSelect;
export type PlanDecisionRow = typeof defaultSchema.planDecisions.$inferSelect;
export type PlanSnapshotRow = typeof defaultSchema.planSnapshots.$inferSelect;
export type PrintJobRow = typeof defaultSchema.printJobs.$inferSelect;
export type PrintJobPartRow = typeof defaultSchema.printJobParts.$inferSelect;

/** Slim slicer-profile projection used by the auto-slice routing layer. */
export type SlicerProfileRow = {
  id: number;
  name: string;
  /** Slicer dialect tag; null for filament rows, which carry no such column. */
  slicerFormat: string | null;
  /** Only set for filament rows (PLA/PETG/…); null elsewhere. */
  materialType?: string | null;
  resolvedFlatConfig: string | null;
};

/** Full row for the read-only profile library UI (all three kinds merged). */
export type ProfileLibraryRow = {
  id: number;
  kind: "printer" | "process" | "filament";
  name: string;
  slicerFormat: string | null;
  materialType: string | null;
  resolvedFlatConfig: string | null;
  sourcePath: string | null;
  syncedFromSlicerVersion: string | null;
  lastSyncedAt: string | null;
  importedAt: string;
};

export type SlicerInstanceRow = {
  id: string;
  name: string;
  kind: string;
  dialect: string;
  guiUrl: string;
  watchPath: string;
  dockerTarget: string;
  dockerHost: string | null;
  composeService: string | null;
  image: string | null;
  containerName: string | null;
  portsJson: string;
  volumesJson: string;
  envJson: string;
  statusCache: string;
  statusMessage: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SyncedPrinterProfileInput = {
  name: string;
  slicerFormat: string;
  slicerVersion?: string | null;
  nozzleDiameterMm?: string | null;
  extruderCount?: number | null;
  rawJson?: string | null;
  resolvedFlatConfig: string;
  sourcePath: string;
};

/** Input for a process profile upserted by the profile-sync watcher. */
export type SyncedProcessProfileInput = {
  name: string;
  slicerFormat: string;
  slicerVersion?: string | null;
  compatiblePrinters?: string | null;
  resolvedFlatConfig: string;
  sourcePath: string;
};

/** Input for a filament profile upserted by the profile-sync watcher. */
export type SyncedFilamentProfileInput = {
  name: string;
  materialType: string;
  slicerVersion?: string | null;
  materialTier?: number | null;
  nozzleTempC?: number | null;
  bedTempC?: number | null;
  fanPct?: number | null;
  extrusionMultiplier?: string | null;
  pressureAdvance?: string | null;
  retraction?: string | null;
  rawJson?: string | null;
  rawIni?: string | null;
  resolvedFlatConfig: string;
  sourcePath: string;
};

export type SourceDocSummary = {
  id: number;
  path: string;
  kind: string;
  title: string;
  size_bytes: number;
  extract_status: string;
  page_count: number | null;
};

export type SourceNoteSummary = {
  id: number;
  project_id: number;
  profile_id: number | null;
  title: string;
  body_markdown: string;
  author_user_id: string | null;
  created_at: string;
  updated_at: string;
};

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

function sourceSummary(row: ProjectRow, docCount = 0): SourceSummary {
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
    tag: row.tag ?? null,
    local_path: row.localPath,
    last_synced_at: row.lastSyncedAt,
    last_commit_sha: row.lastCommitSha,
    docs_url: row.docsUrl,
    manifest_community_slug: row.manifestCommunitySlug,
    metadata,
    naming_use_defaults: useDefaults,
    update_status,
    update_checked_at,
    doc_count: docCount,
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
    spoolman_spool_id: row.spoolmanSpoolId,
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
  private readonly syncSqlite: boolean;

  constructor(
    db: AppDrizzleDb,
    private readonly defaultTenantId = DEFAULT_TENANT_ID,
    reposDir: string,
    schema: SchemaTables = defaultSchema,
  ) {
    this.syncSqlite = isSyncSqliteDrizzle(db);
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

  /**
   * Serialize settings-row RMW mutations.
   * SQLite: native sync transaction. Postgres: in-process queue (sync bridge cannot
   * rebind queries onto an async tx client).
   */
  transaction<T>(fn: () => T): T {
    if (this.syncSqlite) {
      return this.db.transaction(fn);
    }
    return runSerializedSettingsMutation(fn);
  }

  // -------------------------------------------------------------------------
  // Slicer profiles (printer / process / filament) — imported slicer configs.
  // The `resolved_flat_config` column carries the inheritance-resolved flat
  // key/value document the slicer sidecar needs as its settings file.
  // -------------------------------------------------------------------------

  listSlicerPrinterProfiles(): SlicerProfileRow[] {
    return this.db
      .select({
        id: this.schema.printerProfiles.id,
        name: this.schema.printerProfiles.name,
        slicerFormat: this.schema.printerProfiles.slicerFormat,
        resolvedFlatConfig: this.schema.printerProfiles.resolvedFlatConfig,
      })
      .from(this.schema.printerProfiles)
      .where(eq(this.schema.printerProfiles.tenantId, this.tenantId))
      .orderBy(asc(this.schema.printerProfiles.name))
      .all();
  }

  listSlicerProcessProfiles(): SlicerProfileRow[] {
    return this.db
      .select({
        id: this.schema.processProfiles.id,
        name: this.schema.processProfiles.name,
        slicerFormat: this.schema.processProfiles.slicerFormat,
        resolvedFlatConfig: this.schema.processProfiles.resolvedFlatConfig,
      })
      .from(this.schema.processProfiles)
      .where(eq(this.schema.processProfiles.tenantId, this.tenantId))
      .orderBy(asc(this.schema.processProfiles.name))
      .all();
  }

  listSlicerFilamentProfiles(): SlicerProfileRow[] {
    return this.db
      .select({
        id: this.schema.filamentProfiles.id,
        name: this.schema.filamentProfiles.name,
        materialType: this.schema.filamentProfiles.materialType,
        resolvedFlatConfig: this.schema.filamentProfiles.resolvedFlatConfig,
      })
      .from(this.schema.filamentProfiles)
      .where(eq(this.schema.filamentProfiles.tenantId, this.tenantId))
      .orderBy(asc(this.schema.filamentProfiles.name))
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        // filament_profiles carries no slicer_format column — the rows are
        // portable across slicers, so report no dialect rather than
        // mislabelling the material type as one.
        slicerFormat: null,
        materialType: r.materialType,
        resolvedFlatConfig: r.resolvedFlatConfig,
      }));
  }

  // -------------------------------------------------------------------------
  // Profile library (read-only UI) + profile-sync watcher upserts.
  // -------------------------------------------------------------------------

  /** Full profile library for the read-only UI — all three kinds, with sync provenance. */
  listProfileLibrary(): ProfileLibraryRow[] {
    const printers = this.db
      .select({
        id: this.schema.printerProfiles.id,
        name: this.schema.printerProfiles.name,
        slicerFormat: this.schema.printerProfiles.slicerFormat,
        resolvedFlatConfig: this.schema.printerProfiles.resolvedFlatConfig,
        sourcePath: this.schema.printerProfiles.sourcePath,
        syncedFromSlicerVersion: this.schema.printerProfiles.syncedFromSlicerVersion,
        lastSyncedAt: this.schema.printerProfiles.lastSyncedAt,
        importedAt: this.schema.printerProfiles.importedAt,
      })
      .from(this.schema.printerProfiles)
      .where(eq(this.schema.printerProfiles.tenantId, this.tenantId))
      .all()
      .map((r) => ({ ...r, kind: "printer" as const, materialType: null }));

    const processes = this.db
      .select({
        id: this.schema.processProfiles.id,
        name: this.schema.processProfiles.name,
        slicerFormat: this.schema.processProfiles.slicerFormat,
        resolvedFlatConfig: this.schema.processProfiles.resolvedFlatConfig,
        sourcePath: this.schema.processProfiles.sourcePath,
        syncedFromSlicerVersion: this.schema.processProfiles.syncedFromSlicerVersion,
        lastSyncedAt: this.schema.processProfiles.lastSyncedAt,
        importedAt: this.schema.processProfiles.importedAt,
      })
      .from(this.schema.processProfiles)
      .where(eq(this.schema.processProfiles.tenantId, this.tenantId))
      .all()
      .map((r) => ({ ...r, kind: "process" as const, materialType: null }));

    const filaments = this.db
      .select({
        id: this.schema.filamentProfiles.id,
        name: this.schema.filamentProfiles.name,
        materialType: this.schema.filamentProfiles.materialType,
        resolvedFlatConfig: this.schema.filamentProfiles.resolvedFlatConfig,
        sourcePath: this.schema.filamentProfiles.sourcePath,
        syncedFromSlicerVersion: this.schema.filamentProfiles.syncedFromSlicerVersion,
        lastSyncedAt: this.schema.filamentProfiles.lastSyncedAt,
        importedAt: this.schema.filamentProfiles.importedAt,
      })
      .from(this.schema.filamentProfiles)
      .where(eq(this.schema.filamentProfiles.tenantId, this.tenantId))
      .all()
      .map((r) => ({ ...r, kind: "filament" as const, slicerFormat: null }));

    return [...printers, ...processes, ...filaments].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Upsert a printer/machine profile synced from a slicer config volume (identity: tenant + name). */
  upsertSyncedPrinterProfile(input: SyncedPrinterProfileInput): void {
    const now = new Date().toISOString();
    this.db
      .insert(this.schema.printerProfiles)
      .values({
        tenantId: this.tenantId,
        name: input.name,
        slicerFormat: input.slicerFormat,
        slicerVersionAtImport: input.slicerVersion ?? null,
        nozzleDiameterMm: input.nozzleDiameterMm ?? null,
        extruderCount: input.extruderCount ?? 1,
        rawJson: input.rawJson ?? null,
        resolvedFlatConfig: input.resolvedFlatConfig,
        importedAt: now,
        sourcePath: input.sourcePath,
        syncedFromSlicerVersion: input.slicerVersion ?? null,
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [this.schema.printerProfiles.tenantId, this.schema.printerProfiles.name],
        set: {
          slicerFormat: input.slicerFormat,
          slicerVersionAtImport: input.slicerVersion ?? null,
          nozzleDiameterMm: input.nozzleDiameterMm ?? null,
          extruderCount: input.extruderCount ?? 1,
          rawJson: input.rawJson ?? null,
          resolvedFlatConfig: input.resolvedFlatConfig,
          sourcePath: input.sourcePath,
          syncedFromSlicerVersion: input.slicerVersion ?? null,
          lastSyncedAt: now,
        },
      })
      .run();
  }

  /** Upsert a process (print settings) profile synced from a slicer config volume. */
  upsertSyncedProcessProfile(input: SyncedProcessProfileInput): void {
    const now = new Date().toISOString();
    this.db
      .insert(this.schema.processProfiles)
      .values({
        tenantId: this.tenantId,
        name: input.name,
        slicerFormat: input.slicerFormat,
        compatiblePrinters: input.compatiblePrinters ?? null,
        resolvedFlatConfig: input.resolvedFlatConfig,
        importedAt: now,
        sourcePath: input.sourcePath,
        syncedFromSlicerVersion: input.slicerVersion ?? null,
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [this.schema.processProfiles.tenantId, this.schema.processProfiles.name],
        set: {
          slicerFormat: input.slicerFormat,
          compatiblePrinters: input.compatiblePrinters ?? null,
          resolvedFlatConfig: input.resolvedFlatConfig,
          sourcePath: input.sourcePath,
          syncedFromSlicerVersion: input.slicerVersion ?? null,
          lastSyncedAt: now,
        },
      })
      .run();
  }

  /** Upsert a filament profile synced from a slicer config volume. */
  upsertSyncedFilamentProfile(input: SyncedFilamentProfileInput): void {
    const now = new Date().toISOString();
    this.db
      .insert(this.schema.filamentProfiles)
      .values({
        tenantId: this.tenantId,
        name: input.name,
        materialType: input.materialType,
        materialTier: input.materialTier ?? 1,
        nozzleTempC: input.nozzleTempC ?? null,
        bedTempC: input.bedTempC ?? null,
        fanPct: input.fanPct ?? null,
        extrusionMultiplier: input.extrusionMultiplier ?? null,
        pressureAdvance: input.pressureAdvance ?? null,
        retraction: input.retraction ?? null,
        rawJson: input.rawJson ?? null,
        rawIni: input.rawIni ?? null,
        resolvedFlatConfig: input.resolvedFlatConfig,
        importedAt: now,
        sourcePath: input.sourcePath,
        syncedFromSlicerVersion: input.slicerVersion ?? null,
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [this.schema.filamentProfiles.tenantId, this.schema.filamentProfiles.name],
        set: {
          materialType: input.materialType,
          materialTier: input.materialTier ?? 1,
          nozzleTempC: input.nozzleTempC ?? null,
          bedTempC: input.bedTempC ?? null,
          fanPct: input.fanPct ?? null,
          extrusionMultiplier: input.extrusionMultiplier ?? null,
          pressureAdvance: input.pressureAdvance ?? null,
          retraction: input.retraction ?? null,
          rawJson: input.rawJson ?? null,
          rawIni: input.rawIni ?? null,
          resolvedFlatConfig: input.resolvedFlatConfig,
          sourcePath: input.sourcePath,
          syncedFromSlicerVersion: input.slicerVersion ?? null,
          lastSyncedAt: now,
        },
      })
      .run();
  }

  /** Global slicer-printer-name -> PP fleet printer id map (all tenants). */
  listPrinterNameMap(): Array<{ slicerName: string; ppFleetId: string }> {
    return this.db
      .select({
        slicerName: this.schema.printerNameMap.slicerName,
        ppFleetId: this.schema.printerNameMap.ppFleetId,
      })
      .from(this.schema.printerNameMap)
      .all();
  }

  getPrinterProfileAssignment(
    printerId: string,
  ): { machineProfileId: number | null; profileSource: ProfileSourceMode; updatedAt: string } | null {
    const row = this.db
      .select({
        machineProfileId: this.schema.printerProfileAssignments.machineProfileId,
        profileSource: this.schema.printerProfileAssignments.profileSource,
        updatedAt: this.schema.printerProfileAssignments.updatedAt,
      })
      .from(this.schema.printerProfileAssignments)
      .where(
        and(
          eq(this.schema.printerProfileAssignments.tenantId, this.tenantId),
          eq(this.schema.printerProfileAssignments.printerId, printerId),
        ),
      )
      .get();
    if (!row) return null;
    const profileSource = row.profileSource === "assigned" ? "assigned" : "auto_match";
    return {
      machineProfileId: row.machineProfileId ?? null,
      profileSource,
      updatedAt: row.updatedAt,
    };
  }

  listFilamentSlotAssignments(
    printerId: string,
  ): Array<{ slotIndex: number; filamentProfileId: number | null }> {
    return this.db
      .select({
        slotIndex: this.schema.printerFilamentSlotAssignments.slotIndex,
        filamentProfileId: this.schema.printerFilamentSlotAssignments.filamentProfileId,
      })
      .from(this.schema.printerFilamentSlotAssignments)
      .where(
        and(
          eq(this.schema.printerFilamentSlotAssignments.tenantId, this.tenantId),
          eq(this.schema.printerFilamentSlotAssignments.printerId, printerId),
        ),
      )
      .orderBy(asc(this.schema.printerFilamentSlotAssignments.slotIndex))
      .all()
      .map((row) => ({
        slotIndex: row.slotIndex,
        filamentProfileId: row.filamentProfileId ?? null,
      }));
  }

  upsertPrinterProfileAssignment(input: {
    printerId: string;
    machineProfileId: number | null;
    profileSource: ProfileSourceMode;
    filamentSlots: Array<{ slotIndex: number; filamentProfileId: number | null }>;
  }): void {
    if (input.profileSource !== "assigned" && input.profileSource !== "auto_match") {
      throw new Error(`Invalid profile_source: ${String(input.profileSource)}`);
    }
    const now = new Date().toISOString();
    const normalizedSlots = input.filamentSlots
      .filter((slot) => slot.slotIndex >= 1 && slot.slotIndex <= 4)
      .sort((a, b) => a.slotIndex - b.slotIndex);

    this.transaction(() => {
      this.db
        .insert(this.schema.printerProfileAssignments)
        .values({
          printerId: input.printerId,
          tenantId: this.tenantId,
          machineProfileId: input.machineProfileId,
          profileSource: input.profileSource,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: this.schema.printerProfileAssignments.printerId,
          set: {
            machineProfileId: input.machineProfileId,
            profileSource: input.profileSource,
            updatedAt: now,
          },
        })
        .run();

      this.db
        .delete(this.schema.printerFilamentSlotAssignments)
        .where(
          and(
            eq(this.schema.printerFilamentSlotAssignments.tenantId, this.tenantId),
            eq(this.schema.printerFilamentSlotAssignments.printerId, input.printerId),
          ),
        )
        .run();

      for (const slot of normalizedSlots) {
        this.db
          .insert(this.schema.printerFilamentSlotAssignments)
          .values({
            tenantId: this.tenantId,
            printerId: input.printerId,
            slotIndex: slot.slotIndex,
            filamentProfileId: slot.filamentProfileId,
          })
          .run();
      }
    });
  }

  listSlicerInstances(): SlicerInstanceRow[] {
    return this.db
      .select()
      .from(this.schema.slicerInstances)
      .where(eq(this.schema.slicerInstances.tenantId, this.tenantId))
      .orderBy(asc(this.schema.slicerInstances.name))
      .all()
      .map((row) => this.mapSlicerInstance(row));
  }

  getSlicerInstance(id: string): SlicerInstanceRow | null {
    const row = this.db
      .select()
      .from(this.schema.slicerInstances)
      .where(
        and(
          eq(this.schema.slicerInstances.tenantId, this.tenantId),
          eq(this.schema.slicerInstances.id, id),
        ),
      )
      .get();
    return row ? this.mapSlicerInstance(row) : null;
  }

  upsertSlicerInstance(input: {
    id?: string;
    name: string;
    kind: string;
    dialect: string;
    guiUrl?: string;
    watchPath?: string;
    enabled?: boolean;
    dockerTarget?: string;
    dockerHost?: string | null;
    composeService?: string | null;
    image?: string | null;
    containerName?: string | null;
    portsJson?: string;
    volumesJson?: string;
    envJson?: string;
    statusCache?: string;
    statusMessage?: string | null;
  }): SlicerInstanceRow {
    const now = new Date().toISOString();
    const id = input.id?.trim() || `slicer-${crypto.randomUUID()}`;
    const existing = this.getSlicerInstance(id);
    const enabled = input.enabled ?? existing?.enabled ?? true;
    const values = {
      id,
      tenantId: this.tenantId,
      name: input.name.trim(),
      kind: input.kind,
      dialect: input.dialect,
      guiUrl: input.guiUrl ?? existing?.guiUrl ?? "",
      watchPath: input.watchPath ?? existing?.watchPath ?? "",
      dockerTarget: input.dockerTarget ?? existing?.dockerTarget ?? "local",
      dockerHost: input.dockerHost !== undefined ? input.dockerHost : (existing?.dockerHost ?? null),
      composeService:
        input.composeService !== undefined ? input.composeService : (existing?.composeService ?? null),
      image: input.image !== undefined ? input.image : (existing?.image ?? null),
      containerName:
        input.containerName !== undefined ? input.containerName : (existing?.containerName ?? null),
      portsJson: input.portsJson ?? existing?.portsJson ?? "[]",
      volumesJson: input.volumesJson ?? existing?.volumesJson ?? "[]",
      envJson: input.envJson ?? existing?.envJson ?? "{}",
      statusCache: input.statusCache ?? existing?.statusCache ?? "unknown",
      statusMessage:
        input.statusMessage !== undefined ? input.statusMessage : (existing?.statusMessage ?? null),
      enabled: enabled ? 1 : 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.db
      .insert(this.schema.slicerInstances)
      .values(values)
      .onConflictDoUpdate({
        target: this.schema.slicerInstances.id,
        set: {
          name: values.name,
          kind: values.kind,
          dialect: values.dialect,
          guiUrl: values.guiUrl,
          watchPath: values.watchPath,
          dockerTarget: values.dockerTarget,
          dockerHost: values.dockerHost,
          composeService: values.composeService,
          image: values.image,
          containerName: values.containerName,
          portsJson: values.portsJson,
          volumesJson: values.volumesJson,
          envJson: values.envJson,
          statusCache: values.statusCache,
          statusMessage: values.statusMessage,
          enabled: values.enabled,
          updatedAt: values.updatedAt,
        },
      })
      .run();

    const row = this.getSlicerInstance(id);
    if (!row) throw new Error(`Failed to upsert slicer instance ${id}`);
    return row;
  }

  deleteSlicerInstance(id: string): boolean {
    const existing = this.getSlicerInstance(id);
    if (!existing) return false;
    this.db
      .delete(this.schema.slicerInstances)
      .where(
        and(
          eq(this.schema.slicerInstances.tenantId, this.tenantId),
          eq(this.schema.slicerInstances.id, id),
        ),
      )
      .run();
    return true;
  }

  /**
   * Insert stock Orca/Prusa/Bambu presets when the tenant has zero instances.
   * Returns the number of rows inserted (0 if already seeded).
   */
  seedStockSlicerInstancesIfEmpty(env: NodeJS.ProcessEnv = process.env): number {
    return this.transaction(() => {
      if (this.listSlicerInstances().length > 0) return 0;
      let inserted = 0;
      for (const preset of stockPresets(env)) {
        this.upsertSlicerInstance({
          name: preset.name,
          kind: preset.kind,
          dialect: preset.dialect,
          guiUrl: preset.gui_url,
          watchPath: preset.watch_path,
          enabled: true,
        });
        inserted += 1;
      }
      return inserted;
    });
  }

  private mapSlicerInstance(row: typeof defaultSchema.slicerInstances.$inferSelect): SlicerInstanceRow {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      dialect: row.dialect,
      guiUrl: row.guiUrl,
      watchPath: row.watchPath,
      dockerTarget: row.dockerTarget,
      dockerHost: row.dockerHost ?? null,
      composeService: row.composeService ?? null,
      image: row.image ?? null,
      containerName: row.containerName ?? null,
      portsJson: row.portsJson,
      volumesJson: row.volumesJson,
      envJson: row.envJson,
      statusCache: row.statusCache,
      statusMessage: row.statusMessage ?? null,
      enabled: Boolean(row.enabled),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  getSlicerPrinterProfileById(
    id: number,
  ): (SlicerProfileRow & { lastSyncedAt: string | null }) | null {
    const row = this.db
      .select({
        id: this.schema.printerProfiles.id,
        name: this.schema.printerProfiles.name,
        slicerFormat: this.schema.printerProfiles.slicerFormat,
        resolvedFlatConfig: this.schema.printerProfiles.resolvedFlatConfig,
        lastSyncedAt: this.schema.printerProfiles.lastSyncedAt,
      })
      .from(this.schema.printerProfiles)
      .where(
        and(eq(this.schema.printerProfiles.tenantId, this.tenantId), eq(this.schema.printerProfiles.id, id)),
      )
      .get();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slicerFormat: row.slicerFormat,
      resolvedFlatConfig: row.resolvedFlatConfig,
      lastSyncedAt: row.lastSyncedAt ?? null,
    };
  }

  getSlicerFilamentProfileById(
    id: number,
  ): (SlicerProfileRow & { lastSyncedAt: string | null }) | null {
    const row = this.db
      .select({
        id: this.schema.filamentProfiles.id,
        name: this.schema.filamentProfiles.name,
        materialType: this.schema.filamentProfiles.materialType,
        resolvedFlatConfig: this.schema.filamentProfiles.resolvedFlatConfig,
        lastSyncedAt: this.schema.filamentProfiles.lastSyncedAt,
      })
      .from(this.schema.filamentProfiles)
      .where(
        and(eq(this.schema.filamentProfiles.tenantId, this.tenantId), eq(this.schema.filamentProfiles.id, id)),
      )
      .get();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slicerFormat: null,
      materialType: row.materialType,
      resolvedFlatConfig: row.resolvedFlatConfig,
      lastSyncedAt: row.lastSyncedAt ?? null,
    };
  }

  listSlicerProcessProfilesDetailed(): Array<SlicerProfileRow & { compatiblePrinters: string | null }> {
    return this.db
      .select({
        id: this.schema.processProfiles.id,
        name: this.schema.processProfiles.name,
        slicerFormat: this.schema.processProfiles.slicerFormat,
        resolvedFlatConfig: this.schema.processProfiles.resolvedFlatConfig,
        compatiblePrinters: this.schema.processProfiles.compatiblePrinters,
      })
      .from(this.schema.processProfiles)
      .where(eq(this.schema.processProfiles.tenantId, this.tenantId))
      .orderBy(asc(this.schema.processProfiles.name))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        slicerFormat: row.slicerFormat,
        resolvedFlatConfig: row.resolvedFlatConfig,
        compatiblePrinters: row.compatiblePrinters ?? null,
      }));
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
    const profiles = this.listProfiles();
    for (const p of profiles) {
      this.markProfileConfigModified(p.id);
    }
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
    const counts = this.docCountByProjectId();
    return rows.map((row) => sourceSummary(row, counts.get(row.id) ?? 0));
  }

  getSource(id: number): SourceSummary | null {
    const row = this.db
      .select()
      .from(this.schema.projects)
      .where(and(eq(this.schema.projects.tenantId, this.tenantId), eq(this.schema.projects.id, id)))
      .get();
    if (!row) return null;
    const counts = this.docCountByProjectId([id]);
    return sourceSummary(row, counts.get(id) ?? 0);
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

  /** All raw part rows for a profile (used e.g. for thumbnail regeneration). */
  getProfilePartRows(profileId: number): PartDbRow[] {
    return this.listPartRows(profileId);
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
    tag?: string | null;
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

    const reposRoot = resolve(this.reposDir);
    let trustedLocalPath: string | null = null;
    if (input.local_path) {
      const candidate = resolve(input.local_path);
      if (candidate.startsWith(reposRoot + sep) || candidate === reposRoot) {
        trustedLocalPath = candidate;
      }
    }

    const localPath = trustedLocalPath;

    const inserted = this.db
      .insert(this.schema.projects)
      .values({
        tenantId: this.tenantId,
        name,
        url: input.url ?? "",
        branch: input.branch ?? "main",
        tag: input.tag?.trim() || null,
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
    if (!inserted.localPath) {
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
      tag: string | null;
      source_kind: string;
      source_type: string;
      role: string;
      local_path: string;
      metadata: Record<string, unknown>;
      manifest_community_slug: string | null;
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
    if (patch.tag !== undefined) updates.tag = patch.tag?.trim() || null;
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
    if (patch.manifest_community_slug !== undefined) {
      updates.manifestCommunitySlug = patch.manifest_community_slug;
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

    return rows.map(({ profile, partCount }) =>
      this.toProfileSummary(profile, Number(partCount ?? 0)),
    );
  }

  private toProfileSummary(
    profile: typeof this.schema.buildProfiles.$inferSelect,
    partCount: number,
  ): ProfileSummary {
    const { totalUnits, remainingUnits } = this.printUnitTotals(profile.id);
    return {
      id: profile.id,
      name: profile.name,
      order_number: profile.orderNumber,
      special_request: profile.specialRequest?.trim() ? profile.specialRequest.trim() : null,
      part_count: partCount,
      remaining_units: remainingUnits,
      total_units: totalUnits,
      build_stale: this.isProfileStale(profile),
      archived_at: profile.archivedAt ?? null,
      last_used_at: profile.lastUsedAt ?? null,
    };
  }

  /** Included-part print unit totals (same basis as archive remaining=0). */
  printUnitTotals(profileId: number): { totalUnits: number; remainingUnits: number } {
    const partRows = this.listPartRows(profileId).filter((p) => p.included);
    let totalUnits = 0;
    let printedUnits = 0;
    const unitsById = this.printUnitsByPartId(profileId);
    for (const part of partRows) {
      const qty = Math.max(1, part.quantityEffective);
      totalUnits += qty;
      printedUnits += (unitsById.get(part.id) ?? []).filter(Boolean).length;
    }
    return {
      totalUnits,
      remainingUnits: Math.max(0, totalUnits - printedUnits),
    };
  }

  private isProfileStale(profile: {
    configModifiedAt: string | null;
    lastRecomputedAt: string | null;
  }): boolean {
    if (!profile.lastRecomputedAt) return true;
    if (!profile.configModifiedAt) return false;
    return profile.configModifiedAt > profile.lastRecomputedAt;
  }

  markProfileConfigModified(profileId: number): void {
    const now = new Date().toISOString();
    this.db
      .update(this.schema.buildProfiles)
      .set({ configModifiedAt: now })
      .where(
        and(
          eq(this.schema.buildProfiles.tenantId, this.tenantId),
          eq(this.schema.buildProfiles.id, profileId),
        ),
      )
      .run();
  }

  markProfilesUsingProjectStale(projectId: number): void {
    const layers = this.db
      .select({ profileId: this.schema.profileLayers.profileId })
      .from(this.schema.profileLayers)
      .where(eq(this.schema.profileLayers.projectId, projectId))
      .all();
    const seen = new Set<number>();
    for (const layer of layers) {
      if (seen.has(layer.profileId)) continue;
      seen.add(layer.profileId);
      this.markProfileConfigModified(layer.profileId);
    }
  }

  touchLastRecomputed(profileId: number): void {
    const now = new Date().toISOString();
    this.db
      .update(this.schema.buildProfiles)
      .set({ lastRecomputedAt: now })
      .where(
        and(
          eq(this.schema.buildProfiles.tenantId, this.tenantId),
          eq(this.schema.buildProfiles.id, profileId),
        ),
      )
      .run();
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
    return this.toProfileSummary(profile, Number(partCount?.c ?? 0));
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
      .values({
        tenantId: this.tenantId,
        name: trimmed,
        configModifiedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      })
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

  updateProfileSpecialRequest(id: number, specialRequest: string | null): ProfileSummary {
    if (!this.getProfile(id)) throw new Error("Profile not found");
    const trimmed = (specialRequest ?? "").trim();
    this.db
      .update(this.schema.buildProfiles)
      .set({ specialRequest: trimmed || null })
      .where(
        and(eq(this.schema.buildProfiles.tenantId, this.tenantId), eq(this.schema.buildProfiles.id, id)),
      )
      .run();
    const profile = this.getProfile(id);
    if (!profile) throw new Error("Profile not found");
    return profile;
  }

  archiveProfile(id: number): ProfileSummary {
    const existing = this.getProfile(id);
    if (!existing) throw new Error("Profile not found");
    if (existing.archived_at) return existing;

    const { totalUnits, remainingUnits } = this.printUnitTotals(id);
    if (totalUnits <= 0 || remainingUnits > 0) {
      throw new Error("Archive only when print remaining is 0");
    }

    const now = new Date().toISOString();
    this.db
      .update(this.schema.buildProfiles)
      .set({ archivedAt: now })
      .where(
        and(eq(this.schema.buildProfiles.tenantId, this.tenantId), eq(this.schema.buildProfiles.id, id)),
      )
      .run();
    return this.getProfile(id)!;
  }

  /** Unarchive is intentionally unsupported — duplicate an archived template instead. */
  unarchiveProfile(_id: number): never {
    throw new Error("Cannot unarchive; duplicate the archived template instead");
  }

  touchProfileLastUsed(id: number): ProfileSummary {
    const existing = this.getProfile(id);
    if (!existing) throw new Error("Profile not found");
    const now = new Date().toISOString();
    this.db
      .update(this.schema.buildProfiles)
      .set({ lastUsedAt: now })
      .where(
        and(eq(this.schema.buildProfiles.tenantId, this.tenantId), eq(this.schema.buildProfiles.id, id)),
      )
      .run();
    return this.getProfile(id)!;
  }

  duplicateProfile(
    id: number,
    newName: string,
    options?: { clearCheckoff?: boolean },
  ): ProfileSummary & { layers: ReturnType<AppRepository["getProfileLayers"]> } {
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
      .values({
        tenantId: this.tenantId,
        name: trimmed,
        orderNumber: source.orderNumber,
        specialRequest: source.specialRequest,
        // Copies are always active spine plans (templates stay archived).
        archivedAt: null,
        lastUsedAt: new Date().toISOString(),
        configModifiedAt: new Date().toISOString(),
      })
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

    // Copy per-unit checkoff progress unless the caller asked for a clean copy.
    if (!options?.clearCheckoff) {
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
    }

    const roleFilaments = this.getSetting(roleFilamentSettingKey(id));
    if (roleFilaments) {
      this.setSetting(roleFilamentSettingKey(newProfile.id), roleFilaments);
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
    this.markProfileConfigModified(layer.profileId);
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
    this.markProfileConfigModified(layer.profileId);
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
    this.markProfileConfigModified(profileId);
  }

  addAddonLayer(profileId: number, projectId: number): void {
    const project = this.getProjectRow(projectId);
    if (!project) throw new Error("Project not found");
    const duplicate = this.db
      .select({ id: this.schema.profileLayers.id })
      .from(this.schema.profileLayers)
      .where(
        and(
          eq(this.schema.profileLayers.profileId, profileId),
          eq(this.schema.profileLayers.projectId, projectId),
        ),
      )
      .get();
    if (duplicate) {
      throw new Error(`Source "${project.name}" is already attached to this build`);
    }
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
    this.markProfileConfigModified(profileId);
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
          const roleDefault =
            loadRoleFilamentDefaults(this, profileId)[normalizePartRole(mp.role)];
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
              filamentColorId: prior.filamentColorId ?? roleDefault?.filament_color_id ?? null,
              filamentCustomHex: prior.filamentCustomHex ?? roleDefault?.filament_custom_hex ?? null,
              spoolmanSpoolId: prior.spoolmanSpoolId ?? roleDefault?.spoolman_spool_id ?? null,
            })
            .where(eq(this.schema.parts.id, prior.id))
            .run();
        } else {
          const role = normalizePartRole(mp.role);
          const roleDefault = loadRoleFilamentDefaults(this, profileId)[role];
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
              filamentColorId: roleDefault?.filament_color_id ?? null,
              filamentCustomHex: roleDefault?.filament_custom_hex ?? null,
              spoolmanSpoolId: roleDefault?.spoolman_spool_id ?? null,
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
      this.touchLastRecomputed(profileId);
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
    const row = this.getProjectRow(id);
    if (!row) return;
    const metadata = parseProjectMetadata(row.metadataJson) ?? {};
    if (commitSha) {
      metadata[REMOTE_UPDATE_STATUS_KEY] = "up_to_date";
      metadata[REMOTE_CHECKED_AT_KEY] = new Date().toISOString();
    }
    this.db
      .update(this.schema.projects)
      .set({
        lastSyncedAt: new Date().toISOString(),
        lastCommitSha: commitSha,
        metadataJson: JSON.stringify(metadata),
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
    this.markProfilesUsingProjectStale(id);
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
        assembled: (r as Record<string, unknown>).assembled ? true : false,
      }));
  }

  private saveProgressRows(partId: number, rows: ProgressRow[]): void {
    this.db.delete(this.schema.printProgress).where(eq(this.schema.printProgress.partId, partId)).run();
    for (const row of rows) {
      const vals: Record<string, unknown> = {
        tenantId: this.tenantId,
        partId,
        unitIndex: row.unitIndex,
        completed: row.completed,
        // Always persist explicitly so a row that was toggled back to
        // not-assembled actually clears the column instead of keeping the old value.
        assembled: (row as Record<string, unknown>).assembled === true,
      };
      this.db
        .insert(this.schema.printProgress)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values(vals as any)
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
        assembled: (r as Record<string, unknown>).assembled ? true : false,
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

  /** Like printUnitsByPartId but returns raw ProgressRow arrays for access to assembled field. */
  private progressRowsByPartId(profileId: number): Map<number, ProgressRow[]> {
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
        assembled: (r as Record<string, unknown>).assembled ? true : false,
      });
      byPart.set(r.partId, list);
    }
    return byPart;
  }

  /** Parts with print progress for the unified Review API (optional excluded rows). */
  getEnrichedPartsForReview(
    profileId: number,
    includeExcluded: boolean,
    ctx?: FilamentResolveContext,
  ) {
    const partRows = this.listPartRows(profileId);
    for (const part of partRows) {
      this.ensureProgressForPart(part);
    }
    const unitsById = this.printUnitsByPartId(profileId);
    const progressRowsById = this.progressRowsByPartId(profileId);
    const rows = partRows.filter((p) => includeExcluded || p.included);
    return rows.map((p) => {
      const units = unitsById.get(p.id) ?? [];
      const printedCount = units.filter(Boolean).length;
      const qty = Math.max(1, p.quantityEffective);
      const resolved = ctx?.resolve(p.filamentColorId ?? null);
      const catalogColor = !resolved && p.filamentColorId ? getColorById(p.filamentColorId) : null;
      const hex = resolved?.hex ?? resolvePartFilamentHex(p);
      const base = partRow(p);
      const spoolSummary =
        ctx?.spoolSummariesForPart(p.filamentColorId ?? null, p.spoolmanSpoolId ?? null) ?? [];
      const pRows = progressRowsById.get(p.id) ?? [];
      const assembledUnits = getAssembledUnits(pRows, qty);
      return {
        ...base,
        printed_count: printedCount,
        print_units: units,
        assembled_units: assembledUnits,
        missing: printedCount < qty,
        filament_display:
          resolved?.combo_label ?? catalogColor?.combo_label ?? base.filament_display ?? "",
        filament_hex: hex ?? base.filament_hex ?? null,
        ...(spoolSummary.length
          ? {
              spool_summary: spoolSummary,
              spool_badge: formatSpoolSummaryBadge(spoolSummary),
            }
          : {}),
      };
    });
  }

  getCheckoff(profileId: number, ctx?: FilamentResolveContext) {
    const partRows = this.listPartRows(profileId);
    for (const part of partRows) {
      this.ensureProgressForPart(part);
    }
    const unitsById = this.printUnitsByPartId(profileId);
    const displayRows = partRows.map((p) => {
      const units = unitsById.get(p.id) ?? [];
      const printedCount = units.filter(Boolean).length;
      const resolved = ctx?.resolve(p.filamentColorId ?? null);
      const catalogColor = !resolved && p.filamentColorId ? getColorById(p.filamentColorId) : null;
      const hex = resolved?.hex ?? resolvePartFilamentHex(p);
      const spoolSummary =
        ctx?.spoolSummariesForPart(p.filamentColorId ?? null, p.spoolmanSpoolId ?? null) ?? [];
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
        filament_display: resolved?.combo_label ?? catalogColor?.combo_label ?? "",
        filament_hex: hex,
        included: p.included,
        ...(spoolSummary.length
          ? {
              spool_summary: spoolSummary,
              spool_badge: formatSpoolSummaryBadge(spoolSummary),
            }
          : {}),
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
    const partRowsOnly = updated.filter((r) => r.partId === partId);
    this.saveProgressRows(partId, partRowsOnly);
    const units = getPrintUnits(partRowsOnly, qty);
    const printedCount = units.filter(Boolean).length;
    return {
      part_id: partId,
      printed_count: printedCount,
      print_units: units,
      // Un-printing a unit also clears its assembled flag (domain rule in
      // setPrintedUnitCount). Return the post-toggle assembled state so the
      // checkoff UI never keeps a stale "Assembled" pip on a unit the user
      // just un-printed — otherwise re-checking the print resurrects it.
      assembled_units: getAssembledUnits(partRowsOnly, qty),
      missing: !isFullyPrinted({ quantity_effective: qty, printed_count: printedCount }),
    };
  }

  patchPartAssembled(partId: number, unitIndex: number, assembled: boolean) {
    const part = this.db.select().from(this.schema.parts).where(eq(this.schema.parts.id, partId)).get();
    if (!part) throw new Error("Part not found");
    const qty = Math.max(1, part.quantityEffective);
    if (unitIndex < 0 || unitIndex >= qty) throw new Error("unit_index out of range");
    this.ensureProgressForPart(part);
    const rows = this.progressRowsForPart(partId);
    // Domain owns the rule that an unprinted unit can't be assembled.
    const updated = setAssembledUnit(rows, partId, qty, unitIndex, assembled).filter(
      (r) => r.partId === partId,
    );
    this.saveProgressRows(partId, updated);
    const assembledUnits = getAssembledUnits(updated, qty);
    const assembledCount = assembledUnits.filter(Boolean).length;
    return {
      part_id: partId,
      assembled_count: assembledCount,
      assembled_units: assembledUnits,
    };
  }

  /** Read accessor: the assembled state of every unit of a single part. */
  getPartAssembled(partId: number) {
    const part = this.db.select().from(this.schema.parts).where(eq(this.schema.parts.id, partId)).get();
    if (!part) throw new Error("Part not found");
    const qty = Math.max(1, part.quantityEffective);
    this.ensureProgressForPart(part);
    const rows = this.progressRowsForPart(partId);
    const assembledUnits = getAssembledUnits(rows, qty);
    return {
      part_id: partId,
      assembled_count: assembledUnits.filter(Boolean).length,
      assembled_units: assembledUnits,
    };
  }

  patchPart(
    partId: number,
    patch: {
      included?: boolean;
      filament_color_id?: string | null;
      quantity_override?: number;
      spoolman_spool_id?: string | null;
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
      updates.spoolmanSpoolId = null;
    }
    if (patch.spoolman_spool_id !== undefined) {
      updates.spoolmanSpoolId = patch.spoolman_spool_id;
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
    const savedDefaults = loadRoleFilamentDefaults(this, profileId);
    const order = canonicalRoleOrder();
    const buckets = new Map<
      string,
      {
        role: string;
        part_count: number;
        filament_color_id: string | null;
        filament_custom_hex: string | null;
        spoolman_spool_id: string | null;
        filament_display: string;
        filament_hex: string | null;
        colorCounts: Map<string, number>;
        customHexCounts: Map<string, number>;
        spoolCounts: Map<string, number>;
      }
    >();

    const ensureBucket = (role: string) => {
      let row = buckets.get(role);
      if (!row) {
        const saved = savedDefaults[role];
        row = {
          role,
          part_count: 0,
          filament_color_id: saved?.filament_color_id ?? null,
          filament_custom_hex: saved?.filament_custom_hex ?? null,
          spoolman_spool_id: saved?.spoolman_spool_id ?? null,
          filament_display: "",
          filament_hex: null,
          colorCounts: new Map(),
          customHexCounts: new Map(),
          spoolCounts: new Map(),
        };
        buckets.set(role, row);
      }
      return row;
    };

    for (const role of order) ensureBucket(role);

    for (const part of partRows) {
      if (!part.included) continue;
      const row = ensureBucket(normalizePartRole(part.role));
      row.part_count += 1;
      if (part.filamentColorId) {
        row.colorCounts.set(
          part.filamentColorId,
          (row.colorCounts.get(part.filamentColorId) ?? 0) + 1,
        );
      }
      if (part.filamentCustomHex) {
        row.customHexCounts.set(
          part.filamentCustomHex,
          (row.customHexCounts.get(part.filamentCustomHex) ?? 0) + 1,
        );
      }
      if (part.spoolmanSpoolId) {
        row.spoolCounts.set(
          part.spoolmanSpoolId,
          (row.spoolCounts.get(part.spoolmanSpoolId) ?? 0) + 1,
        );
      }
      const color = part.filamentColorId ? getColorById(part.filamentColorId) : null;
      if (color?.combo_label && !row.filament_display) row.filament_display = color.combo_label;
      const hex = resolvePartFilamentHex(part);
      if (hex && !row.filament_hex) row.filament_hex = hex;
    }

    const majority = (counts: Map<string, number>): string | null => {
      if (!counts.size) return null;
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    };

    const roleSort = (role: string) => {
      const idx = order.indexOf(role);
      return idx >= 0 ? idx : order.length;
    };

    return [...buckets.values()]
      .sort((a, b) => roleSort(a.role) - roleSort(b.role) || a.role.localeCompare(b.role))
      .map((row) => {
        const colorId = majority(row.colorCounts);
        const customHex = majority(row.customHexCounts);
        const spoolId = majority(row.spoolCounts);
        const saved = savedDefaults[row.role];
        const filament_color_id =
          colorId ?? (row.part_count === 0 ? saved?.filament_color_id ?? null : row.filament_color_id);
        const filament_custom_hex =
          colorId != null
            ? null
            : customHex ?? (row.part_count === 0 ? saved?.filament_custom_hex ?? null : row.filament_custom_hex);
        const spoolman_spool_id =
          spoolId ?? (row.part_count === 0 ? saved?.spoolman_spool_id ?? null : row.spoolman_spool_id);
        return {
          role: row.role,
          part_count: row.part_count,
          filament_color_id,
          spoolman_spool_id,
          filament_custom_hex,
          filament_display: row.filament_display,
          filament_hex:
            filament_custom_hex ??
            row.filament_hex ??
            (filament_color_id ? getColorById(filament_color_id)?.hex ?? null : null),
        };
      });
  }

  bulkSetRoleFilament(
    profileId: number,
    role: string,
    colorId: string | null,
    customHex?: string | null,
    spoolRef?: string | null,
  ): number {
    const targetRole = normalizePartRole(role);
    const defaultPatch: Partial<RoleFilamentDefault> = {
      filament_color_id: colorId,
      filament_custom_hex: customHex ?? null,
    };
    if (spoolRef !== undefined) {
      defaultPatch.spoolman_spool_id = spoolRef;
    } else if (colorId != null) {
      defaultPatch.spoolman_spool_id = null;
    }
    saveRoleFilamentDefault(this, profileId, targetRole, defaultPatch);

    const partRows = this.listPartRows(profileId);
    let updated = 0;
    for (const part of partRows) {
      if (!part.included || normalizePartRole(part.role) !== targetRole) continue;
      const nextSpool =
        spoolRef !== undefined
          ? spoolRef
          : colorId !== part.filamentColorId
            ? null
            : part.spoolmanSpoolId;
      this.db
        .update(this.schema.parts)
        .set({
          filamentColorId: colorId,
          filamentCustomHex: customHex ?? null,
          spoolmanSpoolId: nextSpool ?? null,
        })
        .where(eq(this.schema.parts.id, part.id))
        .run();
      updated += 1;
    }
    this.markProfileConfigModified(profileId);
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
        project: proj ? kitLayerProjectExportRecord(kitSourceRefFromProject(proj)) : null,
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
      sourcesOut.push(kitSourceRefToExportRecord(kitSourceRefFromProject(proj)));
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
        sources: sourcesOut,
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
    unmatched_sources: KitBundleUnmatchedSource[];
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
    const unmatched_sources: KitBundleUnmatchedSource[] = [];
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

    for (const sourceRef of collectKitBundleSourceRefs(data)) {
      const projectId = resolveProjectId({
        name: sourceRef.name,
        url: sourceRef.url,
      });
      if (projectId != null) {
        if (sourceRef.import_rules.length > 0) {
          this.updateImportRules(projectId, sourceRef.import_rules);
        }
        const patch = kitMatchedSourcePatch(sourceRef);
        if (Object.keys(patch).length > 0) {
          this.updateSource(projectId, patch);
        }
        continue;
      }
      unmatched_sources.push(kitUnmatchedSourceFromRef(sourceRef));
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

  private docCountByProjectId(projectIds?: number[]): Map<number, number> {
    const map = new Map<number, number>();
    if (!this.schema.sourceDocs) return map;
    const rows = this.db
      .select({
        projectId: this.schema.sourceDocs.projectId,
        c: count(),
      })
      .from(this.schema.sourceDocs)
      .where(eq(this.schema.sourceDocs.tenantId, this.tenantId))
      .groupBy(this.schema.sourceDocs.projectId)
      .all();
    for (const row of rows) {
      if (projectIds && !projectIds.includes(row.projectId)) continue;
      map.set(row.projectId, Number(row.c) || 0);
    }
    return map;
  }

  listSourceDocs(projectId: number): SourceDocSummary[] {
    if (!this.schema.sourceDocs) return [];
    const rows = this.db
      .select()
      .from(this.schema.sourceDocs)
      .where(
        and(
          eq(this.schema.sourceDocs.tenantId, this.tenantId),
          eq(this.schema.sourceDocs.projectId, projectId),
        ),
      )
      .orderBy(asc(this.schema.sourceDocs.path))
      .all();
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      kind: row.kind,
      title: docTitleFromPath(row.path),
      size_bytes: row.sizeBytes ?? 0,
      extract_status: row.extractStatus,
      page_count: row.pageCount ?? null,
    }));
  }

  replaceSourceDocs(
    projectId: number,
    docs: Array<{
      path: string;
      kind: string;
      sizeBytes: number;
      contentHash?: string | null;
      extractStatus?: string;
      pageCount?: number | null;
      extractError?: string | null;
    }>,
  ): void {
    if (!this.schema.sourceDocs) return;
    this.db
      .delete(this.schema.sourceDocs)
      .where(
        and(
          eq(this.schema.sourceDocs.tenantId, this.tenantId),
          eq(this.schema.sourceDocs.projectId, projectId),
        ),
      )
      .run();
    const now = new Date().toISOString();
    for (const doc of docs) {
      this.db
        .insert(this.schema.sourceDocs)
        .values({
          tenantId: this.tenantId,
          projectId,
          path: doc.path,
          kind: doc.kind,
          sizeBytes: doc.sizeBytes,
          contentHash: doc.contentHash ?? null,
          extractStatus: doc.extractStatus ?? (doc.kind === "pdf" ? "pending" : "na"),
          extractError: doc.extractError ?? null,
          pageCount: doc.pageCount ?? null,
          updatedAt: now,
        })
        .run();
    }
  }

  updateSourceDocExtract(
    projectId: number,
    path: string,
    patch: {
      extractStatus: string;
      contentHash?: string | null;
      pageCount?: number | null;
      extractError?: string | null;
    },
  ): void {
    if (!this.schema.sourceDocs) return;
    this.db
      .update(this.schema.sourceDocs)
      .set({
        extractStatus: patch.extractStatus,
        contentHash: patch.contentHash ?? undefined,
        pageCount: patch.pageCount ?? undefined,
        extractError: patch.extractError ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(this.schema.sourceDocs.tenantId, this.tenantId),
          eq(this.schema.sourceDocs.projectId, projectId),
          eq(this.schema.sourceDocs.path, path),
        ),
      )
      .run();
  }

  listPendingPdfDocs(projectId: number): SourceDocSummary[] {
    return this.listSourceDocs(projectId).filter(
      (d) => d.kind === "pdf" && (d.extract_status === "pending" || d.extract_status === "error"),
    );
  }

  listSourceNotes(projectId: number, profileId?: number | null): SourceNoteSummary[] {
    if (!this.schema.sourceNotes) return [];
    const rows = this.db
      .select()
      .from(this.schema.sourceNotes)
      .where(
        and(
          eq(this.schema.sourceNotes.tenantId, this.tenantId),
          eq(this.schema.sourceNotes.projectId, projectId),
        ),
      )
      .orderBy(asc(this.schema.sourceNotes.updatedAt))
      .all();
    return rows
      .filter((row) => {
        if (profileId === undefined) return true;
        if (profileId === null) return row.profileId == null;
        return row.profileId === profileId || row.profileId == null;
      })
      .map((row) => ({
        id: row.id,
        project_id: row.projectId,
        profile_id: row.profileId ?? null,
        title: row.title,
        body_markdown: row.bodyMarkdown,
        author_user_id: row.authorUserId ?? null,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      }));
  }

  getSourceNote(noteId: number): SourceNoteSummary | null {
    if (!this.schema.sourceNotes) return null;
    const row = this.db
      .select()
      .from(this.schema.sourceNotes)
      .where(
        and(
          eq(this.schema.sourceNotes.tenantId, this.tenantId),
          eq(this.schema.sourceNotes.id, noteId),
        ),
      )
      .get();
    if (!row) return null;
    return {
      id: row.id,
      project_id: row.projectId,
      profile_id: row.profileId ?? null,
      title: row.title,
      body_markdown: row.bodyMarkdown,
      author_user_id: row.authorUserId ?? null,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  createSourceNote(input: {
    projectId: number;
    profileId?: number | null;
    title?: string;
    bodyMarkdown: string;
    authorUserId?: string | null;
  }): SourceNoteSummary {
    if (!this.schema.sourceNotes) throw new Error("source_notes table unavailable");
    const now = new Date().toISOString();
    const inserted = this.db
      .insert(this.schema.sourceNotes)
      .values({
        tenantId: this.tenantId,
        projectId: input.projectId,
        profileId: input.profileId ?? null,
        title: (input.title ?? "").trim() || "Note",
        bodyMarkdown: input.bodyMarkdown,
        authorUserId: input.authorUserId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (!inserted) throw new Error("Failed to create note");
    return this.getSourceNote(inserted.id)!;
  }

  updateSourceNote(
    noteId: number,
    patch: Partial<{ title: string; bodyMarkdown: string; profileId: number | null }>,
  ): SourceNoteSummary {
    if (!this.schema.sourceNotes) throw new Error("source_notes table unavailable");
    const existing = this.getSourceNote(noteId);
    if (!existing) throw new Error("Note not found");
    const updates: Partial<typeof this.schema.sourceNotes.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (patch.title != null) updates.title = patch.title.trim() || "Note";
    if (patch.bodyMarkdown != null) updates.bodyMarkdown = patch.bodyMarkdown;
    if (patch.profileId !== undefined) updates.profileId = patch.profileId;
    this.db
      .update(this.schema.sourceNotes)
      .set(updates)
      .where(eq(this.schema.sourceNotes.id, noteId))
      .run();
    return this.getSourceNote(noteId)!;
  }

  deleteSourceNote(noteId: number): boolean {
    if (!this.schema.sourceNotes) return false;
    const existing = this.getSourceNote(noteId);
    if (!existing) return false;
    this.db
      .delete(this.schema.sourceNotes)
      .where(
        and(
          eq(this.schema.sourceNotes.tenantId, this.tenantId),
          eq(this.schema.sourceNotes.id, noteId),
        ),
      )
      .run();
    return true;
  }

  private parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private mapPlanDecision(row: PlanDecisionRow): PlanDecision {
    return {
      id: row.id,
      plan_id: row.profileId,
      created_at: row.createdAt,
      actor: row.actor as PlanDecisionActor,
      kind: row.kind as PlanDecisionKind,
      action_type: row.actionType ?? null,
      params: this.parseJsonObject(row.paramsJson),
      label: row.label,
      summary: row.summary,
      rationale: row.rationale ?? null,
      result: row.resultJson ? this.parseJsonObject(row.resultJson) : null,
    };
  }

  listPlanDecisions(planId: number, limit = 200): PlanDecision[] {
    if (!this.schema.planDecisions) return [];
    const rows = this.db
      .select()
      .from(this.schema.planDecisions)
      .where(
        and(
          eq(this.schema.planDecisions.tenantId, this.tenantId),
          eq(this.schema.planDecisions.profileId, planId),
        ),
      )
      .orderBy(asc(this.schema.planDecisions.createdAt))
      .all();
    return rows.slice(-Math.max(1, limit)).map((r) => this.mapPlanDecision(r));
  }

  /** Recent plan_decisions across the tenant, optionally excluding one plan (cross-plan memory). */
  listRecentTenantPlanDecisions(
    limit = 200,
    excludePlanId?: number | null,
  ): PlanDecision[] {
    if (!this.schema.planDecisions) return [];
    const conditions = [eq(this.schema.planDecisions.tenantId, this.tenantId)];
    if (excludePlanId != null && excludePlanId > 0) {
      conditions.push(ne(this.schema.planDecisions.profileId, excludePlanId));
    }
    const rows = this.db
      .select()
      .from(this.schema.planDecisions)
      .where(and(...conditions))
      .orderBy(asc(this.schema.planDecisions.createdAt))
      .all();
    return rows.slice(-Math.max(1, limit)).map((r) => this.mapPlanDecision(r));
  }

  createPlanDecision(input: {
    planId: number;
    actor: PlanDecisionActor;
    kind: PlanDecisionKind;
    actionType?: string | null;
    params?: Record<string, unknown>;
    label?: string;
    summary?: string;
    rationale?: string | null;
    result?: Record<string, unknown> | null;
  }): PlanDecision {
    if (!this.schema.planDecisions) throw new Error("plan_decisions table unavailable");
    const now = new Date().toISOString();
    const inserted = this.db
      .insert(this.schema.planDecisions)
      .values({
        tenantId: this.tenantId,
        profileId: input.planId,
        createdAt: now,
        actor: input.actor,
        kind: input.kind,
        actionType: input.actionType ?? null,
        paramsJson: JSON.stringify(input.params ?? {}),
        label: input.label ?? "",
        summary: input.summary ?? "",
        rationale: input.rationale ?? null,
        resultJson: input.result != null ? JSON.stringify(input.result) : null,
      })
      .returning()
      .get();
    return this.mapPlanDecision(inserted);
  }

  /** Delete plan_decisions for one plan (tenant-scoped). Returns rows removed. */
  deletePlanDecisionsForPlan(planId: number): number {
    if (!this.schema.planDecisions) return 0;
    if (!planId || planId <= 0) return 0;
    const before = this.listPlanDecisions(planId, 10_000).length;
    if (before === 0) return 0;
    this.db
      .delete(this.schema.planDecisions)
      .where(
        and(
          eq(this.schema.planDecisions.tenantId, this.tenantId),
          eq(this.schema.planDecisions.profileId, planId),
        ),
      )
      .run();
    return before;
  }

  /** Delete all plan_decisions for this tenant. Returns rows removed. */
  deleteAllPlanDecisions(): number {
    if (!this.schema.planDecisions) return 0;
    const before = this.listRecentTenantPlanDecisions(10_000, null).length;
    if (before === 0) return 0;
    this.db
      .delete(this.schema.planDecisions)
      .where(eq(this.schema.planDecisions.tenantId, this.tenantId))
      .run();
    return before;
  }

  private mapPlanSnapshotSummary(row: PlanSnapshotRow): PlanSnapshotSummary {
    return {
      id: row.id,
      plan_id: row.profileId,
      name: row.name,
      created_at: row.createdAt,
      source: row.source as PlanSnapshotSource,
    };
  }

  listPlanSnapshots(planId: number): PlanSnapshotSummary[] {
    if (!this.schema.planSnapshots) return [];
    const rows = this.db
      .select()
      .from(this.schema.planSnapshots)
      .where(
        and(
          eq(this.schema.planSnapshots.tenantId, this.tenantId),
          eq(this.schema.planSnapshots.profileId, planId),
        ),
      )
      .orderBy(asc(this.schema.planSnapshots.createdAt))
      .all();
    return rows.map((r) => this.mapPlanSnapshotSummary(r));
  }

  getPlanSnapshot(snapshotId: number): PlanSnapshot | null {
    if (!this.schema.planSnapshots) return null;
    const row = this.db
      .select()
      .from(this.schema.planSnapshots)
      .where(
        and(
          eq(this.schema.planSnapshots.tenantId, this.tenantId),
          eq(this.schema.planSnapshots.id, snapshotId),
        ),
      )
      .get();
    if (!row) return null;
    return {
      ...this.mapPlanSnapshotSummary(row),
      payload: this.parseJsonObject(row.payloadJson),
    };
  }

  createPlanSnapshot(input: {
    planId: number;
    name: string;
    source: PlanSnapshotSource;
    payload: Record<string, unknown>;
  }): PlanSnapshot {
    if (!this.schema.planSnapshots) throw new Error("plan_snapshots table unavailable");
    const now = new Date().toISOString();
    const inserted = this.db
      .insert(this.schema.planSnapshots)
      .values({
        tenantId: this.tenantId,
        profileId: input.planId,
        name: input.name,
        createdAt: now,
        source: input.source,
        payloadJson: JSON.stringify(input.payload ?? {}),
      })
      .returning()
      .get();
    return {
      ...this.mapPlanSnapshotSummary(inserted),
      payload: this.parseJsonObject(inserted.payloadJson),
    };
  }

  deletePlanSnapshot(snapshotId: number): boolean {
    if (!this.schema.planSnapshots) return false;
    const existing = this.getPlanSnapshot(snapshotId);
    if (!existing) return false;
    this.db
      .delete(this.schema.planSnapshots)
      .where(
        and(
          eq(this.schema.planSnapshots.tenantId, this.tenantId),
          eq(this.schema.planSnapshots.id, snapshotId),
        ),
      )
      .run();
    return true;
  }

  // ── Print jobs (SQL history, replaces blob store) ──────────────────────────

  insertPrintJob(job: {
    id: string;
    profileId: number;
    hostIntegrationId?: string;
    printerId?: string;
    material?: string;
    filename?: string;
    status?: string;
    filamentConsumedG?: number;
    at: string;
    completedAt?: string;
    linkId?: string;
  }): PrintJobRow {
    const inserted = this.db
      .insert(this.schema.printJobs)
      .values({
        id: job.id,
        tenantId: this.tenantId,
        profileId: job.profileId,
        hostIntegrationId: job.hostIntegrationId ?? null,
        printerId: job.printerId ?? "",
        material: job.material ?? "",
        filename: job.filename ?? null,
        status: job.status ?? "sent",
        filamentConsumedG: job.filamentConsumedG ?? null,
        at: job.at,
        completedAt: job.completedAt ?? null,
        linkId: job.linkId ?? null,
      })
      .returning()
      .get();
    if (!inserted) throw new Error("Failed to insert print job");
    return inserted;
  }

  /**
   * Print jobs at/after `sinceIso`, most recent first, capped at `limit`.
   * Used by get_print_stats (assistant MCP tool) and the Discord morning
   * digest. Goes through Drizzle's query builder (works on both the
   * better-sqlite3 sync driver and the Postgres async-wrapped driver) —
   * do NOT reach for `(repo as any).db.prepare(...)`, since `this.db` is a
   * Drizzle instance, not a raw better-sqlite3 handle, and has no `.prepare`.
   */
  recentPrintJobs(sinceIso: string, limit = 100): PrintJobRow[] {
    return this.db
      .select()
      .from(this.schema.printJobs)
      .where(
        and(
          eq(this.schema.printJobs.tenantId, this.tenantId),
          gte(this.schema.printJobs.at, sinceIso),
        ),
      )
      .orderBy(desc(this.schema.printJobs.at))
      .limit(limit)
      .all();
  }

  insertPrintJobParts(parts: Array<{
    id: string;
    jobId?: string;
    at: string;
    profileId: number;
    partId: number;
    unitIndex: number;
    result: string;
    reason?: string;
    note?: string;
    hostIntegrationId?: string;
    filename?: string;
    matchKey?: string;
    role?: string;
    filamentDisplay?: string;
    linkId?: string;
  }>): PrintJobPartRow[] {
    if (!parts.length) return [];
    const inserted = this.db
      .insert(this.schema.printJobParts)
      .values(parts.map((p) => ({
        id: p.id,
        tenantId: this.tenantId,
        jobId: p.jobId ?? null,
        at: p.at,
        profileId: p.profileId,
        partId: p.partId,
        unitIndex: p.unitIndex,
        result: p.result,
        reason: p.reason ?? null,
        note: p.note ?? null,
        hostIntegrationId: p.hostIntegrationId ?? null,
        filename: p.filename ?? null,
        matchKey: p.matchKey ?? null,
        role: p.role ?? null,
        filamentDisplay: p.filamentDisplay ?? null,
        linkId: p.linkId ?? null,
      })))
      .returning()
      .all();
    return inserted;
  }

  /**
   * Returns aggregate print-job counters grouped by (printer_id, material, status)
   * for the current tenant. Used by the Prometheus /metrics endpoint.
   */
  printJobMetrics(): Array<{
    printer_id: string;
    material: string;
    status: string;
    cnt: number;
    filament_sum: number | null;
  }> {
    const tenantId = this.tenantId;
    return this.db
      .select({
        printer_id: this.schema.printJobs.printerId,
        material: this.schema.printJobs.material,
        status: this.schema.printJobs.status,
        cnt: sql<number>`COUNT(*)`,
        filament_sum: sql<number | null>`SUM(${this.schema.printJobs.filamentConsumedG})`,
      })
      .from(this.schema.printJobs)
      .where(eq(this.schema.printJobs.tenantId, tenantId))
      .groupBy(
        this.schema.printJobs.printerId,
        this.schema.printJobs.material,
        this.schema.printJobs.status,
      )
      .all() as Array<{
        printer_id: string;
        material: string;
        status: string;
        cnt: number;
        filament_sum: number | null;
      }>;
  }

  listPrintJobParts(profileId: number): PrintJobPartRow[] {
    return this.db
      .select()
      .from(this.schema.printJobParts)
      .where(
        and(
          eq(this.schema.printJobParts.tenantId, this.tenantId),
          eq(this.schema.printJobParts.profileId, profileId),
        ),
      )
      .orderBy(asc(this.schema.printJobParts.at))
      .all();
  }
}

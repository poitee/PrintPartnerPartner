import { and, asc, eq, gt, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { DrizzleDb } from "./client.js";
import * as defaultSchema from "./schema.js";
import {
  digestPlanRevisionParts,
  MAX_ACCEPTED_OPERATIONAL_ROW_TEXT_BYTES,
  PLAN_REVISION_DIGEST_FORMAT,
} from "../services/plan-publication.js";
import { digestPlanInputs } from "../services/plan-freshness.js";
import {
  digestRequiredUnitMap,
  parseRequiredUnitToken,
  REQUIRED_UNIT_MAP_FORMAT,
  validateRequiredUnitObjectName,
} from "../services/required-units.js";
import type { PlanRevisionInput } from "@print-partner/contracts";
import { resolveStoredSnapshotPath } from "./stored-snapshot-path.js";

export type AcceptedPlanCorruptionCode =
  | "pointer"
  | "revision"
  | "revision_digest"
  | "accepted_inputs"
  | "source_revision"
  | "projection"
  | "required_unit_map"
  | "progress"
  | "artifact_linkage";

export class AcceptedPlanOperationalIntegrityError extends Error {
  readonly code: AcceptedPlanCorruptionCode;

  constructor(code: AcceptedPlanCorruptionCode, message: string) {
    super(message);
    this.name = "AcceptedPlanOperationalIntegrityError";
    this.code = code;
  }
}

type AcceptedOperationalInputCommon = {
  readonly inputId: number;
  readonly sourceId: number;
  readonly sourceLayer: string;
  readonly layerOrder: number;
  readonly effectiveNamingDigest: string;
};

export type AcceptedOperationalInput =
  | (AcceptedOperationalInputCommon & {
      readonly trackingKind: "revision";
      readonly sourceRevisionId: number;
      readonly manifestDigest: string;
      readonly snapshotRoot: string;
      readonly sourceSyncedAt: string;
    })
  | (AcceptedOperationalInputCommon & {
      readonly trackingKind: "untracked";
      readonly sourceRevisionId: null;
      readonly manifestDigest: null;
      readonly snapshotRoot: null;
      readonly sourceSyncedAt: null;
    });

export type AcceptedOperationalArtifact =
  | {
      readonly kind: "tracked";
      readonly sourceId: number;
      readonly sourceRevisionId: number;
      readonly snapshotRoot: string;
      readonly relativePath: string;
      readonly expectedSha256: string;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "legacy" | "untracked_source";
    };

export type AcceptedOperationalUnit = {
  readonly unitIndex: number;
  readonly required: boolean;
  readonly token: string;
  readonly objectName: string;
  readonly completed: boolean;
  readonly assembled: boolean;
};

export type AcceptedOperationalPart = {
  readonly revisionPartId: number;
  readonly projectionPartId: number;
  readonly partKey: string;
  readonly relativePath: string;
  readonly filename: string;
  readonly sourceLayer: string;
  readonly status: string;
  readonly roleInferred: string;
  readonly roleOverride: string | null;
  readonly effectiveRole: string;
  readonly filamentColorId: string | null;
  readonly filamentCustomHex: string | null;
  readonly spoolmanSpoolId: string | null;
  readonly quantityInferred: number;
  readonly quantityOverride: number | null;
  readonly quantityEffective: number;
  readonly included: boolean;
  readonly notes: string;
  readonly githubBlobUrl: string | null;
  readonly geometrySame: boolean | null;
  readonly requirement: string | null;
  readonly optionGroupId: string | null;
  readonly manifestSource: string | null;
  readonly artifact: AcceptedOperationalArtifact;
  readonly units: readonly AcceptedOperationalUnit[];
};

export type AcceptedPlanOperationalSnapshot = {
  readonly format: "accepted-plan-operational-v1";
  readonly profile: {
    readonly id: number;
    readonly name: string;
    readonly orderNumber: string | null;
    readonly specialRequest: string | null;
    readonly archivedAt: string | null;
  };
  readonly planVersion: number;
  readonly revisionId: number;
  readonly revisionNumber: number;
  readonly revisionDigest: string;
  readonly acceptedAt: string;
  readonly provenance:
    | { readonly kind: "legacy" }
    | {
        readonly kind: "tracked";
        readonly inputSetId: number;
        readonly inputSetDigest: string;
        readonly inputs: readonly AcceptedOperationalInput[];
      };
  readonly requiredUnitMappingDigest: string;
  readonly parts: readonly AcceptedOperationalPart[];
};

export type ReadAcceptedPlanOperationalSnapshotResult =
  | { readonly kind: "ready"; readonly snapshot: AcceptedPlanOperationalSnapshot }
  | { readonly kind: "empty" | "compatibility_dirty" | "uninitialized" };

export type AcceptedPlanOperationalSchema = Pick<
  typeof defaultSchema,
  | "buildProfiles"
  | "parts"
  | "planAcceptedInputSets"
  | "planRevisions"
  | "planRevisionParts"
  | "requiredUnits"
  | "planRevisionRequiredUnitSets"
  | "planRevisionRequiredUnits"
  | "planRevisionInputSets"
  | "planRevisionInputs"
  | "projects"
  | "sourceRevisions"
  | "printProgress"
>;

type AcceptedPlanOperationalReadDependencies = {
  readonly db: DrizzleDb;
  readonly schema: AcceptedPlanOperationalSchema;
  readonly tenantId: string;
  readonly profileId: number;
  readonly reposDir: string;
  readonly sqlite: boolean;
};

function corrupt(code: AcceptedPlanCorruptionCode, message: string): never {
  throw new AcceptedPlanOperationalIntegrityError(code, message);
}

function validateStoredRequiredUnit(token: string, objectName: string): void {
  try {
    parseRequiredUnitToken(token);
    validateRequiredUnitObjectName(objectName, token);
  } catch {
    corrupt("required_unit_map", "Accepted Plan Required-unit syntax is corrupt");
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ACCEPTED_READ_PAGE_SIZE = 256;
const ACCEPTED_TEXT_PAGE_SIZE = 16;

function chunks<T>(items: readonly T[], size = ACCEPTED_READ_PAGE_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function digestFormat1Inputs(
  rows: readonly { readonly sourceRevisionId: number; readonly manifestDigest: string }[],
): string {
  const canonical = [...rows]
    .map((row) => ({
      source_revision_id: row.sourceRevisionId,
      manifest_digest: row.manifestDigest,
    }))
    .sort((left, right) => left.source_revision_id - right.source_revision_id);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function storedTextBytes(sqlite: boolean, columns: readonly AnyColumn[]): SQL<number> {
  return columns.reduce<SQL<number>>(
    (total, column) =>
      sqlite
        ? sql<number>`${total} + length(cast(coalesce(${column}, '') as blob))`
        : sql<number>`${total} + octet_length(coalesce(${column}, ''))`,
    sql<number>`0`,
  );
}

function validateStoredTextBytes(
  bytes: number,
  code: AcceptedPlanCorruptionCode,
  message: string,
): void {
  if (!Number.isSafeInteger(bytes) || bytes > MAX_ACCEPTED_OPERATIONAL_ROW_TEXT_BYTES) {
    corrupt(code, message);
  }
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeLayerOrder(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSafeRelativePath(value: string): boolean {
  const segments = value.split("/");
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function storedBoolean(value: unknown): boolean | null {
  if (value === false || value === 0) return false;
  if (value === true || value === 1) return true;
  return null;
}

function revisionDigestParts(
  rows: readonly (typeof defaultSchema.planRevisionParts.$inferSelect)[],
) {
  return rows.map((part) => ({
    partKey: part.partKey,
    relativePath: part.relativePath,
    filename: part.filename,
    sourceLayer: part.sourceLayer,
    status: part.status,
    roleInferred: part.roleInferred,
    roleOverride: part.roleOverride,
    filamentColorId: part.filamentColorId,
    filamentCustomHex: part.filamentCustomHex,
    spoolmanSpoolId: part.spoolmanSpoolId,
    quantityInferred: part.quantityInferred,
    quantityOverride: part.quantityOverride,
    quantityEffective: part.quantityEffective,
    included: part.included,
    notes: part.notes,
    githubBlobUrl: part.githubBlobUrl,
    geometrySame: part.geometrySame,
    requirement: part.requirement,
    optionGroupId: part.optionGroupId,
    manifestSource: part.manifestSource,
    artifactDigest: part.artifactDigest,
  }));
}

type AcceptedInputState =
  | { readonly kind: "legacy" }
  | { readonly kind: "format1" }
  | {
      readonly kind: "tracked";
      readonly inputSetId: number;
      readonly inputSetDigest: string;
      readonly inputs: readonly AcceptedOperationalInput[];
      readonly byLayer: ReadonlyMap<string, AcceptedOperationalInput>;
     };

function validateSourceRevisionText(input: {
  readonly db: DrizzleDb;
  readonly schema: AcceptedPlanOperationalSchema;
  readonly sqlite: boolean;
  readonly sourceRevisionId: number;
}): void {
  const row = input.db
    .select({
      bytes: storedTextBytes(input.sqlite, [
        input.schema.sourceRevisions.tenantId,
        input.schema.sourceRevisions.upstreamRevisionKey,
        input.schema.sourceRevisions.manifestDigest,
        input.schema.sourceRevisions.snapshotLocator,
        input.schema.sourceRevisions.syncedAt,
        input.schema.sourceRevisions.completeness,
      ]),
    })
    .from(input.schema.sourceRevisions)
    .where(eq(input.schema.sourceRevisions.id, input.sourceRevisionId))
    .get();
  if (row) {
    validateStoredTextBytes(
      row.bytes,
      "source_revision",
      "Accepted Plan Source revision text is corrupt",
    );
  }
}

function loadAcceptedInputs(input: {
  readonly db: DrizzleDb;
  readonly schema: AcceptedPlanOperationalSchema;
  readonly tenantId: string;
  readonly profileId: number;
  readonly reposDir: string;
  readonly sqlite: boolean;
  readonly revision: typeof defaultSchema.planRevisions.$inferSelect;
  readonly acceptedInputs: readonly (typeof defaultSchema.planAcceptedInputSets.$inferSelect)[];
}): AcceptedInputState {
  const { db, schema, tenantId, profileId, reposDir, revision, acceptedInputs } = input;
  if (revision.provenanceKind === "legacy") {
    if (revision.inputSetId != null || acceptedInputs.length !== 0) {
      corrupt("accepted_inputs", "Legacy accepted Plan has input provenance");
    }
    return { kind: "legacy" };
  }
  if (revision.provenanceKind !== "tracked" || revision.inputSetId == null) {
    corrupt("revision", "Accepted Plan revision provenance is corrupt");
  }
  const accepted = acceptedInputs[0];
  if (
    acceptedInputs.length !== 1 ||
    !accepted ||
    accepted.tenantId !== tenantId ||
    accepted.profileId !== profileId ||
    accepted.inputSetId !== revision.inputSetId ||
    accepted.acceptedAt !== revision.acceptedAt
  ) {
    corrupt("accepted_inputs", "Accepted Plan input selection is corrupt");
  }
  const setText = db
    .select({
      bytes: storedTextBytes(input.sqlite, [
        schema.planRevisionInputSets.tenantId,
        schema.planRevisionInputSets.inputSetDigest,
        schema.planRevisionInputSets.recordedAt,
        schema.planRevisionInputSets.publishedAt,
      ]),
    })
    .from(schema.planRevisionInputSets)
    .where(eq(schema.planRevisionInputSets.id, revision.inputSetId))
    .get();
  if (setText) {
    validateStoredTextBytes(
      setText.bytes,
      "accepted_inputs",
      "Accepted Plan input set text is corrupt",
    );
  }
  const set = db
    .select()
    .from(schema.planRevisionInputSets)
    .where(eq(schema.planRevisionInputSets.id, revision.inputSetId))
    .get();
  if (
    !set ||
    set.tenantId !== tenantId ||
    set.profileId !== profileId ||
    set.publishedAt == null ||
    !isCanonicalTimestamp(set.recordedAt) ||
    !isCanonicalTimestamp(set.publishedAt) ||
    !Number.isSafeInteger(set.expectedInputCount) ||
    set.expectedInputCount < 0 ||
    (set.formatVersion !== 1 && set.formatVersion !== 2)
  ) {
    corrupt("accepted_inputs", "Accepted Plan input set is corrupt");
  }
  let lastInputPreflightId: number | null = null;
  while (true) {
    const page: Array<{ readonly id: number; readonly bytes: number }> = db
      .select({
        id: schema.planRevisionInputs.id,
        bytes: storedTextBytes(input.sqlite, [
          schema.planRevisionInputs.tenantId,
          schema.planRevisionInputs.manifestDigest,
          schema.planRevisionInputs.sourceLayer,
          schema.planRevisionInputs.trackingKind,
          schema.planRevisionInputs.effectiveNamingDigest,
        ]),
      })
      .from(schema.planRevisionInputs)
      .where(
        lastInputPreflightId == null
          ? eq(schema.planRevisionInputs.inputSetId, set.id)
          : and(
              eq(schema.planRevisionInputs.inputSetId, set.id),
              gt(schema.planRevisionInputs.id, lastInputPreflightId),
            ),
      )
      .orderBy(asc(schema.planRevisionInputs.id))
      .limit(ACCEPTED_READ_PAGE_SIZE)
      .all();
    for (const row of page) {
      if (!isPositiveSafeInteger(row.id)) {
        corrupt("accepted_inputs", "Accepted Plan input row ID is corrupt");
      }
      validateStoredTextBytes(
        row.bytes,
        "accepted_inputs",
        "Accepted Plan input row text is corrupt",
      );
    }
    if (page.length < ACCEPTED_READ_PAGE_SIZE) break;
    lastInputPreflightId = page.at(-1)!.id;
  }
  const rows: Array<typeof defaultSchema.planRevisionInputs.$inferSelect> = [];
  let lastInputId: number | null = null;
  while (true) {
    const page: Array<typeof defaultSchema.planRevisionInputs.$inferSelect> = db
      .select()
      .from(schema.planRevisionInputs)
      .where(
        lastInputId == null
          ? eq(schema.planRevisionInputs.inputSetId, set.id)
          : and(
              eq(schema.planRevisionInputs.inputSetId, set.id),
              gt(schema.planRevisionInputs.id, lastInputId),
            ),
      )
      .orderBy(asc(schema.planRevisionInputs.id))
      .limit(ACCEPTED_TEXT_PAGE_SIZE)
      .all();
    rows.push(...page);
    if (page.length < ACCEPTED_TEXT_PAGE_SIZE) break;
    lastInputId = page.at(-1)!.id;
  }
  if (
    rows.length !== set.expectedInputCount ||
    rows.some((row) => row.tenantId !== tenantId)
  ) {
    corrupt("accepted_inputs", "Accepted Plan input set is incomplete");
  }
  if (set.formatVersion === 1) {
    const sourceIds = new Set<number>();
    const sourceLayers = new Set<string>();
    for (const row of rows) {
      const source = db
        .select({ id: schema.projects.id, tenantId: schema.projects.tenantId })
        .from(schema.projects)
        .where(eq(schema.projects.id, row.sourceId))
        .get();
      if (
        !isPositiveSafeInteger(row.sourceId) ||
        sourceIds.has(row.sourceId) ||
        row.sourceLayer !== `legacy:${row.sourceId}` ||
        sourceLayers.has(row.sourceLayer) ||
        row.layerOrder !== 0 ||
        row.trackingKind !== "revision" ||
        row.effectiveNamingDigest != null ||
        row.sourceRevisionId == null ||
        row.manifestDigest == null ||
        !SHA256_PATTERN.test(row.manifestDigest) ||
        !source ||
        source.tenantId !== tenantId
      ) {
        corrupt("accepted_inputs", "Format-1 accepted Plan input set is corrupt");
      }
      validateSourceRevisionText({
        db,
        schema,
        sqlite: input.sqlite,
        sourceRevisionId: row.sourceRevisionId,
      });
      const sourceRevision = db
        .select()
        .from(schema.sourceRevisions)
        .where(eq(schema.sourceRevisions.id, row.sourceRevisionId))
        .get();
      const snapshotRoot = sourceRevision
        ? resolveStoredSnapshotPath(reposDir, sourceRevision.snapshotLocator)
        : null;
      if (
        !sourceRevision ||
        sourceRevision.tenantId !== tenantId ||
        sourceRevision.projectId !== row.sourceId ||
        sourceRevision.completeness !== "complete" ||
        sourceRevision.manifestDigest !== row.manifestDigest ||
        snapshotRoot == null ||
        !isCanonicalTimestamp(sourceRevision.syncedAt)
      ) {
        corrupt("source_revision", "Format-1 accepted Plan Source revision is corrupt");
      }
      sourceIds.add(row.sourceId);
      sourceLayers.add(row.sourceLayer);
    }
    if (
      digestFormat1Inputs(
        rows.map((row) => ({
          sourceRevisionId: row.sourceRevisionId!,
          manifestDigest: row.manifestDigest!,
        })),
      ) !== set.inputSetDigest
    ) {
      corrupt("accepted_inputs", "Format-1 accepted Plan input digest is corrupt");
    }
    return { kind: "format1" };
  }
  const sourceIds = new Set<number>();
  const sourceLayers = new Set<string>();
  const layerOrders = new Set<number>();
  const operationalInputs: AcceptedOperationalInput[] = [];
  const canonicalInputs: PlanRevisionInput[] = [];
  for (const row of rows) {
    if (
      !isPositiveSafeInteger(row.sourceId) ||
      sourceIds.has(row.sourceId) ||
      row.sourceLayer.length === 0 ||
      sourceLayers.has(row.sourceLayer) ||
      !isSafeLayerOrder(row.layerOrder) ||
      layerOrders.has(row.layerOrder) ||
      row.effectiveNamingDigest == null ||
      !SHA256_PATTERN.test(row.effectiveNamingDigest)
    ) {
      corrupt("accepted_inputs", "Accepted Plan input identity is corrupt");
    }
    sourceIds.add(row.sourceId);
    sourceLayers.add(row.sourceLayer);
    layerOrders.add(row.layerOrder);
      const source = db
      .select({ id: schema.projects.id, tenantId: schema.projects.tenantId })
      .from(schema.projects)
      .where(eq(schema.projects.id, row.sourceId))
      .get();
    if (!source || source.tenantId !== tenantId) {
      corrupt("source_revision", "Accepted Plan Source ownership is corrupt");
    }
    if (row.trackingKind === "revision") {
      if (
        row.sourceRevisionId == null ||
        row.manifestDigest == null ||
        !SHA256_PATTERN.test(row.manifestDigest)
      ) {
        corrupt("source_revision", "Accepted Plan Source revision identity is corrupt");
      }
      validateSourceRevisionText({
        db,
        schema,
        sqlite: input.sqlite,
        sourceRevisionId: row.sourceRevisionId,
      });
      const sourceRevision = db
        .select()
        .from(schema.sourceRevisions)
        .where(eq(schema.sourceRevisions.id, row.sourceRevisionId))
        .get();
      const snapshotRoot = sourceRevision
        ? resolveStoredSnapshotPath(reposDir, sourceRevision.snapshotLocator)
        : null;
      if (
        !sourceRevision ||
        sourceRevision.tenantId !== tenantId ||
        sourceRevision.projectId !== row.sourceId ||
        sourceRevision.completeness !== "complete" ||
        sourceRevision.manifestDigest !== row.manifestDigest ||
        snapshotRoot == null ||
        !isCanonicalTimestamp(sourceRevision.syncedAt)
      ) {
        corrupt("source_revision", "Accepted Plan Source revision is corrupt");
      }
      operationalInputs.push({
        inputId: row.id,
        sourceId: row.sourceId,
        sourceLayer: row.sourceLayer,
        layerOrder: row.layerOrder,
        effectiveNamingDigest: row.effectiveNamingDigest,
        trackingKind: "revision",
        sourceRevisionId: row.sourceRevisionId,
        manifestDigest: row.manifestDigest,
        snapshotRoot,
        sourceSyncedAt: sourceRevision.syncedAt,
      });
      canonicalInputs.push({
        source_id: row.sourceId,
        source_layer: row.sourceLayer,
        layer_order: row.layerOrder,
        tracking_kind: "revision",
        source_revision_id: row.sourceRevisionId,
        manifest_digest: row.manifestDigest,
        effective_naming_digest: row.effectiveNamingDigest,
      });
      continue;
    }
    if (
      row.trackingKind !== "untracked" ||
      row.sourceRevisionId != null ||
      row.manifestDigest != null
    ) {
      corrupt("source_revision", "Accepted Plan untracked Source identity is corrupt");
    }
    operationalInputs.push({
      inputId: row.id,
      sourceId: row.sourceId,
      sourceLayer: row.sourceLayer,
      layerOrder: row.layerOrder,
      effectiveNamingDigest: row.effectiveNamingDigest,
      trackingKind: "untracked",
      sourceRevisionId: null,
      manifestDigest: null,
      snapshotRoot: null,
      sourceSyncedAt: null,
    });
    canonicalInputs.push({
      source_id: row.sourceId,
      source_layer: row.sourceLayer,
      layer_order: row.layerOrder,
      tracking_kind: "untracked",
      source_revision_id: null,
      manifest_digest: null,
      effective_naming_digest: row.effectiveNamingDigest,
    });
  }
  if (digestPlanInputs(canonicalInputs) !== set.inputSetDigest) {
    corrupt("accepted_inputs", "Accepted Plan input digest is corrupt");
  }
  operationalInputs.sort(
    (left, right) => left.layerOrder - right.layerOrder || left.sourceId - right.sourceId,
  );
  return {
    kind: "tracked",
    inputSetId: set.id,
    inputSetDigest: set.inputSetDigest,
    inputs: operationalInputs,
    byLayer: new Map(operationalInputs.map((row) => [row.sourceLayer, row])),
  };
}

type LoadedAcceptedPart = {
  readonly value: Omit<AcceptedOperationalPart, "units">;
  readonly included: boolean;
  readonly quantityEffective: number;
};

function loadAcceptedParts(input: {
  readonly db: DrizzleDb;
  readonly schema: AcceptedPlanOperationalSchema;
  readonly tenantId: string;
  readonly profileId: number;
  readonly revisionParts: readonly (typeof defaultSchema.planRevisionParts.$inferSelect)[];
  readonly inputState: AcceptedInputState;
  readonly sqlite: boolean;
}): LoadedAcceptedPart[] {
  const { db, schema, tenantId, profileId, revisionParts, inputState, sqlite } = input;
  let lastProjectionPreflightId: number | null = null;
  while (true) {
    const page = db
      .select({
        id: schema.parts.id,
        bytes: storedTextBytes(sqlite, [
          schema.parts.tenantId,
          schema.parts.matchKey,
          schema.parts.relativePath,
          schema.parts.filename,
          schema.parts.sourceLayer,
          schema.parts.status,
          schema.parts.role,
          schema.parts.filamentColorId,
          schema.parts.filamentCustomHex,
          schema.parts.spoolmanSpoolId,
          schema.parts.notes,
          schema.parts.githubBlobUrl,
          schema.parts.requirement,
          schema.parts.optionGroupId,
          schema.parts.manifestSource,
        ]),
      })
      .from(schema.parts)
      .where(
        lastProjectionPreflightId == null
          ? eq(schema.parts.profileId, profileId)
          : and(
              eq(schema.parts.profileId, profileId),
              gt(schema.parts.id, lastProjectionPreflightId),
            ),
      )
      .orderBy(asc(schema.parts.id))
      .limit(ACCEPTED_READ_PAGE_SIZE)
      .all();
    for (const row of page) {
      if (!isPositiveSafeInteger(row.id)) {
        corrupt("projection", "Accepted Plan projection Part ID is corrupt");
      }
      validateStoredTextBytes(
        row.bytes,
        "projection",
        "Accepted Plan projection Part text is corrupt",
      );
    }
    if (page.length < ACCEPTED_READ_PAGE_SIZE) break;
    lastProjectionPreflightId = page.at(-1)!.id;
  }
  const projectionRows: Array<typeof defaultSchema.parts.$inferSelect> = [];
  const projectionBooleanEvidence: Array<{
    id: number;
    included: unknown;
    geometrySame: unknown;
  }> = [];
  let lastProjectionId: number | null = null;
  while (true) {
    const page = db
      .select()
      .from(schema.parts)
      .where(
        lastProjectionId == null
          ? eq(schema.parts.profileId, profileId)
          : and(eq(schema.parts.profileId, profileId), gt(schema.parts.id, lastProjectionId)),
      )
      .orderBy(asc(schema.parts.id))
      .limit(ACCEPTED_TEXT_PAGE_SIZE)
      .all();
    projectionRows.push(...page);
    if (page.length < ACCEPTED_TEXT_PAGE_SIZE) break;
    lastProjectionId = page.at(-1)!.id;
  }
  lastProjectionId = null;
  while (true) {
    const page = db
      .select({
        id: schema.parts.id,
        included: sql<unknown>`${schema.parts.included}`,
        geometrySame: sql<unknown>`${schema.parts.geometrySame}`,
      })
      .from(schema.parts)
      .where(
        lastProjectionId == null
          ? eq(schema.parts.profileId, profileId)
          : and(eq(schema.parts.profileId, profileId), gt(schema.parts.id, lastProjectionId)),
      )
      .orderBy(asc(schema.parts.id))
      .limit(ACCEPTED_TEXT_PAGE_SIZE)
      .all();
    projectionBooleanEvidence.push(...page);
    if (page.length < ACCEPTED_TEXT_PAGE_SIZE) break;
    lastProjectionId = page.at(-1)!.id;
  }
  const revisionBooleanEvidence: Array<{
    id: number;
    included: unknown;
    geometrySame: unknown;
  }> = [];
  for (const ids of chunks(revisionParts.map((part) => part.id))) {
    revisionBooleanEvidence.push(
      ...db
        .select({
          id: schema.planRevisionParts.id,
          included: sql<unknown>`${schema.planRevisionParts.included}`,
          geometrySame: sql<unknown>`${schema.planRevisionParts.geometrySame}`,
        })
        .from(schema.planRevisionParts)
        .where(inArray(schema.planRevisionParts.id, ids))
        .orderBy(asc(schema.planRevisionParts.id))
        .all(),
    );
  }
  if (
    revisionBooleanEvidence.length !== revisionParts.length ||
    revisionBooleanEvidence.some(
      (row) =>
        storedBoolean(row.included) == null ||
        (row.geometrySame != null && storedBoolean(row.geometrySame) == null),
    ) ||
    projectionBooleanEvidence.length !== projectionRows.length ||
    projectionBooleanEvidence.some(
      (row) =>
        storedBoolean(row.included) == null ||
        (row.geometrySame != null && storedBoolean(row.geometrySame) == null),
    )
  ) {
    corrupt("projection", "Accepted Plan Part booleans are corrupt");
  }
  if (
    projectionRows.length !== revisionParts.length ||
    projectionRows.some((row) => row.tenantId !== tenantId)
  ) {
    corrupt("projection", "Accepted Plan projection ownership is corrupt");
  }
  const projectionById = new Map(projectionRows.map((row) => [row.id, row]));
  const projectionIds = new Set<number>();
  const partKeys = new Set<string>();
  const loaded = [...revisionParts]
    .sort((left, right) => left.id - right.id)
    .map((part): LoadedAcceptedPart => {
      if (
        !isPositiveSafeInteger(part.id) ||
        !isPositiveSafeInteger(part.projectionPartId ?? 0) ||
        projectionIds.has(part.projectionPartId!) ||
        part.partKey.length === 0 ||
        partKeys.has(part.partKey) ||
        !isPositiveSafeInteger(part.quantityInferred) ||
        part.quantityInferred > 10_000 ||
        (part.quantityOverride != null &&
          (!isPositiveSafeInteger(part.quantityOverride) || part.quantityOverride > 10_000)) ||
        !isPositiveSafeInteger(part.quantityEffective) ||
        part.quantityEffective > 10_000 ||
        part.quantityEffective !== (part.quantityOverride ?? part.quantityInferred)
      ) {
        corrupt("projection", "Accepted Plan revision Part identity is corrupt");
      }
      projectionIds.add(part.projectionPartId!);
      partKeys.add(part.partKey);
      const projection = projectionById.get(part.projectionPartId!);
      const effectiveRole = part.roleOverride ?? part.roleInferred;
      if (
        !projection ||
        projection.matchKey !== part.partKey ||
        projection.relativePath !== part.relativePath ||
        projection.filename !== part.filename ||
        projection.sourceLayer !== part.sourceLayer ||
        projection.status !== part.status ||
        projection.role !== effectiveRole ||
        projection.filamentColorId !== part.filamentColorId ||
        projection.filamentCustomHex !== part.filamentCustomHex ||
        projection.spoolmanSpoolId !== part.spoolmanSpoolId ||
        projection.quantityAuto !== part.quantityInferred ||
        projection.quantityOverride !== part.quantityOverride ||
        projection.quantityEffective !== part.quantityEffective ||
        projection.included !== part.included ||
        projection.notes !== part.notes ||
        projection.githubBlobUrl !== part.githubBlobUrl ||
        projection.geometrySame !== part.geometrySame ||
        projection.requirement !== part.requirement ||
        projection.optionGroupId !== part.optionGroupId ||
        projection.manifestSource !== part.manifestSource
      ) {
        corrupt("projection", "Accepted Plan projection differs from its revision");
      }
      let artifact: AcceptedOperationalArtifact;
      if (inputState.kind === "legacy" || inputState.kind === "format1") {
        artifact = { kind: "unavailable", reason: "legacy" };
      } else {
        const acceptedInput = inputState.byLayer.get(part.sourceLayer);
        if (!acceptedInput) {
          corrupt("artifact_linkage", "Accepted Plan Part has no pinned input");
        }
        if (acceptedInput.trackingKind === "untracked") {
          if (part.artifactDigest != null) {
            corrupt("artifact_linkage", "Untracked accepted Plan Part claims an artifact digest");
          }
          artifact = { kind: "unavailable", reason: "untracked_source" };
        } else {
          if (!isSafeRelativePath(part.relativePath) || !SHA256_PATTERN.test(part.artifactDigest ?? "")) {
            corrupt("artifact_linkage", "Tracked accepted Plan Part artifact is corrupt");
          }
          artifact = {
            kind: "tracked",
            sourceId: acceptedInput.sourceId,
            sourceRevisionId: acceptedInput.sourceRevisionId,
            snapshotRoot: acceptedInput.snapshotRoot,
            relativePath: part.relativePath,
            expectedSha256: part.artifactDigest!,
          };
        }
      }
      return {
        included: part.included,
        quantityEffective: part.quantityEffective,
        value: {
          revisionPartId: part.id,
          projectionPartId: part.projectionPartId!,
          partKey: part.partKey,
          relativePath: part.relativePath,
          filename: part.filename,
          sourceLayer: part.sourceLayer,
          status: part.status,
          roleInferred: part.roleInferred,
          roleOverride: part.roleOverride,
          effectiveRole,
          filamentColorId: part.filamentColorId,
          filamentCustomHex: part.filamentCustomHex,
          spoolmanSpoolId: part.spoolmanSpoolId,
          quantityInferred: part.quantityInferred,
          quantityOverride: part.quantityOverride,
          quantityEffective: part.quantityEffective,
          included: part.included,
          notes: part.notes,
          githubBlobUrl: part.githubBlobUrl,
          geometrySame: part.geometrySame,
          requirement: part.requirement,
          optionGroupId: part.optionGroupId,
          manifestSource: part.manifestSource,
          artifact,
        },
      };
    });
  if (projectionById.size !== projectionIds.size) {
    corrupt("projection", "Accepted Plan projection has extra Parts");
  }
  return loaded;
}

type UnitWithoutProgress = Omit<AcceptedOperationalUnit, "completed" | "assembled">;

function loadRequiredUnits(input: {
  readonly db: DrizzleDb;
  readonly schema: AcceptedPlanOperationalSchema;
  readonly tenantId: string;
  readonly profileId: number;
  readonly revisionId: number;
  readonly requiredSet: typeof defaultSchema.planRevisionRequiredUnitSets.$inferSelect;
  readonly parts: readonly LoadedAcceptedPart[];
  readonly sqlite: boolean;
}): {
  readonly mappingDigest: string;
  readonly byPart: ReadonlyMap<number, readonly UnitWithoutProgress[]>;
} {
  const { db, schema, tenantId, profileId, revisionId, requiredSet, parts, sqlite } = input;
  const expectedUnitCount = parts.reduce((sum, part) => sum + part.quantityEffective, 0);
  if (
    requiredSet.tenantId !== tenantId ||
    requiredSet.profileId !== profileId ||
    requiredSet.format !== REQUIRED_UNIT_MAP_FORMAT ||
    !Number.isSafeInteger(requiredSet.expectedUnitCount) ||
    requiredSet.expectedUnitCount !== expectedUnitCount
  ) {
    corrupt("required_unit_map", "Accepted Plan Required-unit header is corrupt");
  }
  let lastMappingPreflight:
    | { readonly revisionPartId: number; readonly unitIndex: number; readonly tenantId: string }
    | null = null;
  while (true) {
    const page: Array<{
      readonly revisionPartId: number;
      readonly unitIndex: number;
      readonly tenantId: string;
      readonly bytes: number;
    }> = db
      .select({
        revisionPartId: schema.planRevisionRequiredUnits.revisionPartId,
        unitIndex: schema.planRevisionRequiredUnits.unitIndex,
        tenantId: schema.planRevisionRequiredUnits.tenantId,
        bytes: storedTextBytes(sqlite, [
          schema.planRevisionRequiredUnits.tenantId,
          schema.planRevisionRequiredUnits.requiredUnitToken,
        ]),
      })
      .from(schema.planRevisionRequiredUnits)
      .where(
        lastMappingPreflight == null
          ? eq(schema.planRevisionRequiredUnits.revisionId, revisionId)
          : and(
              eq(schema.planRevisionRequiredUnits.revisionId, revisionId),
              or(
                gt(
                  schema.planRevisionRequiredUnits.revisionPartId,
                  lastMappingPreflight.revisionPartId,
                ),
                and(
                  eq(
                    schema.planRevisionRequiredUnits.revisionPartId,
                    lastMappingPreflight.revisionPartId,
                  ),
                  gt(schema.planRevisionRequiredUnits.unitIndex, lastMappingPreflight.unitIndex),
                ),
                and(
                  eq(
                    schema.planRevisionRequiredUnits.revisionPartId,
                    lastMappingPreflight.revisionPartId,
                  ),
                  eq(schema.planRevisionRequiredUnits.unitIndex, lastMappingPreflight.unitIndex),
                  gt(schema.planRevisionRequiredUnits.tenantId, lastMappingPreflight.tenantId),
                ),
              ),
            ),
      )
      .orderBy(
        asc(schema.planRevisionRequiredUnits.revisionPartId),
        asc(schema.planRevisionRequiredUnits.unitIndex),
        asc(schema.planRevisionRequiredUnits.tenantId),
      )
      .limit(ACCEPTED_TEXT_PAGE_SIZE)
      .all();
    for (const row of page) {
      validateStoredTextBytes(
        row.bytes,
        "required_unit_map",
        "Accepted Plan Required-unit mapping text is corrupt",
      );
    }
    if (page.length < ACCEPTED_TEXT_PAGE_SIZE) break;
    const last: (typeof page)[number] = page.at(-1)!;
    lastMappingPreflight = {
      revisionPartId: last.revisionPartId,
      unitIndex: last.unitIndex,
      tenantId: last.tenantId,
    };
  }
  const mappings: Array<typeof defaultSchema.planRevisionRequiredUnits.$inferSelect> = [];
  let lastMapping:
    | { readonly revisionPartId: number; readonly unitIndex: number; readonly tenantId: string }
    | null = null;
  while (true) {
    const page: Array<typeof defaultSchema.planRevisionRequiredUnits.$inferSelect> = db
      .select()
      .from(schema.planRevisionRequiredUnits)
      .where(
        lastMapping == null
          ? eq(schema.planRevisionRequiredUnits.revisionId, revisionId)
          : and(
              eq(schema.planRevisionRequiredUnits.revisionId, revisionId),
              or(
                gt(
                  schema.planRevisionRequiredUnits.revisionPartId,
                  lastMapping.revisionPartId,
                ),
                and(
                  eq(
                    schema.planRevisionRequiredUnits.revisionPartId,
                    lastMapping.revisionPartId,
                  ),
                  gt(schema.planRevisionRequiredUnits.unitIndex, lastMapping.unitIndex),
                ),
                and(
                  eq(
                    schema.planRevisionRequiredUnits.revisionPartId,
                    lastMapping.revisionPartId,
                  ),
                  eq(schema.planRevisionRequiredUnits.unitIndex, lastMapping.unitIndex),
                  gt(schema.planRevisionRequiredUnits.tenantId, lastMapping.tenantId),
                ),
              ),
            ),
      )
      .orderBy(
        asc(schema.planRevisionRequiredUnits.revisionPartId),
        asc(schema.planRevisionRequiredUnits.unitIndex),
        asc(schema.planRevisionRequiredUnits.tenantId),
      )
      .limit(ACCEPTED_TEXT_PAGE_SIZE)
      .all();
    mappings.push(...page);
    if (page.length < ACCEPTED_TEXT_PAGE_SIZE) break;
    const last: (typeof page)[number] = page.at(-1)!;
    lastMapping = {
      revisionPartId: last.revisionPartId,
      unitIndex: last.unitIndex,
      tenantId: last.tenantId,
    };
  }
  if (mappings.length !== expectedUnitCount) {
    corrupt("required_unit_map", "Accepted Plan Required-unit mappings are incomplete");
  }
  const tokens = mappings.map((mapping) => mapping.requiredUnitToken);
  const units: Array<typeof defaultSchema.requiredUnits.$inferSelect> = [];
  for (const tokenChunk of chunks(tokens, ACCEPTED_TEXT_PAGE_SIZE)) {
    const preflight = db
      .select({
        token: schema.requiredUnits.token,
        bytes: storedTextBytes(sqlite, [
          schema.requiredUnits.token,
          schema.requiredUnits.tenantId,
          schema.requiredUnits.objectName,
          schema.requiredUnits.createdAt,
        ]),
      })
      .from(schema.requiredUnits)
      .where(inArray(schema.requiredUnits.token, tokenChunk))
      .orderBy(asc(schema.requiredUnits.token))
      .all();
    for (const row of preflight) {
      validateStoredTextBytes(
        row.bytes,
        "required_unit_map",
        "Accepted Plan Required-unit text is corrupt",
      );
    }
    units.push(
      ...db
        .select()
        .from(schema.requiredUnits)
        .where(inArray(schema.requiredUnits.token, tokenChunk))
        .orderBy(asc(schema.requiredUnits.token))
        .all(),
    );
  }
  const unitByToken = new Map(units.map((unit) => [unit.token, unit]));
  const creationRevisionIds = [...new Set(units.map((unit) => unit.createdInRevisionId))];
  const creationRevisions: Array<{ id: number; tenantId: string; profileId: number }> = [];
  for (const revisionIds of chunks(creationRevisionIds, ACCEPTED_TEXT_PAGE_SIZE)) {
    const preflight = db
      .select({
        id: schema.planRevisions.id,
        bytes: storedTextBytes(sqlite, [schema.planRevisions.tenantId]),
      })
      .from(schema.planRevisions)
      .where(inArray(schema.planRevisions.id, revisionIds))
      .orderBy(asc(schema.planRevisions.id))
      .all();
    for (const row of preflight) {
      validateStoredTextBytes(
        row.bytes,
        "required_unit_map",
        "Required-unit creation revision ownership is corrupt",
      );
    }
    creationRevisions.push(
      ...db
        .select({
          id: schema.planRevisions.id,
          tenantId: schema.planRevisions.tenantId,
          profileId: schema.planRevisions.profileId,
        })
        .from(schema.planRevisions)
        .where(inArray(schema.planRevisions.id, revisionIds))
        .orderBy(asc(schema.planRevisions.id))
        .all(),
    );
  }
  const creationById = new Map(creationRevisions.map((revision) => [revision.id, revision]));
  const partById = new Map(parts.map((part) => [part.value.revisionPartId, part]));
  const nextIndex = new Map<number, number>();
  const seenTokens = new Set<string>();
  const seenObjectNames = new Set<string>();
  const byPart = new Map<number, UnitWithoutProgress[]>();
  const digestRows = mappings.map((mapping) => {
    const part = partById.get(mapping.revisionPartId);
    const unit = unitByToken.get(mapping.requiredUnitToken);
    const creationRevision = unit ? creationById.get(unit.createdInRevisionId) : null;
    const expectedIndex = part ? (nextIndex.get(mapping.revisionPartId) ?? 0) : -1;
    if (
      mapping.tenantId !== tenantId ||
      mapping.revisionId !== revisionId ||
      !part ||
      mapping.unitIndex !== expectedIndex ||
      mapping.unitIndex >= part.quantityEffective ||
      seenTokens.has(mapping.requiredUnitToken) ||
      !unit ||
      unit.tenantId !== tenantId ||
      unit.profileId !== profileId ||
      !creationRevision ||
      creationRevision.tenantId !== tenantId ||
      creationRevision.profileId !== profileId
    ) {
      corrupt("required_unit_map", "Accepted Plan Required-unit ownership is corrupt");
    }
    validateStoredRequiredUnit(unit.token, unit.objectName);
    const objectNameKey = unit.objectName.toLowerCase();
    if (seenObjectNames.has(objectNameKey)) {
      corrupt("required_unit_map", "Accepted Plan Required-unit Object name is duplicated");
    }
    seenTokens.add(unit.token);
    seenObjectNames.add(objectNameKey);
    nextIndex.set(mapping.revisionPartId, expectedIndex + 1);
    const partUnits = byPart.get(mapping.revisionPartId) ?? [];
    partUnits.push({
      unitIndex: mapping.unitIndex,
      required: part.included,
      token: unit.token,
      objectName: unit.objectName,
    });
    byPart.set(mapping.revisionPartId, partUnits);
    return {
      revisionPartId: mapping.revisionPartId,
      unitIndex: mapping.unitIndex,
      token: unit.token,
      objectName: unit.objectName,
    };
  });
  for (const part of parts) {
    if ((nextIndex.get(part.value.revisionPartId) ?? 0) !== part.quantityEffective) {
      corrupt("required_unit_map", "Accepted Plan Required-unit coordinates are incomplete");
    }
  }
  let lastCreatedPreflightToken: string | null = null;
  while (true) {
    const page = db
      .select({
        token: schema.requiredUnits.token,
        bytes: storedTextBytes(sqlite, [
          schema.requiredUnits.token,
          schema.requiredUnits.tenantId,
          schema.requiredUnits.objectName,
          schema.requiredUnits.createdAt,
        ]),
      })
      .from(schema.requiredUnits)
      .where(
        lastCreatedPreflightToken == null
          ? eq(schema.requiredUnits.createdInRevisionId, revisionId)
          : and(
              eq(schema.requiredUnits.createdInRevisionId, revisionId),
              gt(schema.requiredUnits.token, lastCreatedPreflightToken),
            ),
      )
      .orderBy(asc(schema.requiredUnits.token))
      .limit(ACCEPTED_TEXT_PAGE_SIZE)
      .all();
    for (const row of page) {
      validateStoredTextBytes(
        row.bytes,
        "required_unit_map",
        "Accepted Plan Required-unit text is corrupt",
      );
    }
    if (page.length < ACCEPTED_TEXT_PAGE_SIZE) break;
    lastCreatedPreflightToken = page.at(-1)!.token;
  }
  const createdHere: Array<typeof defaultSchema.requiredUnits.$inferSelect> = [];
  let lastCreatedToken: string | null = null;
  while (true) {
    const page = db
      .select()
      .from(schema.requiredUnits)
      .where(
        lastCreatedToken == null
          ? eq(schema.requiredUnits.createdInRevisionId, revisionId)
          : and(
              eq(schema.requiredUnits.createdInRevisionId, revisionId),
              gt(schema.requiredUnits.token, lastCreatedToken),
            ),
      )
      .orderBy(asc(schema.requiredUnits.token))
      .limit(ACCEPTED_TEXT_PAGE_SIZE)
      .all();
    createdHere.push(...page);
    if (page.length < ACCEPTED_TEXT_PAGE_SIZE) break;
    lastCreatedToken = page.at(-1)!.token;
  }
  if (
    createdHere.some(
      (unit) =>
        unit.tenantId !== tenantId ||
        unit.profileId !== profileId ||
        !seenTokens.has(unit.token),
    )
  ) {
    corrupt("required_unit_map", "Accepted Plan Required unit is orphaned");
  }
  let digest: string;
  try {
    digest = digestRequiredUnitMap({
      revisionId,
      expectedUnitCount,
      rows: digestRows,
    });
  } catch {
    corrupt("required_unit_map", "Accepted Plan Required-unit digest input is corrupt");
  }
  if (digest !== requiredSet.mappingDigest) {
    corrupt("required_unit_map", "Accepted Plan Required-unit digest is corrupt");
  }
  return { mappingDigest: digest, byPart };
}

function loadProgress(input: {
  readonly db: DrizzleDb;
  readonly schema: AcceptedPlanOperationalSchema;
  readonly tenantId: string;
  readonly parts: readonly LoadedAcceptedPart[];
  readonly sqlite: boolean;
}): ReadonlyMap<string, { readonly completed: boolean; readonly assembled: boolean }> {
  const { db, schema, tenantId, parts } = input;
  const projectionIds = parts.map((part) => part.value.projectionPartId);
  if (projectionIds.length === 0) return new Map();
  const currentCoordinates = new Set(
    parts.flatMap((part) =>
      Array.from(
        { length: part.quantityEffective },
        (_, unitIndex) => `${part.value.projectionPartId}:${unitIndex}`,
      ),
    ),
  );
  const rows: Array<{
    id: number;
    tenantId: string;
    partId: number;
    unitIndex: number;
    completed: unknown;
    assembled: unknown;
  }> = [];
  for (const projectionIdChunk of chunks(projectionIds)) {
    let lastProgressPreflightId: number | null = null;
    while (true) {
      const page = db
        .select({
          id: schema.printProgress.id,
          bytes: storedTextBytes(input.sqlite, [schema.printProgress.tenantId]),
        })
        .from(schema.printProgress)
        .where(
          lastProgressPreflightId == null
            ? inArray(schema.printProgress.partId, projectionIdChunk)
            : and(
                inArray(schema.printProgress.partId, projectionIdChunk),
                gt(schema.printProgress.id, lastProgressPreflightId),
              ),
        )
        .orderBy(asc(schema.printProgress.id))
        .limit(ACCEPTED_READ_PAGE_SIZE)
        .all();
      for (const row of page) {
        validateStoredTextBytes(row.bytes, "progress", "Accepted Plan progress text is corrupt");
      }
      if (page.length < ACCEPTED_READ_PAGE_SIZE) break;
      lastProgressPreflightId = page.at(-1)!.id;
    }
    let lastProgressId: number | null = null;
    while (true) {
      const page = db
        .select({
          id: schema.printProgress.id,
          tenantId: schema.printProgress.tenantId,
          partId: schema.printProgress.partId,
          unitIndex: schema.printProgress.unitIndex,
          completed: sql<unknown>`${schema.printProgress.completed}`,
          assembled: sql<unknown>`${schema.printProgress.assembled}`,
        })
        .from(schema.printProgress)
        .where(
          lastProgressId == null
            ? inArray(schema.printProgress.partId, projectionIdChunk)
            : and(
                inArray(schema.printProgress.partId, projectionIdChunk),
                gt(schema.printProgress.id, lastProgressId),
              ),
        )
        .orderBy(asc(schema.printProgress.id))
        .limit(ACCEPTED_TEXT_PAGE_SIZE)
        .all();
      rows.push(...page);
      if (page.length < ACCEPTED_TEXT_PAGE_SIZE) break;
      lastProgressId = page.at(-1)!.id;
    }
  }
  const progress = new Map<string, { completed: boolean; assembled: boolean }>();
  for (const row of rows) {
    const key = `${row.partId}:${row.unitIndex}`;
    if (!currentCoordinates.has(key)) continue;
    const completed = storedBoolean(row.completed);
    const assembled = storedBoolean(row.assembled);
    if (
      row.tenantId !== tenantId ||
      progress.has(key) ||
      completed == null ||
      assembled == null ||
      (assembled && !completed)
    ) {
      corrupt("progress", "Accepted Plan progress is corrupt");
    }
    progress.set(key, { completed, assembled });
  }
  return progress;
}

type AcceptedTerminalIdentity = {
  readonly acceptedPlanRevisionId: number | null;
  readonly acceptedPlanVersion: number | null;
  readonly acceptedInputSetId: number | null;
  readonly acceptedInputAcceptedAt: string | null;
  readonly requiredUnitMappingDigest: string | null;
};

function readTerminalIdentity(
  input: AcceptedPlanOperationalReadDependencies,
): AcceptedTerminalIdentity {
  const row = input.db
    .select({
      acceptedPlanRevisionId: input.schema.buildProfiles.acceptedPlanRevisionId,
      acceptedPlanVersion: input.schema.buildProfiles.acceptedPlanVersion,
      acceptedInputSetId: input.schema.planAcceptedInputSets.inputSetId,
      acceptedInputAcceptedAt: input.schema.planAcceptedInputSets.acceptedAt,
      requiredUnitMappingDigest: input.schema.planRevisionRequiredUnitSets.mappingDigest,
    })
    .from(input.schema.buildProfiles)
    .leftJoin(
      input.schema.planAcceptedInputSets,
      eq(input.schema.planAcceptedInputSets.profileId, input.schema.buildProfiles.id),
    )
    .leftJoin(
      input.schema.planRevisionRequiredUnitSets,
      eq(
        input.schema.planRevisionRequiredUnitSets.revisionId,
        input.schema.buildProfiles.acceptedPlanRevisionId,
      ),
    )
    .where(eq(input.schema.buildProfiles.id, input.profileId))
    .get();
  return row ?? {
    acceptedPlanRevisionId: null,
    acceptedPlanVersion: null,
    acceptedInputSetId: null,
    acceptedInputAcceptedAt: null,
    requiredUnitMappingDigest: null,
  };
}

function terminalIdentityEqual(
  left: AcceptedTerminalIdentity,
  right: AcceptedTerminalIdentity,
): boolean {
  return (
    left.acceptedPlanRevisionId === right.acceptedPlanRevisionId &&
    left.acceptedPlanVersion === right.acceptedPlanVersion &&
    left.acceptedInputSetId === right.acceptedInputSetId &&
    left.acceptedInputAcceptedAt === right.acceptedInputAcceptedAt &&
    left.requiredUnitMappingDigest === right.requiredUnitMappingDigest
  );
}

function loadAcceptedPlanOperationalSnapshot(
  dependencies: AcceptedPlanOperationalReadDependencies,
): ReadAcceptedPlanOperationalSnapshotResult {
  const { db, schema, tenantId, profileId } = dependencies;
  const profileText = db
    .select({
      bytes: storedTextBytes(dependencies.sqlite, [
        schema.buildProfiles.tenantId,
        schema.buildProfiles.name,
        schema.buildProfiles.orderNumber,
        schema.buildProfiles.specialRequest,
        schema.buildProfiles.archivedAt,
      ]),
    })
    .from(schema.buildProfiles)
    .where(eq(schema.buildProfiles.id, profileId))
    .get();
  if (profileText) {
    validateStoredTextBytes(profileText.bytes, "pointer", "Accepted Plan Build text is corrupt");
  }
  const profile = db
    .select()
    .from(schema.buildProfiles)
    .where(eq(schema.buildProfiles.id, profileId))
    .get();
  if (!profile || profile.tenantId !== tenantId) throw new Error("Profile not found");
  if (!Number.isSafeInteger(profile.acceptedPlanVersion) || profile.acceptedPlanVersion < 0) {
    corrupt("pointer", "Accepted Plan pointer is corrupt");
  }
  const compatibilityPart = db
    .select({ id: schema.parts.id })
    .from(schema.parts)
    .where(eq(schema.parts.profileId, profileId))
    .get();
  const acceptedInputPointerText = db
    .select({
      bytes: storedTextBytes(dependencies.sqlite, [
        schema.planAcceptedInputSets.tenantId,
        schema.planAcceptedInputSets.acceptedAt,
      ]),
    })
    .from(schema.planAcceptedInputSets)
    .where(eq(schema.planAcceptedInputSets.profileId, profileId))
    .get();
  if (acceptedInputPointerText) {
    validateStoredTextBytes(
      acceptedInputPointerText.bytes,
      "accepted_inputs",
      "Accepted Plan input pointer text is corrupt",
    );
  }
  const acceptedInputs = db
    .select()
    .from(schema.planAcceptedInputSets)
    .where(eq(schema.planAcceptedInputSets.profileId, profileId))
    .all();
  if (profile.acceptedPlanRevisionId == null) {
    if (profile.acceptedPlanVersion === 0) {
      const historicalRevision = db
        .select({ id: schema.planRevisions.id })
        .from(schema.planRevisions)
        .where(eq(schema.planRevisions.profileId, profileId))
        .get();
      if (historicalRevision) corrupt("pointer", "Accepted Plan history has no pointer");
    }
    if (
      profile.acceptedPlanVersion > 0 ||
      compatibilityPart != null ||
      acceptedInputs.length > 0
    ) {
      return { kind: "compatibility_dirty" };
    }
    return { kind: "empty" };
  }
  if (profile.acceptedPlanVersion === 0) {
    corrupt("pointer", "Accepted Plan pointer has a zero version");
  }
  const revisionText = db
    .select({
      bytes: storedTextBytes(dependencies.sqlite, [
        schema.planRevisions.tenantId,
        schema.planRevisions.provenanceKind,
        schema.planRevisions.digestFormat,
        schema.planRevisions.snapshotDigest,
        schema.planRevisions.createdBy,
        schema.planRevisions.acceptedBy,
        schema.planRevisions.createdAt,
        schema.planRevisions.acceptedAt,
      ]),
    })
    .from(schema.planRevisions)
    .where(eq(schema.planRevisions.id, profile.acceptedPlanRevisionId))
    .get();
  if (revisionText) {
    validateStoredTextBytes(
      revisionText.bytes,
      "revision",
      "Accepted Plan revision text is corrupt",
    );
  }
  const revision = db
    .select()
    .from(schema.planRevisions)
    .where(eq(schema.planRevisions.id, profile.acceptedPlanRevisionId))
    .get();
  if (
    !revision ||
    revision.tenantId !== tenantId ||
    revision.profileId !== profileId ||
    !Number.isSafeInteger(revision.revisionNumber) ||
    revision.revisionNumber <= 0 ||
    revision.digestFormat !== PLAN_REVISION_DIGEST_FORMAT ||
    !isCanonicalTimestamp(revision.createdAt) ||
    !isCanonicalTimestamp(revision.acceptedAt) ||
    revision.createdBy.length === 0 ||
    revision.acceptedBy.length === 0
  ) {
    corrupt("revision", "Accepted Plan revision is corrupt");
  }
  if (
    (revision.provenanceKind === "legacy" && revision.inputSetId != null) ||
    (revision.provenanceKind === "tracked" && revision.inputSetId == null)
  ) {
    corrupt("revision", "Accepted Plan revision provenance is corrupt");
  }
  if (revision.parentRevisionId != null) {
    const parent = db
      .select({
        tenantId: schema.planRevisions.tenantId,
        profileId: schema.planRevisions.profileId,
      })
      .from(schema.planRevisions)
      .where(eq(schema.planRevisions.id, revision.parentRevisionId))
      .get();
    if (!parent || parent.tenantId !== tenantId || parent.profileId !== profileId) {
      corrupt("revision", "Accepted Plan revision parent is corrupt");
    }
  }
  let lastRevisionPartPreflightId: number | null = null;
  while (true) {
    const page = db
      .select({
        id: schema.planRevisionParts.id,
        bytes: storedTextBytes(dependencies.sqlite, [
          schema.planRevisionParts.tenantId,
          schema.planRevisionParts.partKey,
          schema.planRevisionParts.relativePath,
          schema.planRevisionParts.filename,
          schema.planRevisionParts.sourceLayer,
          schema.planRevisionParts.status,
          schema.planRevisionParts.roleInferred,
          schema.planRevisionParts.roleOverride,
          schema.planRevisionParts.filamentColorId,
          schema.planRevisionParts.filamentCustomHex,
          schema.planRevisionParts.spoolmanSpoolId,
          schema.planRevisionParts.notes,
          schema.planRevisionParts.githubBlobUrl,
          schema.planRevisionParts.requirement,
          schema.planRevisionParts.optionGroupId,
          schema.planRevisionParts.manifestSource,
          schema.planRevisionParts.artifactDigest,
        ]),
      })
      .from(schema.planRevisionParts)
      .where(
        lastRevisionPartPreflightId == null
          ? eq(schema.planRevisionParts.revisionId, revision.id)
          : and(
              eq(schema.planRevisionParts.revisionId, revision.id),
              gt(schema.planRevisionParts.id, lastRevisionPartPreflightId),
            ),
      )
      .orderBy(asc(schema.planRevisionParts.id))
      .limit(ACCEPTED_READ_PAGE_SIZE)
      .all();
    for (const row of page) {
      if (!isPositiveSafeInteger(row.id)) {
        corrupt("revision", "Accepted Plan revision Part ID is corrupt");
      }
      validateStoredTextBytes(
        row.bytes,
        "revision",
        "Accepted Plan revision Part text is corrupt",
      );
    }
    if (page.length < ACCEPTED_READ_PAGE_SIZE) break;
    lastRevisionPartPreflightId = page.at(-1)!.id;
  }
  const revisionParts: Array<typeof defaultSchema.planRevisionParts.$inferSelect> = [];
  let lastRevisionPartId: number | null = null;
  while (true) {
    const page = db
      .select()
      .from(schema.planRevisionParts)
      .where(
        lastRevisionPartId == null
          ? eq(schema.planRevisionParts.revisionId, revision.id)
          : and(
              eq(schema.planRevisionParts.revisionId, revision.id),
              gt(schema.planRevisionParts.id, lastRevisionPartId),
            ),
      )
      .orderBy(asc(schema.planRevisionParts.id))
      .limit(ACCEPTED_TEXT_PAGE_SIZE)
      .all();
    revisionParts.push(...page);
    if (page.length < ACCEPTED_TEXT_PAGE_SIZE) break;
    lastRevisionPartId = page.at(-1)!.id;
  }
  if (revisionParts.some((part) => part.tenantId !== tenantId)) {
    corrupt("revision", "Accepted Plan revision Part ownership is corrupt");
  }
  if (digestPlanRevisionParts(revisionDigestParts(revisionParts)) !== revision.snapshotDigest) {
    corrupt("revision_digest", "Accepted Plan revision digest is corrupt");
  }
  const inputState = loadAcceptedInputs({
    db,
    schema,
    tenantId,
    profileId,
    reposDir: dependencies.reposDir,
    sqlite: dependencies.sqlite,
    revision,
    acceptedInputs,
  });
  const parts = loadAcceptedParts({
    db,
    schema,
    tenantId,
    profileId,
    revisionParts,
    inputState,
    sqlite: dependencies.sqlite,
  });
  const requiredSetText = db
    .select({
      bytes: storedTextBytes(dependencies.sqlite, [
        schema.planRevisionRequiredUnitSets.tenantId,
        schema.planRevisionRequiredUnitSets.format,
        schema.planRevisionRequiredUnitSets.mappingDigest,
        schema.planRevisionRequiredUnitSets.createdAt,
      ]),
    })
    .from(schema.planRevisionRequiredUnitSets)
    .where(eq(schema.planRevisionRequiredUnitSets.revisionId, revision.id))
    .get();
  if (requiredSetText) {
    validateStoredTextBytes(
      requiredSetText.bytes,
      "required_unit_map",
      "Accepted Plan Required-unit header text is corrupt",
    );
  }
  const requiredSet = db
    .select()
    .from(schema.planRevisionRequiredUnitSets)
    .where(eq(schema.planRevisionRequiredUnitSets.revisionId, revision.id))
    .get();
  if (!requiredSet) {
    const mapping = db
      .select({ revisionId: schema.planRevisionRequiredUnits.revisionId })
      .from(schema.planRevisionRequiredUnits)
      .where(eq(schema.planRevisionRequiredUnits.revisionId, revision.id))
      .get();
    const createdUnit = db
      .select({ token: schema.requiredUnits.token })
      .from(schema.requiredUnits)
      .where(eq(schema.requiredUnits.createdInRevisionId, revision.id))
      .get();
    if (mapping || createdUnit) {
      corrupt("required_unit_map", "Accepted Plan Required-unit set is partial");
    }
    return { kind: "uninitialized" };
  }
  const mapped = loadRequiredUnits({
    db,
    schema,
    tenantId,
    profileId,
    revisionId: revision.id,
    requiredSet,
    parts,
    sqlite: dependencies.sqlite,
  });
  if (inputState.kind === "format1") return { kind: "uninitialized" };
  const progressByCoordinate = loadProgress({
    db,
    schema,
    tenantId,
    parts,
    sqlite: dependencies.sqlite,
  });
  return {
    kind: "ready",
    snapshot: {
      format: "accepted-plan-operational-v1",
      profile: {
        id: profile.id,
        name: profile.name,
        orderNumber: profile.orderNumber,
        specialRequest: profile.specialRequest,
        archivedAt: profile.archivedAt,
      },
      planVersion: profile.acceptedPlanVersion,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      revisionDigest: revision.snapshotDigest,
      acceptedAt: revision.acceptedAt,
      provenance:
        inputState.kind === "legacy"
          ? { kind: "legacy" }
          : {
              kind: "tracked",
              inputSetId: inputState.inputSetId,
              inputSetDigest: inputState.inputSetDigest,
              inputs: inputState.inputs,
            },
      requiredUnitMappingDigest: mapped.mappingDigest,
      parts: parts.map((part) => ({
        ...part.value,
        units: mapped.byPart.get(part.value.revisionPartId)!.map((unit) => {
          const progress = progressByCoordinate.get(
            `${part.value.projectionPartId}:${unit.unitIndex}`,
          );
          return {
            ...unit,
            completed: progress?.completed ?? false,
            assembled: progress?.assembled ?? false,
          };
        }),
      })),
    },
  };
}

export function readAcceptedPlanOperationalSnapshotInternal(
  dependencies: AcceptedPlanOperationalReadDependencies,
): ReadAcceptedPlanOperationalSnapshotResult {
  const load = () => loadAcceptedPlanOperationalSnapshot(dependencies);
  if (dependencies.sqlite) return load();
  const firstIdentity = readTerminalIdentity(dependencies);
  const first = load();
  if (terminalIdentityEqual(firstIdentity, readTerminalIdentity(dependencies))) return first;
  const secondIdentity = readTerminalIdentity(dependencies);
  const second = load();
  if (terminalIdentityEqual(secondIdentity, readTerminalIdentity(dependencies))) return second;
  corrupt("pointer", "Accepted Plan identity changed during verification");
}

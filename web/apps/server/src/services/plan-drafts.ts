import { createHash } from "node:crypto";

export const PLAN_DRAFT_DIGEST_FORMAT = "plan-draft-v1";

export type PlanDraftState = "open" | "abandoned" | "consumed";

export type PlanSnapshotInput = {
  sourceId: number;
  sourceLayer: string;
  layerOrder: number;
  trackingKind: "revision" | "untracked";
  sourceRevisionId: number | null;
  manifestDigest: string | null;
  effectiveNamingDigest: string;
};

export type PlanSnapshotPart = {
  partKey: string;
  relativePath: string;
  filename: string;
  sourceLayer: string;
  status: string;
  roleInferred: string;
  roleOverride: string | null;
  filamentColorId: string | null;
  filamentCustomHex: string | null;
  spoolmanSpoolId: string | null;
  quantityInferred: number;
  quantityOverride: number | null;
  quantityEffective: number;
  included: boolean;
  notes: string;
  githubBlobUrl: string | null;
  geometrySame: boolean | null;
  requirement: string | null;
  optionGroupId: string | null;
  manifestSource: string | null;
  artifactDigest: string | null;
};

export type PlanDraftInput = PlanSnapshotInput & { id: number; draftId: number };
export type PlanDraftPart = PlanSnapshotPart & {
  id: number;
  draftId: number;
  baseRevisionPartId: number | null;
};

export type PlanDraftSnapshot = {
  id: number;
  profileId: number;
  baseRevisionId: number | null;
  basePlanVersion: number;
  state: PlanDraftState;
  digestFormat: string;
  snapshotDigest: string;
  createdBy: string;
  idempotencyKey: string;
  createdAt: string;
  inputs: PlanDraftInput[];
  parts: PlanDraftPart[];
};

type BasePart = PlanSnapshotPart & { id: number };

export type PlanDraftDiff = {
  baseRevisionId: number | null;
  basePlanVersion: number;
  baseIsCurrent: boolean;
  inputs: {
    added: PlanDraftInput[];
    removed: PlanSnapshotInput[];
    changed: Array<{ before: PlanSnapshotInput; after: PlanDraftInput }>;
  };
  parts: {
    added: Array<{ after: PlanDraftPart }>;
    removed: Array<{ before: BasePart }>;
    changed: Array<{ before: BasePart; after: PlanDraftPart; fields: string[] }>;
  };
};

function compareSerialized(left: unknown, right: unknown): number {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

function canonicalInputs(inputs: readonly PlanSnapshotInput[]): PlanSnapshotInput[] {
  return inputs
    .map((input) => ({
      sourceId: input.sourceId,
      sourceLayer: input.sourceLayer,
      layerOrder: input.layerOrder,
      trackingKind: input.trackingKind,
      sourceRevisionId: input.sourceRevisionId,
      manifestDigest: input.manifestDigest,
      effectiveNamingDigest: input.effectiveNamingDigest,
    }))
    .sort(
      (left, right) =>
        left.layerOrder - right.layerOrder ||
        left.sourceId - right.sourceId ||
        compareSerialized(left, right),
    );
}

type DigestPart = PlanSnapshotPart & { baseRevisionPartId: number | null };

function canonicalParts(parts: readonly DigestPart[]): DigestPart[] {
  return parts
    .map((part) => ({
      baseRevisionPartId: part.baseRevisionPartId,
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
    }))
    .sort(compareSerialized);
}

export function digestPlanDraft(input: {
  baseRevisionId: number | null;
  basePlanVersion: number;
  inputs: readonly PlanSnapshotInput[];
  parts: readonly DigestPart[];
}): string {
  const canonical = JSON.stringify({
    format: PLAN_DRAFT_DIGEST_FORMAT,
    base_revision_id: input.baseRevisionId,
    base_plan_version: input.basePlanVersion,
    inputs: canonicalInputs(input.inputs),
    parts: canonicalParts(input.parts),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function changedFields(before: PlanSnapshotPart, after: PlanSnapshotPart): string[] {
  const fields: Array<keyof PlanSnapshotPart> = [
    "partKey",
    "relativePath",
    "filename",
    "sourceLayer",
    "status",
    "roleInferred",
    "roleOverride",
    "filamentColorId",
    "filamentCustomHex",
    "spoolmanSpoolId",
    "quantityInferred",
    "quantityOverride",
    "quantityEffective",
    "included",
    "notes",
    "githubBlobUrl",
    "geometrySame",
    "requirement",
    "optionGroupId",
    "manifestSource",
    "artifactDigest",
  ];
  return fields.filter((field) => before[field] !== after[field]);
}

export function diffPlanDraftSnapshot(input: {
  draft: PlanDraftSnapshot;
  baseInputs: readonly PlanSnapshotInput[];
  baseParts: readonly BasePart[];
  baseIsCurrent: boolean;
}): PlanDraftDiff {
  const baseInputsBySource = new Map(input.baseInputs.map((row) => [row.sourceId, row]));
  const draftInputsBySource = new Map(input.draft.inputs.map((row) => [row.sourceId, row]));
  const addedInputs = input.draft.inputs.filter((row) => !baseInputsBySource.has(row.sourceId));
  const removedInputs = input.baseInputs.filter((row) => !draftInputsBySource.has(row.sourceId));
  const changedInputs = input.draft.inputs.flatMap((after) => {
    const before = baseInputsBySource.get(after.sourceId);
    if (!before) return [];
    const comparableAfter: PlanSnapshotInput = {
      sourceId: after.sourceId,
      sourceLayer: after.sourceLayer,
      layerOrder: after.layerOrder,
      trackingKind: after.trackingKind,
      sourceRevisionId: after.sourceRevisionId,
      manifestDigest: after.manifestDigest,
      effectiveNamingDigest: after.effectiveNamingDigest,
    };
    return compareSerialized(before, comparableAfter) === 0 ? [] : [{ before, after }];
  });

  const basePartsById = new Map(input.baseParts.map((row) => [row.id, row]));
  const linkedBaseIds = new Set<number>();
  const addedParts: Array<{ after: PlanDraftPart }> = [];
  const changedParts: Array<{
    before: BasePart;
    after: PlanDraftPart;
    fields: string[];
  }> = [];
  for (const after of input.draft.parts) {
    const before =
      after.baseRevisionPartId == null
        ? undefined
        : basePartsById.get(after.baseRevisionPartId);
    if (!before) {
      addedParts.push({ after });
      continue;
    }
    linkedBaseIds.add(before.id);
    const fields = changedFields(before, after);
    if (fields.length) changedParts.push({ before, after, fields });
  }

  return {
    baseRevisionId: input.draft.baseRevisionId,
    basePlanVersion: input.draft.basePlanVersion,
    baseIsCurrent: input.baseIsCurrent,
    inputs: {
      added: [...addedInputs].sort(
        (left, right) => left.layerOrder - right.layerOrder || left.sourceId - right.sourceId,
      ),
      removed: canonicalInputs(removedInputs),
      changed: changedInputs.sort((left, right) => left.after.sourceId - right.after.sourceId),
    },
    parts: {
      added: addedParts.sort((left, right) => compareSerialized(left.after, right.after)),
      removed: input.baseParts
        .filter((row) => !linkedBaseIds.has(row.id))
        .sort(compareSerialized)
        .map((before) => ({ before })),
      changed: changedParts.sort((left, right) => compareSerialized(left.after, right.after)),
    },
  };
}

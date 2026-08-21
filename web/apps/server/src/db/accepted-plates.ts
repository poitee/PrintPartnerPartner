import { and, asc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { DrizzleDb } from "./client.js";
import * as defaultSchema from "./schema.js";
import {
  readAcceptedPlanOperationalSnapshotInternal,
  type AcceptedPlanOperationalSnapshot,
} from "./accepted-plan-operational.js";
import { acceptedPlanBasis, type AcceptedPlanBasis } from "./accepted-plan-progress.js";
import { parseRequiredUnitToken } from "../services/required-units.js";

export const MAX_ACCEPTED_PLATE_UM = 2_147_483_647;
export const ACCEPTED_PLATE_LAYOUT_FORMAT = 1;

export class AcceptedPlateIntegrityError extends Error {
  readonly name = "AcceptedPlateIntegrityError";

  constructor(readonly code: "head" | "revision" | "counts" | "layout_digest" | "layout") {
    super(`Accepted Plate integrity check failed: ${code}`);
  }
}

export type AcceptedPlateUnitInput = Readonly<{
  token: string;
  xUm: number;
  yUm: number;
  widthUm: number;
  depthUm: number;
  heightUm: number;
}>;

export type AcceptedPlateInput = Readonly<{
  plateId: string;
  printerId: string;
  printerName: string;
  printerModel: string;
  bedWidthUm: number;
  bedDepthUm: number;
  bedHeightUm: number;
  marginUm: number;
  units: readonly AcceptedPlateUnitInput[];
}>;

export type AcceptedPlate = Omit<AcceptedPlateInput, "units"> &
  Readonly<{
    ordinal: number;
    units: readonly (AcceptedPlateUnitInput & Readonly<{ objectName: string }>)[];
  }>;

export type PublishAcceptedPlatesCommand = Readonly<{
  profileId: number;
  expected: AcceptedPlanBasis;
  expectedPlateRevisionId: number | null;
  plates: readonly AcceptedPlateInput[];
}>;

export type MoveAcceptedPlateUnitCommand = Readonly<{
  profileId: number;
  expected: AcceptedPlanBasis;
  expectedPlateRevisionId: number;
  plateId: string;
  token: string;
  xUm: number;
  yUm: number;
}>;

type AcceptedPlateFailure =
  | { readonly kind: "accepted_state_unavailable"; readonly reason: "compatibility_dirty" | "uninitialized" }
  | { readonly kind: "stale_accepted_plan" }
  | { readonly kind: "plan_archived" }
  | { readonly kind: "invalid_units" }
  | {
      readonly kind: "invalid_geometry";
      readonly reason: "outside_build_area" | "overlap";
    }
  | { readonly kind: "transaction_unavailable" };

export type PublishAcceptedPlatesResult =
  | {
      readonly kind: "published";
      readonly plateRevisionId: number;
      readonly plateRevisionNumber: number;
    }
  | { readonly kind: "unchanged"; readonly plateRevisionId: number }
  | { readonly kind: "plate_revision_changed" }
  | AcceptedPlateFailure;

export type MoveAcceptedPlateUnitResult =
  | {
      readonly kind: "moved";
      readonly plateRevisionId: number;
      readonly plateRevisionNumber: number;
    }
  | { readonly kind: "unchanged"; readonly plateRevisionId: number }
  | { readonly kind: "plate_revision_changed" | "unit_not_found" }
  | AcceptedPlateFailure;

export type ReadAcceptedPlatesResult =
  | {
      readonly kind: "empty";
      readonly basis: AcceptedPlanBasis;
      readonly plates: readonly [];
    }
  | {
      readonly kind: "ready";
      readonly basis: AcceptedPlanBasis;
      readonly plateRevisionId: number;
      readonly plateRevisionNumber: number;
      readonly plates: readonly AcceptedPlate[];
    }
  | { readonly kind: "empty_plan" }
  | { readonly kind: "stale_accepted_plan" }
  | { readonly kind: "accepted_state_unavailable"; readonly reason: "compatibility_dirty" | "uninitialized" }
  | { readonly kind: "transaction_unavailable" };

export type AcceptedPlateSchema = Pick<
  typeof defaultSchema,
  | "acceptedPlateHeads"
  | "acceptedPlateRevisions"
  | "acceptedPlates"
  | "acceptedPlateUnits"
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

export type AcceptedPlateDependencies = Readonly<{
  db: DrizzleDb;
  schema: AcceptedPlateSchema;
  tenantId: string;
  reposDir: string;
  sqlite: boolean;
  transaction: <T>(operation: () => T) => T;
  readTransaction: <T>(operation: () => T) => T;
  clock?: () => Date;
}>;

function sameBasis(snapshot: AcceptedPlanOperationalSnapshot, expected: AcceptedPlanBasis): boolean {
  const actual = acceptedPlanBasis(snapshot);
  return (
    actual.profileId === expected.profileId &&
    actual.planVersion === expected.planVersion &&
    actual.revisionId === expected.revisionId &&
    actual.revisionDigest === expected.revisionDigest &&
    actual.requiredUnitMappingDigest === expected.requiredUnitMappingDigest
  );
}

function visibleProfile(dependencies: AcceptedPlateDependencies, profileId: number): boolean {
  return (
    dependencies.db
      .select({ id: dependencies.schema.buildProfiles.id })
      .from(dependencies.schema.buildProfiles)
      .where(
        and(
          eq(dependencies.schema.buildProfiles.tenantId, dependencies.tenantId),
          eq(dependencies.schema.buildProfiles.id, profileId),
        ),
      )
      .get() != null
  );
}

function currentAccepted(
  dependencies: AcceptedPlateDependencies,
  expected: AcceptedPlanBasis,
):
  | { readonly kind: "ready"; readonly snapshot: AcceptedPlanOperationalSnapshot }
  | AcceptedPlateFailure {
  if (!visibleProfile(dependencies, expected.profileId)) return { kind: "stale_accepted_plan" };
  const accepted = readAcceptedPlanOperationalSnapshotInternal({
    db: dependencies.db,
    schema: dependencies.schema,
    tenantId: dependencies.tenantId,
    profileId: expected.profileId,
    reposDir: dependencies.reposDir,
    sqlite: dependencies.sqlite,
  });
  if (accepted.kind === "empty") return { kind: "stale_accepted_plan" };
  if (accepted.kind !== "ready") {
    return { kind: "accepted_state_unavailable", reason: accepted.kind };
  }
  if (!sameBasis(accepted.snapshot, expected)) return { kind: "stale_accepted_plan" };
  if (accepted.snapshot.profile.archivedAt != null) return { kind: "plan_archived" };
  return accepted;
}

function requiredObjectNames(snapshot: AcceptedPlanOperationalSnapshot): Map<string, string> {
  return new Map(
    snapshot.parts
      .filter((part) => part.included)
      .flatMap((part) => part.units)
      .filter((unit) => unit.required)
      .map((unit) => [unit.token, unit.objectName]),
  );
}

function storedInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_ACCEPTED_PLATE_UM;
}

function normalizedText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

type ValidatedPlate = AcceptedPlateInput & Readonly<{ ordinal: number }>;

function validatePlates(
  plates: readonly AcceptedPlateInput[],
  expectedTokens: ReadonlySet<string>,
): { readonly kind: "ready"; readonly plates: readonly ValidatedPlate[] } | AcceptedPlateFailure {
  if (plates.length === 0 || expectedTokens.size === 0) return { kind: "invalid_units" };
  const seenPlates = new Set<string>();
  const seenTokens = new Set<string>();
  const normalized: ValidatedPlate[] = [];
  for (const [index, plate] of plates.entries()) {
    const plateId = normalizedText(plate.plateId);
    const printerId = normalizedText(plate.printerId);
    const printerName = normalizedText(plate.printerName);
    const printerModel = normalizedText(plate.printerModel);
    if (!plateId || !printerId || !printerName || !printerModel || seenPlates.has(plateId)) {
      return { kind: "invalid_units" };
    }
    seenPlates.add(plateId);
    if (
      !storedInteger(plate.bedWidthUm) ||
      plate.bedWidthUm <= 0 ||
      !storedInteger(plate.bedDepthUm) ||
      plate.bedDepthUm <= 0 ||
      !storedInteger(plate.bedHeightUm) ||
      plate.bedHeightUm <= 0 ||
      !storedInteger(plate.marginUm) ||
      plate.marginUm < 0 ||
      plate.marginUm > Math.floor(plate.bedWidthUm / 2) ||
      plate.marginUm > Math.floor(plate.bedDepthUm / 2)
    ) {
      return { kind: "invalid_geometry", reason: "outside_build_area" };
    }
    const units: AcceptedPlateUnitInput[] = [];
    for (const unit of plate.units) {
      try {
        parseRequiredUnitToken(unit.token);
      } catch {
        return { kind: "invalid_units" };
      }
      if (!expectedTokens.has(unit.token) || seenTokens.has(unit.token)) {
        return { kind: "invalid_units" };
      }
      seenTokens.add(unit.token);
      if (
        !storedInteger(unit.xUm) ||
        !storedInteger(unit.yUm) ||
        !storedInteger(unit.widthUm) ||
        !storedInteger(unit.depthUm) ||
        !storedInteger(unit.heightUm) ||
        unit.widthUm <= 0 ||
        unit.depthUm <= 0 ||
        unit.heightUm <= 0 ||
        unit.xUm < plate.marginUm ||
        unit.yUm < plate.marginUm ||
        unit.xUm > plate.bedWidthUm - plate.marginUm ||
        unit.widthUm > plate.bedWidthUm - plate.marginUm - unit.xUm ||
        unit.yUm > plate.bedDepthUm - plate.marginUm ||
        unit.depthUm > plate.bedDepthUm - plate.marginUm - unit.yUm ||
        unit.heightUm > plate.bedHeightUm
      ) {
        return { kind: "invalid_geometry", reason: "outside_build_area" };
      }
      units.push({ ...unit });
    }
    for (let leftIndex = 0; leftIndex < units.length; leftIndex += 1) {
      const left = units[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < units.length; rightIndex += 1) {
        const right = units[rightIndex]!;
        if (
          left.xUm < right.xUm + right.widthUm &&
          right.xUm < left.xUm + left.widthUm &&
          left.yUm < right.yUm + right.depthUm &&
          right.yUm < left.yUm + left.depthUm
        ) {
          return { kind: "invalid_geometry", reason: "overlap" };
        }
      }
    }
    normalized.push({
      ...plate,
      plateId,
      printerId,
      printerName,
      printerModel,
      ordinal: index + 1,
      units,
    });
  }
  if (seenTokens.size !== expectedTokens.size) return { kind: "invalid_units" };
  return { kind: "ready", plates: normalized };
}

function layoutDigest(plates: readonly ValidatedPlate[]): string {
  const canonical = {
    format: ACCEPTED_PLATE_LAYOUT_FORMAT,
    plates: plates.map((plate) => ({
      ordinal: plate.ordinal,
      plateId: plate.plateId,
      printerId: plate.printerId,
      printerName: plate.printerName,
      printerModel: plate.printerModel,
      bedWidthUm: plate.bedWidthUm,
      bedDepthUm: plate.bedDepthUm,
      bedHeightUm: plate.bedHeightUm,
      marginUm: plate.marginUm,
      units: [...plate.units]
        .sort((left, right) => left.token.localeCompare(right.token))
        .map((unit) => ({
          token: unit.token,
          xUm: unit.xUm,
          yUm: unit.yUm,
          widthUm: unit.widthUm,
          depthUm: unit.depthUm,
          heightUm: unit.heightUm,
        })),
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function insertRevision(
  dependencies: AcceptedPlateDependencies,
  snapshot: AcceptedPlanOperationalSnapshot,
  revisionNumber: number,
  plates: readonly ValidatedPlate[],
): number {
  const unitCount = plates.reduce((count, plate) => count + plate.units.length, 0);
  const created = dependencies.db
    .insert(dependencies.schema.acceptedPlateRevisions)
    .values({
      tenantId: dependencies.tenantId,
      profileId: snapshot.profile.id,
      planRevisionId: snapshot.revisionId,
      planVersion: snapshot.planVersion,
      planRevisionDigest: snapshot.revisionDigest,
      requiredUnitMappingDigest: snapshot.requiredUnitMappingDigest,
      layoutDigest: layoutDigest(plates),
      expectedPlateCount: plates.length,
      expectedUnitCount: unitCount,
      revisionNumber,
      createdAt: (dependencies.clock?.() ?? new Date()).toISOString(),
    })
    .returning({ id: dependencies.schema.acceptedPlateRevisions.id })
    .get();
  if (!created) throw new Error("Accepted Plate revision could not be created");
  for (const plate of plates) {
    dependencies.db
      .insert(dependencies.schema.acceptedPlates)
      .values({
        tenantId: dependencies.tenantId,
        revisionId: created.id,
        plateId: plate.plateId,
        ordinal: plate.ordinal,
        printerId: plate.printerId,
        printerName: plate.printerName,
        printerModel: plate.printerModel,
        bedWidthUm: plate.bedWidthUm,
        bedDepthUm: plate.bedDepthUm,
        bedHeightUm: plate.bedHeightUm,
        marginUm: plate.marginUm,
      })
      .run();
    for (const unit of plate.units) {
      dependencies.db
        .insert(dependencies.schema.acceptedPlateUnits)
        .values({
          tenantId: dependencies.tenantId,
          revisionId: created.id,
          plateId: plate.plateId,
          requiredUnitToken: unit.token,
          xUm: unit.xUm,
          yUm: unit.yUm,
          widthUm: unit.widthUm,
          depthUm: unit.depthUm,
          heightUm: unit.heightUm,
        })
        .run();
    }
  }
  return created.id;
}

function readStoredPlates(
  dependencies: AcceptedPlateDependencies,
  revisionId: number,
  expectedPlateCount: number,
  expectedUnitCount: number,
  expectedTokens: ReadonlySet<string>,
  expectedDigest: string,
): readonly ValidatedPlate[] {
  const units = dependencies.db
    .select()
    .from(dependencies.schema.acceptedPlateUnits)
    .where(eq(dependencies.schema.acceptedPlateUnits.revisionId, revisionId))
    .orderBy(asc(dependencies.schema.acceptedPlateUnits.requiredUnitToken))
    .all();
  const plateRows = dependencies.db
    .select()
    .from(dependencies.schema.acceptedPlates)
    .where(eq(dependencies.schema.acceptedPlates.revisionId, revisionId))
    .orderBy(asc(dependencies.schema.acceptedPlates.ordinal))
    .all();
  if (plateRows.length !== expectedPlateCount || units.length !== expectedUnitCount) {
    throw new AcceptedPlateIntegrityError("counts");
  }
  if (
    plateRows.some((plate) => plate.tenantId !== dependencies.tenantId) ||
    units.some((unit) => unit.tenantId !== dependencies.tenantId)
  ) {
    throw new AcceptedPlateIntegrityError("layout");
  }
  const plateIds = new Set(plateRows.map((plate) => plate.plateId));
  if (units.some((unit) => !plateIds.has(unit.plateId))) {
    throw new AcceptedPlateIntegrityError("layout");
  }
  if (plateRows.some((plate, index) => plate.ordinal !== index + 1)) {
    throw new AcceptedPlateIntegrityError("layout");
  }
  const stored: AcceptedPlateInput[] = plateRows.map((plate) => ({
    plateId: plate.plateId,
    printerId: plate.printerId,
    printerName: plate.printerName,
    printerModel: plate.printerModel,
    bedWidthUm: plate.bedWidthUm,
    bedDepthUm: plate.bedDepthUm,
    bedHeightUm: plate.bedHeightUm,
    marginUm: plate.marginUm,
    units: units
      .filter((unit) => unit.plateId === plate.plateId)
      .map((unit) => ({
        token: unit.requiredUnitToken,
        xUm: unit.xUm,
        yUm: unit.yUm,
        widthUm: unit.widthUm,
        depthUm: unit.depthUm,
        heightUm: unit.heightUm,
      })),
  }));
  const validated = validatePlates(stored, expectedTokens);
  if (validated.kind !== "ready") throw new AcceptedPlateIntegrityError("layout");
  if (layoutDigest(validated.plates) !== expectedDigest) {
    throw new AcceptedPlateIntegrityError("layout_digest");
  }
  return validated.plates;
}

export function readAcceptedPlatesInternal(
  dependencies: AcceptedPlateDependencies,
  profileId: number,
): ReadAcceptedPlatesResult {
  if (!dependencies.sqlite) return { kind: "transaction_unavailable" };
  return dependencies.readTransaction(() => {
    if (!visibleProfile(dependencies, profileId)) return { kind: "empty_plan" };
    const accepted = readAcceptedPlanOperationalSnapshotInternal({
      db: dependencies.db,
      schema: dependencies.schema,
      tenantId: dependencies.tenantId,
      profileId,
      reposDir: dependencies.reposDir,
      sqlite: dependencies.sqlite,
    });
    if (accepted.kind === "empty") return { kind: "empty_plan" };
    if (accepted.kind !== "ready") {
      return { kind: "accepted_state_unavailable", reason: accepted.kind };
    }
    const basis = acceptedPlanBasis(accepted.snapshot);
    const head = dependencies.db
      .select()
      .from(dependencies.schema.acceptedPlateHeads)
      .where(
        and(
          eq(dependencies.schema.acceptedPlateHeads.tenantId, dependencies.tenantId),
          eq(dependencies.schema.acceptedPlateHeads.profileId, profileId),
        ),
      )
      .get();
    if (!head) return { kind: "empty", basis, plates: [] };
    const revision = dependencies.db
      .select()
      .from(dependencies.schema.acceptedPlateRevisions)
      .where(
        and(
          eq(dependencies.schema.acceptedPlateRevisions.tenantId, dependencies.tenantId),
          eq(dependencies.schema.acceptedPlateRevisions.profileId, profileId),
          eq(dependencies.schema.acceptedPlateRevisions.id, head.currentRevisionId),
        ),
      )
      .get();
    if (!revision) throw new AcceptedPlateIntegrityError("head");
    if (
      revision.planRevisionId !== basis.revisionId ||
      revision.planVersion !== basis.planVersion ||
      revision.planRevisionDigest !== basis.revisionDigest ||
      revision.requiredUnitMappingDigest !== basis.requiredUnitMappingDigest
    ) {
      return { kind: "stale_accepted_plan" };
    }
    if (
      !storedInteger(revision.expectedPlateCount) ||
      revision.expectedPlateCount === 0 ||
      !storedInteger(revision.expectedUnitCount) ||
      revision.expectedUnitCount === 0 ||
      !/^[a-f0-9]{64}$/.test(revision.layoutDigest)
    ) {
      throw new AcceptedPlateIntegrityError("revision");
    }
    const objectNames = requiredObjectNames(accepted.snapshot);
    const stored = readStoredPlates(
      dependencies,
      revision.id,
      revision.expectedPlateCount,
      revision.expectedUnitCount,
      new Set(objectNames.keys()),
      revision.layoutDigest,
    );
    return {
      kind: "ready",
      basis,
      plateRevisionId: revision.id,
      plateRevisionNumber: revision.revisionNumber,
      plates: stored.map((plate) => ({
        ...plate,
        units: plate.units.map((unit) => {
          const objectName = objectNames.get(unit.token);
          if (!objectName) throw new AcceptedPlateIntegrityError("layout");
          return { ...unit, objectName };
        }),
      })),
    };
  });
}

export function publishAcceptedPlatesInternal(
  dependencies: AcceptedPlateDependencies,
  command: PublishAcceptedPlatesCommand,
): PublishAcceptedPlatesResult {
  if (!dependencies.sqlite) return { kind: "transaction_unavailable" };
  if (command.profileId !== command.expected.profileId) return { kind: "stale_accepted_plan" };
  return dependencies.transaction(() => {
    const accepted = currentAccepted(dependencies, command.expected);
    if (accepted.kind !== "ready") return accepted;
    const objectNames = requiredObjectNames(accepted.snapshot);
    const validated = validatePlates(command.plates, new Set(objectNames.keys()));
    if (validated.kind !== "ready") return validated;
    const digest = layoutDigest(validated.plates);
    const expectedPlateRevisionId = command.expectedPlateRevisionId;
    const head = dependencies.db
      .select()
      .from(dependencies.schema.acceptedPlateHeads)
      .where(
        and(
          eq(dependencies.schema.acceptedPlateHeads.tenantId, dependencies.tenantId),
          eq(dependencies.schema.acceptedPlateHeads.profileId, command.profileId),
        ),
      )
      .get();
    if (head) {
      const currentRevision = dependencies.db
        .select()
        .from(dependencies.schema.acceptedPlateRevisions)
        .where(
          and(
            eq(dependencies.schema.acceptedPlateRevisions.tenantId, dependencies.tenantId),
            eq(dependencies.schema.acceptedPlateRevisions.profileId, command.profileId),
            eq(dependencies.schema.acceptedPlateRevisions.id, head.currentRevisionId),
          ),
        )
        .get();
      if (!currentRevision) throw new AcceptedPlateIntegrityError("head");
      const sameAcceptedBasis =
        currentRevision.planRevisionId === accepted.snapshot.revisionId &&
        currentRevision.planVersion === accepted.snapshot.planVersion &&
        currentRevision.planRevisionDigest === accepted.snapshot.revisionDigest &&
        currentRevision.requiredUnitMappingDigest === accepted.snapshot.requiredUnitMappingDigest;
      if (sameAcceptedBasis) {
        readStoredPlates(
          dependencies,
          currentRevision.id,
          currentRevision.expectedPlateCount,
          currentRevision.expectedUnitCount,
          new Set(objectNames.keys()),
          currentRevision.layoutDigest,
        );
        if (currentRevision.layoutDigest === digest) {
          return { kind: "unchanged", plateRevisionId: currentRevision.id };
        }
      }
      if (head.currentRevisionId !== expectedPlateRevisionId) {
        return { kind: "plate_revision_changed" };
      }
    } else if (expectedPlateRevisionId !== null) {
      return { kind: "plate_revision_changed" };
    }
    const revisionNumber =
      dependencies.db
        .select({
          value: sql<number>`COALESCE(MAX(${dependencies.schema.acceptedPlateRevisions.revisionNumber}), 0) + 1`,
        })
        .from(dependencies.schema.acceptedPlateRevisions)
        .where(
          and(
            eq(dependencies.schema.acceptedPlateRevisions.tenantId, dependencies.tenantId),
            eq(dependencies.schema.acceptedPlateRevisions.profileId, command.profileId),
          ),
        )
        .get()?.value ?? 1;
    const revisionId = insertRevision(
      dependencies,
      accepted.snapshot,
      revisionNumber,
      validated.plates,
    );
    if (head) {
      if (expectedPlateRevisionId === null) throw new Error("Accepted Plate CAS is unavailable");
      const updated = dependencies.db
        .update(dependencies.schema.acceptedPlateHeads)
        .set({ currentRevisionId: revisionId })
        .where(
          and(
            eq(dependencies.schema.acceptedPlateHeads.tenantId, dependencies.tenantId),
            eq(dependencies.schema.acceptedPlateHeads.profileId, command.profileId),
            eq(
              dependencies.schema.acceptedPlateHeads.currentRevisionId,
              expectedPlateRevisionId,
            ),
          ),
        )
        .run();
      if (updated.changes !== 1) throw new Error("Accepted Plate head update failed");
    } else {
      dependencies.db
        .insert(dependencies.schema.acceptedPlateHeads)
        .values({
          tenantId: dependencies.tenantId,
          profileId: command.profileId,
          currentRevisionId: revisionId,
        })
        .run();
    }
    return { kind: "published", plateRevisionId: revisionId, plateRevisionNumber: revisionNumber };
  });
}

export function moveAcceptedPlateUnitInternal(
  dependencies: AcceptedPlateDependencies,
  command: MoveAcceptedPlateUnitCommand,
): MoveAcceptedPlateUnitResult {
  if (!dependencies.sqlite) return { kind: "transaction_unavailable" };
  if (command.profileId !== command.expected.profileId) return { kind: "stale_accepted_plan" };
  return dependencies.transaction(() => {
    const accepted = currentAccepted(dependencies, command.expected);
    if (accepted.kind !== "ready") return accepted;
    const head = dependencies.db
      .select()
      .from(dependencies.schema.acceptedPlateHeads)
      .where(
        and(
          eq(dependencies.schema.acceptedPlateHeads.tenantId, dependencies.tenantId),
          eq(dependencies.schema.acceptedPlateHeads.profileId, command.profileId),
        ),
      )
      .get();
    if (!head || head.currentRevisionId !== command.expectedPlateRevisionId) {
      return { kind: "plate_revision_changed" };
    }
    const currentRevision = dependencies.db
      .select()
      .from(dependencies.schema.acceptedPlateRevisions)
      .where(eq(dependencies.schema.acceptedPlateRevisions.id, head.currentRevisionId))
      .get();
    if (!currentRevision) throw new AcceptedPlateIntegrityError("head");
    if (
      currentRevision.tenantId !== dependencies.tenantId ||
      currentRevision.profileId !== command.profileId ||
      currentRevision.planRevisionId !== accepted.snapshot.revisionId ||
      currentRevision.planVersion !== accepted.snapshot.planVersion ||
      currentRevision.planRevisionDigest !== accepted.snapshot.revisionDigest ||
      currentRevision.requiredUnitMappingDigest !== accepted.snapshot.requiredUnitMappingDigest
    ) {
      throw new AcceptedPlateIntegrityError("revision");
    }
    const objectNames = requiredObjectNames(accepted.snapshot);
    const plates = readStoredPlates(
      dependencies,
      currentRevision.id,
      currentRevision.expectedPlateCount,
      currentRevision.expectedUnitCount,
      new Set(objectNames.keys()),
      currentRevision.layoutDigest,
    );
    let found = false;
    let unchanged = false;
    const next = plates.map((plate): AcceptedPlateInput => ({
      ...plate,
      units: plate.units.map((unit): AcceptedPlateUnitInput => {
        if (plate.plateId !== command.plateId || unit.token !== command.token) return unit;
        found = true;
        unchanged = unit.xUm === command.xUm && unit.yUm === command.yUm;
        return { ...unit, xUm: command.xUm, yUm: command.yUm };
      }),
    }));
    if (!found) return { kind: "unit_not_found" };
    if (unchanged) return { kind: "unchanged", plateRevisionId: currentRevision.id };
    const validated = validatePlates(next, new Set(objectNames.keys()));
    if (validated.kind !== "ready") return validated;
    const revisionNumber = currentRevision.revisionNumber + 1;
    const revisionId = insertRevision(
      dependencies,
      accepted.snapshot,
      revisionNumber,
      validated.plates,
    );
    const updated = dependencies.db
      .update(dependencies.schema.acceptedPlateHeads)
      .set({ currentRevisionId: revisionId })
      .where(
        and(
          eq(dependencies.schema.acceptedPlateHeads.tenantId, dependencies.tenantId),
          eq(dependencies.schema.acceptedPlateHeads.profileId, command.profileId),
          eq(dependencies.schema.acceptedPlateHeads.currentRevisionId, command.expectedPlateRevisionId),
        ),
      )
      .run();
    if (updated.changes !== 1) throw new Error("Accepted Plate head update failed");
    return { kind: "moved", plateRevisionId: revisionId, plateRevisionNumber: revisionNumber };
  });
}

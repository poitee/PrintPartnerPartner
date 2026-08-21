import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backfillAcceptedPlanRevisions } from "./accepted-plan-revisions.js";
import { backfillCurrentRequiredUnitSets } from "./required-units.js";
import { getDb, SqliteDatabase } from "./client.js";
import { AppRepository } from "./repository.js";
import { MAX_PLAN_DRAFT_LIFECYCLE_VERSION } from "../services/plan-drafts.js";

const tempDirs: string[] = [];

const ACCEPTED_STATE_TABLES = [
  "parts",
  "print_progress",
  "profile_layers",
  "projects",
  "plan_revisions",
  "plan_revision_parts",
  "plan_revision_input_sets",
  "plan_revision_inputs",
  "plan_accepted_input_sets",
  "build_profiles",
  "app_settings",
];

function snapshotTables(raw: Database.Database, tables: readonly string[]) {
  return new Map(
    tables.map((table) => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]),
  );
}

function fixture(): {
  database: SqliteDatabase;
  raw: Database.Database;
  repo: AppRepository;
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), "pp-plan-draft-"));
  tempDirs.push(root);
  const database = new SqliteDatabase(root);
  database.connect();
  return {
    database,
    raw: (database as unknown as { sqlite: Database.Database }).sqlite,
    repo: new AppRepository(getDb(database), "default", database.reposDir),
    root,
  };
}

function trackedSource(input: {
  repo: AppRepository;
  database: SqliteDatabase;
  name: string;
  files: Record<string, string>;
}) {
  const source = input.repo.createSource({
    name: input.name,
    url: `https://example.test/${input.name}`,
    source_kind: "github",
  });
  const observed = input.repo.getProjectRow(source.id);
  if (!observed) throw new Error("test Source missing");
  const locator = `${source.id}/revisions/a`;
  const snapshotRoot = join(input.database.reposDir, locator);
  mkdirSync(snapshotRoot, { recursive: true });
  for (const [relativePath, body] of Object.entries(input.files)) {
    const path = join(snapshotRoot, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  const revision = input.repo.recordSourceRevision({
    sourceId: source.id,
    upstreamRevisionKey: "a",
    manifestDigest: "f".repeat(64),
    snapshotLocator: locator,
    syncedAt: "2026-08-20T12:00:00.000Z",
    completeness: "complete",
  });
  input.repo.activateSourceRevision({ sourceId: source.id, revisionId: revision.id, observed });
  return { source, revision, snapshotRoot };
}

function editableDraftFixture() {
  const context = fixture();
  const sourceRoot = join(context.database.reposDir, "editable-source");
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(join(sourceRoot, "bracket.stl"), "solid bracket");
  writeFileSync(join(sourceRoot, "gear.stl"), "solid gear");
  const source = context.repo.createSource({
    name: "Editable source",
    source_kind: "local",
    local_path: sourceRoot,
  });
  const profile = context.repo.createProfile("Editable Build", source.id);
  const insertPart = context.raw.prepare(
    `INSERT INTO parts (
      tenant_id, profile_id, match_key, relative_path, filename, source_layer,
      status, role, quantity_auto, quantity_effective, included, notes
    ) VALUES ('default', ?, ?, ?, ?, 'base:Editable source',
      'base', 'primary', ?, ?, 1, '')`,
  );
  const bracket = insertPart.run(
    profile.id,
    "bracket.stl",
    "bracket.stl",
    "bracket.stl",
    1,
    1,
  );
  insertPart.run(profile.id, "gear.stl", "gear.stl", "gear.stl", 2, 2);
  context.raw
    .prepare(
      `INSERT INTO print_progress (tenant_id, part_id, unit_index, completed, assembled)
       VALUES ('default', ?, 0, 1, 1)`,
    )
    .run(Number(bracket.lastInsertRowid));
  backfillAcceptedPlanRevisions(context.raw, "2026-08-20T12:00:00.000Z");
  const created = context.repo.recomputePlanDraft({
    profileId: profile.id,
    actor: "test:user",
    idempotencyKey: "editable-draft",
  });
  if (created.kind !== "created") throw new Error("editable test draft was not created");
  return { ...context, profile, source, draft: created.draft };
}

function advanceEmptyAcceptedRevision(input: {
  raw: Database.Database;
  profileId: number;
  parentRevisionId: number | null;
}): number {
  const revision = input.raw
    .prepare(
      `INSERT INTO plan_revisions (
        tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
        provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
        created_at, accepted_at
      ) VALUES ('default', ?, 2, ?, NULL, 'legacy', 'plan-revision-parts-v1', ?,
        'test', 'test', ?, ?)`,
    )
    .run(
      input.profileId,
      input.parentRevisionId,
      "7".repeat(64),
      "2026-08-20T15:00:00.000Z",
      "2026-08-20T15:00:00.000Z",
    );
  const revisionId = Number(revision.lastInsertRowid);
  input.raw
    .prepare(
      `UPDATE build_profiles
          SET accepted_plan_revision_id = ?, accepted_plan_version = 2
        WHERE tenant_id = 'default' AND id = ?`,
    )
    .run(revisionId, input.profileId);
  return revisionId;
}

afterEach(() => {
  for (const root of tempDirs.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("saved Plan drafts", () => {
  it("persists and diffs an empty-baseline recompute without changing accepted or compatibility state", () => {
    const { database, raw, repo } = fixture();
    const sourceRoot = join(database.reposDir, "local-source");
    mkdirSync(join(sourceRoot, "parts"), { recursive: true });
    writeFileSync(join(sourceRoot, "parts", "bracket.stl"), "solid bracket");
    const source = repo.createSource({
      name: "Draft source",
      source_kind: "local",
      local_path: sourceRoot,
    });
    const profile = repo.createProfile("Draft Build", source.id);
    const tables = [
      "parts",
      "print_progress",
      "plan_accepted_input_sets",
      "build_profiles",
    ] as const;
    const before = Object.fromEntries(
      tables.map((table) => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]),
    );

    const result = repo.recomputePlanDraft({
      profileId: profile.id,
      actor: "test:user",
      idempotencyKey: "draft-request-1",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("test draft was not created");
    expect(result.draft).toMatchObject({
      profileId: profile.id,
      baseRevisionId: null,
      basePlanVersion: 0,
      state: "open",
      inputs: [{ sourceId: source.id, trackingKind: "untracked" }],
      parts: [{ filename: "bracket.stl", artifactDigest: null }],
    });
    expect(result.draft.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(repo.getPlanDraft(profile.id, result.draft.id)).toEqual(result.draft);
    expect(repo.diffPlanDraft(profile.id, result.draft.id)).toMatchObject({
      baseRevisionId: null,
      basePlanVersion: 0,
      baseIsCurrent: true,
      inputs: { added: [{ sourceId: source.id }], removed: [], changed: [] },
      parts: { added: [{ after: { filename: "bracket.stl" } }], removed: [], changed: [] },
    });

    const retry = repo.recomputePlanDraft({
      profileId: profile.id,
      actor: "test:user",
      idempotencyKey: "draft-request-1",
    });
    expect(retry).toEqual({ kind: "existing", draft: result.draft });
    const second = repo.recomputePlanDraft({
      profileId: profile.id,
      actor: "test:user",
      idempotencyKey: "draft-request-2",
    });
    expect(second.kind).toBe("created");
    if (second.kind !== "created") throw new Error("second test draft was not created");
    raw.prepare("UPDATE plan_drafts SET created_at = ? WHERE profile_id = ?").run(
      "2026-08-20T12:00:00.000Z",
      profile.id,
    );
    expect(repo.listPlanDrafts(profile.id).map((draft) => draft.id)).toEqual([
      result.draft.id,
      second.draft.id,
    ]);
    expect(raw.prepare("SELECT count(*) AS count FROM plan_drafts").get()).toEqual({ count: 2 });
    for (const table of tables) {
      expect(raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(before[table]);
    }
    database.close();
  });

  it("persists accepted-baseline planning fields and duplicate-key diff across restart", () => {
    const { database, raw, repo } = fixture();
    const sourceRoot = join(database.reposDir, "accepted-source");
    mkdirSync(join(sourceRoot, "parts"), { recursive: true });
    writeFileSync(join(sourceRoot, "parts", "bracket.stl"), "solid bracket");
    writeFileSync(join(sourceRoot, "parts", "new-gear.stl"), "solid gear");
    const source = repo.createSource({
      name: "Accepted source",
      source_kind: "local",
      local_path: sourceRoot,
    });
    const profile = repo.createProfile("Accepted Build", source.id);
    const projectionPart = raw
      .prepare(
        `INSERT INTO parts (
          tenant_id, profile_id, match_key, relative_path, filename, source_layer,
          status, role, filament_color_id, filament_custom_hex, spoolman_spool_id,
          quantity_auto, quantity_override, quantity_effective, included, notes,
          github_blob_url, geometry_same, requirement, option_group_id, manifest_source
        ) VALUES (
          'default', ?, 'parts/bracket.stl', 'parts/bracket.stl', 'bracket.stl',
          'base:Accepted source', 'base', 'primary', 'orange', '#ff5500', '42',
          1, 3, 3, 1, 'keep this decision', 'https://example.test/bracket.stl', 1,
          'required', 'frame', 'manifest.json'
        )`,
      )
      .run(profile.id);
    raw.prepare(
      `INSERT INTO print_progress (tenant_id, part_id, unit_index, completed, assembled)
       VALUES ('default', ?, 0, 1, 1)`,
    ).run(Number(projectionPart.lastInsertRowid));
    const revision = raw
      .prepare(
        `INSERT INTO plan_revisions (
          tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
          provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
          created_at, accepted_at
        ) VALUES (
          'default', ?, 1, NULL, NULL, 'legacy', 'plan-revision-parts-v1', ?,
          'test', 'test', '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z'
        )`,
      )
      .run(profile.id, "a".repeat(64));
    const revisionId = Number(revision.lastInsertRowid);
    const insertAcceptedPart = raw.prepare(
      `INSERT INTO plan_revision_parts (
        tenant_id, revision_id, projection_part_id, part_key, relative_path, filename,
        source_layer, status, role_inferred, role_override, filament_color_id,
        filament_custom_hex, spoolman_spool_id, quantity_inferred, quantity_override,
        quantity_effective, included, notes, github_blob_url, geometry_same, requirement,
        option_group_id, manifest_source, artifact_digest
      ) VALUES (
        'default', ?, ?, 'parts/bracket.stl', 'parts/bracket.stl', ?,
        'base:Accepted source', 'base', 'primary', ?, 'orange', '#ff5500', '42',
        1, 3, 3, 1, 'keep this decision', 'https://example.test/bracket.stl', 1,
        'required', 'frame', 'manifest.json', NULL
      )`,
    );
    const predecessor = insertAcceptedPart.run(
      revisionId,
      Number(projectionPart.lastInsertRowid),
      "bracket.stl",
      "accent",
    );
    const duplicate = insertAcceptedPart.run(
      revisionId,
      null,
      "legacy-copy.stl",
      null,
    );
    raw.prepare(
      `UPDATE build_profiles
          SET accepted_plan_revision_id = ?, accepted_plan_version = 1
        WHERE tenant_id = 'default' AND id = ?`,
    ).run(revisionId, profile.id);

    const protectedTables = [
      "parts",
      "print_progress",
      "app_settings",
      "profile_layers",
      "projects",
      "plan_revision_input_sets",
      "plan_revision_inputs",
      "plan_accepted_input_sets",
      "build_profiles",
      "plan_revisions",
      "plan_revision_parts",
    ] as const;
    const before = Object.fromEntries(
      protectedTables.map((table) => [
        table,
        raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
      ]),
    );
    const created = repo.recomputePlanDraft({
      profileId: profile.id,
      actor: "test:user",
      idempotencyKey: "accepted-draft",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") throw new Error("test draft was not created");
    const bracket = created.draft.parts.find((part) => part.filename === "bracket.stl");
    expect(bracket).toMatchObject({
      baseRevisionPartId: Number(predecessor.lastInsertRowid),
      roleOverride: "accent",
      filamentColorId: "orange",
      filamentCustomHex: "#ff5500",
      spoolmanSpoolId: "42",
      quantityOverride: 3,
      quantityEffective: 3,
      included: true,
      notes: "keep this decision",
      githubBlobUrl: "https://example.test/bracket.stl",
      geometrySame: true,
      requirement: "required",
      optionGroupId: "frame",
      manifestSource: "manifest.json",
      artifactDigest: null,
    });
    const diff = repo.diffPlanDraft(profile.id, created.draft.id);
    expect(diff.parts.added).toEqual([
      { after: expect.objectContaining({ filename: "new-gear.stl" }) },
    ]);
    expect(diff.parts.removed).toEqual([
      { before: expect.objectContaining({ id: Number(duplicate.lastInsertRowid) }) },
    ]);
    for (const table of protectedTables) {
      expect(raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(before[table]);
    }

    raw.prepare(
      `UPDATE plan_draft_parts SET base_revision_part_id = ?
        WHERE draft_id = ? AND filename = 'bracket.stl'`,
    ).run(Number(duplicate.lastInsertRowid), created.draft.id);
    expect(() => repo.getPlanDraft(profile.id, created.draft.id)).toThrow(/digest mismatch/i);
    raw.prepare(
      `UPDATE plan_draft_parts SET base_revision_part_id = ?
        WHERE draft_id = ? AND filename = 'bracket.stl'`,
    ).run(Number(predecessor.lastInsertRowid), created.draft.id);

    const draftBeforeRestart = created.draft;
    const root = database.dataDir;
    database.close();
    const reopened = new SqliteDatabase(root);
    reopened.connect();
    const reopenedRepo = new AppRepository(getDb(reopened), "default", reopened.reposDir);
    expect(reopenedRepo.getPlanDraft(profile.id, created.draft.id)).toEqual(draftBeforeRestart);
    reopened.close();
  });

  it("hashes tracked STL bytes for new, unchanged, and changed draft Parts", () => {
    const { database, raw, repo } = fixture();
    const tracked = trackedSource({
      repo,
      database,
      name: "Tracked evidence",
      files: { "part.stl": "solid accepted", "new.stl": "solid new" },
    });
    const profile = repo.createProfile("Tracked evidence Build", tracked.source.id);
    const acceptedDigest = createHash("sha256").update("solid accepted").digest("hex");
    const newDigest = createHash("sha256").update("solid new").digest("hex");
    const revision = raw
      .prepare(
        `INSERT INTO plan_revisions (
          tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
          provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
          created_at, accepted_at
        ) VALUES ('default', ?, 1, NULL, NULL, 'legacy', 'plan-revision-parts-v1', ?,
          'test', 'test', ?, ?)`,
      )
      .run(
        profile.id,
        "a".repeat(64),
        "2026-08-20T12:05:00.000Z",
        "2026-08-20T12:05:00.000Z",
      );
    const acceptedPart = raw
      .prepare(
        `INSERT INTO plan_revision_parts (
          tenant_id, revision_id, part_key, relative_path, filename, source_layer,
          status, role_inferred, role_override, quantity_inferred, quantity_override,
          quantity_effective, included, notes, artifact_digest
        ) VALUES (
          'default', ?, 'part.stl', 'part.stl', 'part.stl', 'base:Tracked evidence',
          'base', 'primary', NULL, 1, NULL, 1, 1, '', ?
        )`,
      )
      .run(Number(revision.lastInsertRowid), acceptedDigest);
    raw.prepare(
      `UPDATE build_profiles
          SET accepted_plan_revision_id = ?, accepted_plan_version = 1
        WHERE tenant_id = 'default' AND id = ?`,
    ).run(Number(revision.lastInsertRowid), profile.id);

    const unchanged = repo.recomputePlanDraft({
      profileId: profile.id,
      actor: "test:user",
      idempotencyKey: "tracked-unchanged",
    });
    expect(unchanged.kind).toBe("created");
    if (unchanged.kind !== "created") throw new Error("tracked draft was not created");
    expect(unchanged.draft.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: "part.stl",
          baseRevisionPartId: Number(acceptedPart.lastInsertRowid),
          artifactDigest: acceptedDigest,
        }),
        expect.objectContaining({
          filename: "new.stl",
          baseRevisionPartId: null,
          artifactDigest: newDigest,
        }),
      ]),
    );
    const unchangedDiff = repo.diffPlanDraft(profile.id, unchanged.draft.id);
    expect(
      unchangedDiff.parts.changed.flatMap((change) => change.fields),
    ).not.toContain("artifactDigest");

    writeFileSync(join(tracked.snapshotRoot, "part.stl"), "solid changed");
    const changedDigest = createHash("sha256").update("solid changed").digest("hex");
    const changed = repo.recomputePlanDraft({
      profileId: profile.id,
      actor: "test:user",
      idempotencyKey: "tracked-changed",
    });
    expect(changed.kind).toBe("created");
    if (changed.kind !== "created") throw new Error("changed tracked draft was not created");
    expect(changed.draft.parts.find((part) => part.filename === "part.stl")).toMatchObject({
      artifactDigest: changedDigest,
    });
    expect(
      repo
        .diffPlanDraft(profile.id, changed.draft.id)
        .parts.changed.find((change) => change.after.filename === "part.stl")?.fields,
    ).toContain("artifactDigest");
    expect(() =>
      raw
        .prepare(
          `INSERT INTO plan_draft_parts (
            tenant_id, draft_id, base_revision_part_id, part_key,
            quantity_inferred, quantity_effective, included, notes
          ) VALUES ('default', ?, ?, 'duplicate-predecessor', 1, 1, 1, '')`,
        )
        .run(changed.draft.id, Number(acceptedPart.lastInsertRowid)),
    ).toThrow(/unique/i);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO plan_draft_parts (
            tenant_id, draft_id, base_revision_part_id, part_key,
            quantity_inferred, quantity_effective, included, notes
          ) VALUES
            ('default', ?, NULL, 'null-predecessor-a', 1, 1, 1, ''),
            ('default', ?, NULL, 'null-predecessor-b', 1, 1, 1, '')`,
        )
        .run(changed.draft.id, changed.draft.id),
    ).not.toThrow();
    database.close();
  });

  it("requires an accepted baseline for both compatibility-dirty shapes", () => {
    const { database, raw, repo } = fixture();
    const withParts = repo.createProfile("Live Parts without baseline");
    raw.prepare(
      `INSERT INTO parts (
        tenant_id, profile_id, match_key, relative_path, filename, source_layer,
        status, role, quantity_auto, quantity_effective, included, notes
      ) VALUES ('default', ?, 'legacy.stl', 'legacy.stl', 'legacy.stl', '',
        'base', 'primary', 1, 1, 1, '')`,
    ).run(withParts.id);
    expect(
      repo.recomputePlanDraft({
        profileId: withParts.id,
        actor: "test:user",
        idempotencyKey: "live-parts",
      }),
    ).toEqual({ kind: "accepted_baseline_required" });

    const nonzeroVersion = repo.createProfile("Cleared pointer");
    raw.prepare(
      `UPDATE build_profiles SET accepted_plan_version = 4
        WHERE tenant_id = 'default' AND id = ?`,
    ).run(nonzeroVersion.id);
    expect(
      repo.recomputePlanDraft({
        profileId: nonzeroVersion.id,
        actor: "test:user",
        idempotencyKey: "cleared-pointer",
      }),
    ).toEqual({ kind: "accepted_baseline_required" });
    expect(raw.prepare("SELECT count(*) AS count FROM plan_drafts").get()).toEqual({ count: 0 });
    database.close();
  });

  it("rejects a non-null accepted revision at version zero before scan and at transaction recheck", () => {
    const { database, raw, repo } = fixture();
    const invalidBeforeScan = repo.createProfile("Invalid pair before scan");
    const revision = raw
      .prepare(
        `INSERT INTO plan_revisions (
          tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
          provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
          created_at, accepted_at
        ) VALUES ('default', ?, 1, NULL, NULL, 'legacy', 'plan-revision-parts-v1', ?,
          'test', 'test', ?, ?)`,
      )
      .run(
        invalidBeforeScan.id,
        "c".repeat(64),
        "2026-08-20T11:00:00.000Z",
        "2026-08-20T11:00:00.000Z",
      );
    raw.prepare(
      `UPDATE build_profiles
          SET accepted_plan_revision_id = ?, accepted_plan_version = 0
        WHERE tenant_id = 'default' AND id = ?`,
    ).run(Number(revision.lastInsertRowid), invalidBeforeScan.id);
    expect(
      repo.recomputePlanDraft({
        profileId: invalidBeforeScan.id,
        actor: "test:user",
        idempotencyKey: "invalid-before-scan",
      }),
    ).toEqual({ kind: "accepted_baseline_required" });

    const sourceRoot = join(database.reposDir, "recheck-source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "part.stl"), "solid part");
    const source = repo.createSource({
      name: "Recheck source",
      source_kind: "local",
      local_path: sourceRoot,
    });
    const recheckedProfile = repo.createProfile("Invalid pair during write", source.id);
    const recheckedRevision = raw
      .prepare(
        `INSERT INTO plan_revisions (
          tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
          provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
          created_at, accepted_at
        ) VALUES ('default', ?, 1, NULL, NULL, 'legacy', 'plan-revision-parts-v1', ?,
          'test', 'test', ?, ?)`,
      )
      .run(
        recheckedProfile.id,
        "d".repeat(64),
        "2026-08-20T11:05:00.000Z",
        "2026-08-20T11:05:00.000Z",
      );
    const nativeTransaction = repo.transaction.bind(repo);
    repo.transaction = <T>(
      fn: () => T,
      behavior: "deferred" | "immediate" = "deferred",
    ): T => {
      raw.prepare(
        `UPDATE build_profiles
            SET accepted_plan_revision_id = ?, accepted_plan_version = 0
          WHERE tenant_id = 'default' AND id = ?`,
      ).run(Number(recheckedRevision.lastInsertRowid), recheckedProfile.id);
      return nativeTransaction(fn, behavior);
    };
    expect(
      repo.recomputePlanDraft({
        profileId: recheckedProfile.id,
        actor: "test:user",
        idempotencyKey: "invalid-at-recheck",
      }),
    ).toEqual({ kind: "accepted_baseline_required" });
    expect(raw.prepare("SELECT count(*) AS count FROM plan_drafts").get()).toEqual({ count: 0 });
    database.close();
  });

  it("keeps draft reads and database ownership tenant-scoped", () => {
    const { database, raw, repo } = fixture();
    const sourceRoot = join(database.reposDir, "tenant-source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "part.stl"), "solid part");
    const source = repo.createSource({
      name: "Tenant source",
      source_kind: "local",
      local_path: sourceRoot,
    });
    const profile = repo.createProfile("Tenant Build", source.id);
    const created = repo.recomputePlanDraft({
      profileId: profile.id,
      actor: "test:user",
      idempotencyKey: "tenant-draft",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") throw new Error("test draft was not created");
    const otherTenant = new AppRepository(getDb(database), "farm-b", database.reposDir);
    expect(() => otherTenant.getPlanDraft(profile.id, created.draft.id)).toThrow(
      "Profile not found",
    );
    expect(() =>
      raw
        .prepare(
          `INSERT INTO plan_drafts (
            tenant_id, profile_id, base_revision_id, base_plan_version, state,
            digest_format, snapshot_digest, created_by, idempotency_key, created_at
          ) VALUES ('farm-b', ?, NULL, 0, 'open', 'plan-draft-v1', ?, 'test', 'bad', ?)`,
        )
        .run(profile.id, "b".repeat(64), new Date().toISOString()),
    ).toThrow(/ownership/i);
    const otherProfile = repo.createProfile("Other identity Build");
    const sameBuildRevision = raw
      .prepare(
        `INSERT INTO plan_revisions (
          tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
          provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
          created_at, accepted_at
        ) VALUES ('default', ?, 1, NULL, NULL, 'legacy', 'plan-revision-parts-v1', ?,
          'test', 'test', ?, ?)`,
      )
      .run(
        profile.id,
        "f".repeat(64),
        "2026-08-20T12:10:00.000Z",
        "2026-08-20T12:10:00.000Z",
      );
    expect(() =>
      raw
        .prepare(
          `UPDATE plan_drafts
              SET base_revision_id = ?, base_plan_version = 1
            WHERE id = ?`,
        )
        .run(Number(sameBuildRevision.lastInsertRowid), created.draft.id),
    ).toThrow(/immutable/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET profile_id = ? WHERE id = ?")
        .run(otherProfile.id, created.draft.id),
    ).toThrow(/immutable/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET base_plan_version = 3 WHERE id = ?")
        .run(created.draft.id),
    ).toThrow(/immutable/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET state = 'abandoned' WHERE id = ?")
        .run(created.draft.id),
    ).toThrow(/transition/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET lifecycle_version = lifecycle_version + 1 WHERE id = ?")
        .run(created.draft.id),
    ).toThrow(/transition/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET state = 'abandoned', lifecycle_version = lifecycle_version + 2 WHERE id = ?")
        .run(created.draft.id),
    ).toThrow(/transition/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET state = 'abandoned', lifecycle_version = lifecycle_version + 1 WHERE id = ?")
        .run(created.draft.id),
    ).not.toThrow();
    expect(() =>
      raw
        .prepare("UPDATE plan_draft_inputs SET layer_order = layer_order WHERE draft_id = ?")
        .run(created.draft.id),
    ).toThrow(/open/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_draft_parts SET notes = notes WHERE draft_id = ?")
        .run(created.draft.id),
    ).toThrow(/open/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET state = 'consumed', lifecycle_version = lifecycle_version + 1 WHERE id = ?")
        .run(created.draft.id),
    ).toThrow(/transition/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET state = 'open', lifecycle_version = lifecycle_version + 1 WHERE id = ?")
        .run(created.draft.id),
    ).not.toThrow();
    expect(() =>
      raw
        .prepare("UPDATE plan_draft_inputs SET layer_order = layer_order WHERE draft_id = ?")
        .run(created.draft.id),
    ).not.toThrow();
    expect(() =>
      raw
        .prepare("UPDATE plan_draft_parts SET notes = notes WHERE draft_id = ?")
        .run(created.draft.id),
    ).not.toThrow();
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET state = 'consumed', lifecycle_version = lifecycle_version + 1 WHERE id = ?")
        .run(created.draft.id),
    ).not.toThrow();
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET state = 'open', lifecycle_version = lifecycle_version + 1 WHERE id = ?")
        .run(created.draft.id),
    ).toThrow(/transition/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET state = 'abandoned', lifecycle_version = lifecycle_version + 1 WHERE id = ?")
        .run(created.draft.id),
    ).toThrow(/transition/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET state = 'consumed' WHERE id = ?")
        .run(created.draft.id),
    ).not.toThrow();
    expect(() =>
      raw
        .prepare("UPDATE plan_drafts SET tenant_id = 'farm-b' WHERE id = ?")
        .run(created.draft.id),
    ).toThrow(/immutable/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_draft_inputs SET tenant_id = 'farm-b' WHERE draft_id = ?")
        .run(created.draft.id),
    ).toThrow(/ownership/i);
    expect(() =>
      raw
        .prepare("UPDATE plan_draft_parts SET tenant_id = 'farm-b' WHERE draft_id = ?")
        .run(created.draft.id),
    ).toThrow(/ownership/i);
    raw.prepare("DELETE FROM plan_drafts WHERE id = ?").run(created.draft.id);
    expect(raw.prepare("SELECT count(*) AS count FROM plan_draft_inputs WHERE draft_id = ?").get(created.draft.id)).toEqual({ count: 0 });
    expect(raw.prepare("SELECT count(*) AS count FROM plan_draft_parts WHERE draft_id = ?").get(created.draft.id)).toEqual({ count: 0 });
    database.close();
  });

  it("re-reads the committed winner after an idempotency unique collision", () => {
    const { database, raw, repo } = fixture();
    const sourceRoot = join(database.reposDir, "collision-source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "part.stl"), "solid part");
    const source = repo.createSource({
      name: "Collision source",
      source_kind: "local",
      local_path: sourceRoot,
    });
    const profile = repo.createProfile("Collision Build", source.id);
    const winner = repo.recomputePlanDraft({
      profileId: profile.id,
      actor: "test:user",
      idempotencyKey: "staged-winner",
    });
    expect(winner.kind).toBe("created");
    if (winner.kind !== "created") throw new Error("test winner draft was not created");
    const nativeTransaction = repo.transaction.bind(repo);
    repo.transaction = <T>(
      fn: () => T,
      behavior: "deferred" | "immediate" = "deferred",
    ): T => {
      raw.prepare("UPDATE plan_drafts SET idempotency_key = 'collision-key' WHERE id = ?").run(
        winner.draft.id,
      );
      return nativeTransaction(fn, behavior);
    };

    const recovered = repo.recomputePlanDraft({
      profileId: profile.id,
      actor: "test:user",
      idempotencyKey: "collision-key",
    });

    expect(recovered.kind).toBe("existing");
    if (recovered.kind !== "existing") throw new Error("test collision was not recovered");
    expect(recovered.draft).toMatchObject({
      id: winner.draft.id,
      idempotencyKey: "collision-key",
    });
    expect(raw.prepare("SELECT count(*) AS count FROM plan_drafts").get()).toEqual({ count: 1 });
    database.close();
  });

  it("returns typed conflicts when the base or captured inputs change before write", () => {
    const { database, raw, repo } = fixture();
    const sourceRoot = join(database.reposDir, "optimistic-source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "part.stl"), "solid part");
    const source = repo.createSource({
      name: "Optimistic source",
      source_kind: "local",
      local_path: sourceRoot,
    });
    const profile = repo.createProfile("Optimistic Build", source.id);
    const revision = raw
      .prepare(
        `INSERT INTO plan_revisions (
          tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
          provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
          created_at, accepted_at
        ) VALUES ('default', ?, 1, NULL, NULL, 'legacy', 'plan-revision-parts-v1', ?,
          'test', 'test', ?, ?)`,
      )
      .run(
        profile.id,
        "e".repeat(64),
        "2026-08-20T11:10:00.000Z",
        "2026-08-20T11:10:00.000Z",
      );
    const nativeTransaction = repo.transaction.bind(repo);
    repo.transaction = <T>(
      fn: () => T,
      behavior: "deferred" | "immediate" = "deferred",
    ): T => {
      raw.prepare(
        `UPDATE build_profiles
            SET accepted_plan_revision_id = ?, accepted_plan_version = 1
          WHERE tenant_id = 'default' AND id = ?`,
      ).run(Number(revision.lastInsertRowid), profile.id);
      return nativeTransaction(fn, behavior);
    };
    expect(
      repo.recomputePlanDraft({
        profileId: profile.id,
        actor: "test:user",
        idempotencyKey: "base-moved",
      }),
    ).toEqual({ kind: "base_changed" });

    raw.prepare(
      `UPDATE build_profiles
          SET accepted_plan_revision_id = NULL, accepted_plan_version = 0
        WHERE tenant_id = 'default' AND id = ?`,
    ).run(profile.id);
    repo.transaction = <T>(
      fn: () => T,
      behavior: "deferred" | "immediate" = "deferred",
    ): T => {
      repo.updateImportRules(source.id, ["other/"]);
      return nativeTransaction(fn, behavior);
    };
    expect(
      repo.recomputePlanDraft({
        profileId: profile.id,
        actor: "test:user",
        idempotencyKey: "inputs-moved",
      }),
    ).toEqual({ kind: "inputs_changed" });
    expect(raw.prepare("SELECT count(*) AS count FROM plan_drafts").get()).toEqual({ count: 0 });
    database.close();
  });

  it("edits grouped draft Parts, updates the digest and diff, and persists across restart", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    const partIds = draft.parts.map((part) => part.id);
    const acceptedBefore = snapshotTables(raw, ACCEPTED_STATE_TABLES);

    const included = repo.editPlanDraftParts({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: draft.snapshotDigest,
      decision: { kind: "set_included", partIds, value: false },
    });

    expect(included.kind).toBe("updated");
    if (included.kind !== "updated") throw new Error("draft inclusion edit was not applied");
    expect(included.draft.parts.every((part) => !part.included)).toBe(true);
    expect(included.draft.snapshotDigest).not.toBe(draft.snapshotDigest);
    const result = repo.editPlanDraftParts({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: included.draft.snapshotDigest,
      decision: { kind: "set_quantity_override", partIds, value: 4 },
    });
    expect(result.kind).toBe("updated");
    if (result.kind !== "updated") throw new Error("draft quantity edit was not applied");
    expect(
      result.draft.parts.map((part) => [part.quantityOverride, part.quantityEffective]),
    ).toEqual([
      [4, 4],
      [4, 4],
    ]);
    const diff = repo.diffPlanDraft(profile.id, draft.id);
    expect(diff.parts.changed).toHaveLength(2);
    expect(diff.parts.changed.every((change) => change.fields.includes("included"))).toBe(true);
    expect(
      diff.parts.changed.every(
        (change) =>
          change.fields.includes("quantityOverride") &&
          change.fields.includes("quantityEffective"),
      ),
    ).toBe(true);
    for (const table of ACCEPTED_STATE_TABLES) {
      expect(raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(
        acceptedBefore.get(table),
      );
    }

    const root = database.dataDir;
    database.close();
    const reopened = new SqliteDatabase(root);
    reopened.connect();
    const reopenedRepo = new AppRepository(getDb(reopened), "default", reopened.reposDir);
    expect(reopenedRepo.getPlanDraft(profile.id, draft.id)).toEqual(result.draft);
    reopened.close();
  });

  it("updates only unsatisfied targets, converges an exact retry, and rejects a stale change", () => {
    const { database, profile, repo, draft } = editableDraftFixture();
    const firstId = draft.parts[0]?.id;
    const secondId = draft.parts[1]?.id;
    if (!firstId || !secondId) throw new Error("editable draft Parts are missing");
    const first = repo.editPlanDraftParts({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: draft.snapshotDigest,
      decision: { kind: "set_included", partIds: [firstId], value: false },
    });
    expect(first.kind).toBe("updated");
    if (first.kind !== "updated") throw new Error("first draft edit was not applied");

    const grouped = repo.editPlanDraftParts({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: first.draft.snapshotDigest,
      decision: { kind: "set_included", partIds: [firstId, secondId], value: false },
    });
    expect(grouped.kind).toBe("updated");
    if (grouped.kind !== "updated") throw new Error("grouped draft edit was not applied");

    expect(
      repo.editPlanDraftParts({
        profileId: profile.id,
        draftId: draft.id,
        expectedSnapshotDigest: first.draft.snapshotDigest,
        decision: { kind: "set_included", partIds: [secondId, firstId], value: false },
      }),
    ).toEqual({ kind: "unchanged", draft: grouped.draft });
    expect(
      repo.editPlanDraftParts({
        profileId: profile.id,
        draftId: draft.id,
        expectedSnapshotDigest: draft.snapshotDigest,
        decision: { kind: "set_included", partIds: [firstId], value: true },
      }),
    ).toEqual({ kind: "conflict", draft: grouped.draft });
    database.close();
  });

  it("distinguishes a dirty accepted baseline from a different valid base", () => {
    const dirty = editableDraftFixture();
    dirty.raw
      .prepare(
        `UPDATE build_profiles
            SET accepted_plan_revision_id = NULL, accepted_plan_version = 0
          WHERE tenant_id = 'default' AND id = ?`,
      )
      .run(dirty.profile.id);
    expect(
      dirty.repo.editPlanDraftParts({
        profileId: dirty.profile.id,
        draftId: dirty.draft.id,
        expectedSnapshotDigest: dirty.draft.snapshotDigest,
        decision: {
          kind: "set_included",
          partIds: [dirty.draft.parts[0]?.id ?? 0],
          value: false,
        },
      }),
    ).toEqual({ kind: "accepted_baseline_required" });
    expect(dirty.repo.getPlanDraft(dirty.profile.id, dirty.draft.id)).toEqual(dirty.draft);
    dirty.database.close();

    const moved = editableDraftFixture();
    const acceptedId = moved.draft.baseRevisionId;
    if (!acceptedId) throw new Error("accepted test revision is missing");
    const nextRevision = moved.raw
      .prepare(
        `INSERT INTO plan_revisions (
          tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
          provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
          created_at, accepted_at
        ) VALUES ('default', ?, 2, ?, NULL, 'legacy', 'plan-revision-parts-v1', ?,
          'test', 'test', ?, ?)`,
      )
      .run(
        moved.profile.id,
        acceptedId,
        "9".repeat(64),
        "2026-08-20T13:00:00.000Z",
        "2026-08-20T13:00:00.000Z",
      );
    moved.raw
      .prepare(
        `UPDATE build_profiles
            SET accepted_plan_revision_id = ?, accepted_plan_version = 2
          WHERE tenant_id = 'default' AND id = ?`,
      )
      .run(Number(nextRevision.lastInsertRowid), moved.profile.id);
    expect(
      moved.repo.editPlanDraftParts({
        profileId: moved.profile.id,
        draftId: moved.draft.id,
        expectedSnapshotDigest: moved.draft.snapshotDigest,
        decision: {
          kind: "set_included",
          partIds: [moved.draft.parts[0]?.id ?? 0],
          value: false,
        },
      }),
    ).toEqual({ kind: "base_changed", draft: moved.draft });
    moved.database.close();
  });

  it("rejects closed drafts and draft identities outside the tenant and Build", () => {
    const abandoned = editableDraftFixture();
    abandoned.raw
      .prepare("UPDATE plan_drafts SET state = 'abandoned', lifecycle_version = lifecycle_version + 1 WHERE id = ?")
      .run(abandoned.draft.id);
    expect(
      abandoned.repo.editPlanDraftParts({
        profileId: abandoned.profile.id,
        draftId: abandoned.draft.id,
        expectedSnapshotDigest: abandoned.draft.snapshotDigest,
        decision: {
          kind: "set_included",
          partIds: [abandoned.draft.parts[0]?.id ?? 0],
          value: false,
        },
      }),
    ).toEqual({ kind: "not_open", state: "abandoned" });
    abandoned.database.close();

    const consumed = editableDraftFixture();
    consumed.raw
      .prepare("UPDATE plan_drafts SET state = 'consumed', lifecycle_version = lifecycle_version + 1 WHERE id = ?")
      .run(consumed.draft.id);
    expect(
      consumed.repo.editPlanDraftParts({
        profileId: consumed.profile.id,
        draftId: consumed.draft.id,
        expectedSnapshotDigest: consumed.draft.snapshotDigest,
        decision: {
          kind: "set_included",
          partIds: [consumed.draft.parts[0]?.id ?? 0],
          value: false,
        },
      }),
    ).toEqual({ kind: "not_open", state: "consumed" });

    const firstId = consumed.draft.parts[0]?.id;
    if (!firstId) throw new Error("editable draft Part is missing");
    const otherTenant = new AppRepository(
      getDb(consumed.database),
      "farm-b",
      consumed.database.reposDir,
    );
    expect(
      otherTenant.editPlanDraftParts({
        profileId: consumed.profile.id,
        draftId: consumed.draft.id,
        expectedSnapshotDigest: consumed.draft.snapshotDigest,
        decision: { kind: "set_included", partIds: [firstId], value: false },
      }),
    ).toEqual({ kind: "not_found" });
    const otherProfile = consumed.repo.createProfile("Other edit Build");
    expect(
      consumed.repo.editPlanDraftParts({
        profileId: otherProfile.id,
        draftId: consumed.draft.id,
        expectedSnapshotDigest: consumed.draft.snapshotDigest,
        decision: { kind: "set_included", partIds: [firstId], value: false },
      }),
    ).toEqual({ kind: "not_found" });
    consumed.database.close();

    const wrongPart = editableDraftFixture();
    expect(
      wrongPart.repo.editPlanDraftParts({
        profileId: wrongPart.profile.id,
        draftId: wrongPart.draft.id,
        expectedSnapshotDigest: wrongPart.draft.snapshotDigest,
        decision: { kind: "set_included", partIds: [999_999], value: false },
      }),
    ).toEqual({ kind: "not_found" });
    wrongPart.database.close();
  });

  it("rolls back the draft digest when a selected Part update fails", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    const acceptedBefore = snapshotTables(raw, ACCEPTED_STATE_TABLES);
    raw.exec(
      `CREATE TRIGGER reject_draft_part_edit
       BEFORE UPDATE OF included ON plan_draft_parts
       BEGIN
         SELECT RAISE(ABORT, 'injected draft Part edit failure');
       END`,
    );

    expect(() =>
      repo.editPlanDraftParts({
        profileId: profile.id,
        draftId: draft.id,
        expectedSnapshotDigest: draft.snapshotDigest,
        decision: {
          kind: "set_included",
          partIds: draft.parts.map((part) => part.id),
          value: false,
        },
      }),
    ).toThrow(/injected draft Part edit failure/i);
    expect(repo.getPlanDraft(profile.id, draft.id)).toEqual(draft);
    for (const table of ACCEPTED_STATE_TABLES) {
      expect(raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(
        acceptedBefore.get(table),
      );
    }
    database.close();
  });

  it("rejects an oversized quantity without changing draft or accepted state", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    const tables = [
      ...ACCEPTED_STATE_TABLES,
      "plan_drafts",
      "plan_draft_inputs",
      "plan_draft_parts",
    ];
    const before = snapshotTables(raw, tables);

    expect(() =>
      repo.editPlanDraftParts({
        profileId: profile.id,
        draftId: draft.id,
        expectedSnapshotDigest: draft.snapshotDigest,
        decision: {
          kind: "set_quantity_override",
          partIds: draft.parts.map((part) => part.id),
          value: 10_001,
        },
      }),
    ).toThrow(/quantity/i);
    for (const table of tables) {
      expect(raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(before.get(table));
    }
    database.close();
  });

  it("versions abandon and resume transitions while preserving draft and accepted state", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    const protectedTables = [
      ...ACCEPTED_STATE_TABLES,
      "plan_draft_inputs",
      "plan_draft_parts",
    ];
    const before = snapshotTables(raw, protectedTables);

    const abandoned = repo.transitionPlanDraft({
      profileId: profile.id,
      draftId: draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    expect(abandoned).toMatchObject({
      kind: "transitioned",
      draft: { state: "abandoned", lifecycleVersion: 1 },
    });
    if (abandoned.kind !== "transitioned") throw new Error("draft was not abandoned");
    expect(
      repo.transitionPlanDraft({
        profileId: profile.id,
        draftId: draft.id,
        transition: { kind: "abandon", expectedLifecycleVersion: 0 },
      }),
    ).toEqual({ kind: "unchanged", draft: abandoned.draft });
    const resumed = repo.transitionPlanDraft({
      profileId: profile.id,
      draftId: draft.id,
      transition: { kind: "resume", expectedLifecycleVersion: 1 },
    });
    expect(resumed).toMatchObject({
      kind: "transitioned",
      draft: { state: "open", lifecycleVersion: 2 },
    });
    expect(resumed.kind === "transitioned" && resumed.draft.snapshotDigest).toBe(
      draft.snapshotDigest,
    );
    for (const table of protectedTables) {
      expect(raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(before.get(table));
    }
    if (resumed.kind !== "transitioned") throw new Error("draft was not resumed");
    raw
      .prepare(
        `UPDATE build_profiles
            SET accepted_plan_revision_id = NULL, accepted_plan_version = 0
          WHERE tenant_id = 'default' AND id = ?`,
      )
      .run(profile.id);
    expect(
      repo.transitionPlanDraft({
        profileId: profile.id,
        draftId: draft.id,
        transition: { kind: "resume", expectedLifecycleVersion: 1 },
      }),
    ).toEqual({ kind: "unchanged", draft: resumed.draft });
    database.close();
  });

  it("rejects lifecycle ABA and converges exact retries across repositories and restart", () => {
    const { database, profile, repo, draft, root } = editableDraftFixture();
    const secondRepo = new AppRepository(getDb(database), "default", database.reposDir);
    const first = repo.transitionPlanDraft({
      profileId: profile.id,
      draftId: draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    expect(first.kind).toBe("transitioned");
    if (first.kind !== "transitioned") throw new Error("draft was not abandoned");
    expect(
      secondRepo.transitionPlanDraft({
        profileId: profile.id,
        draftId: draft.id,
        transition: { kind: "abandon", expectedLifecycleVersion: 0 },
      }),
    ).toEqual({ kind: "unchanged", draft: first.draft });
    const resumed = repo.transitionPlanDraft({
      profileId: profile.id,
      draftId: draft.id,
      transition: { kind: "resume", expectedLifecycleVersion: 1 },
    });
    expect(resumed.kind).toBe("transitioned");
    const abandonedAgain = repo.transitionPlanDraft({
      profileId: profile.id,
      draftId: draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 2 },
    });
    expect(abandonedAgain).toMatchObject({
      kind: "transitioned",
      draft: { state: "abandoned", lifecycleVersion: 3 },
    });
    if (abandonedAgain.kind !== "transitioned") {
      throw new Error("draft was not abandoned again");
    }
    expect(
      repo.transitionPlanDraft({
        profileId: profile.id,
        draftId: draft.id,
        transition: { kind: "resume", expectedLifecycleVersion: 1 },
      }),
    ).toEqual({ kind: "conflict", draft: abandonedAgain.draft });

    database.close();
    const reopened = new SqliteDatabase(root);
    reopened.connect();
    const reopenedRepo = new AppRepository(getDb(reopened), "default", reopened.reposDir);
    expect(reopenedRepo.getPlanDraft(profile.id, draft.id)).toEqual(abandonedAgain.draft);
    reopened.close();
  });

  it("allows stale and dirty abandon but refuses a new resume", () => {
    const dirty = editableDraftFixture();
    dirty.raw
      .prepare(
        `UPDATE build_profiles
            SET accepted_plan_revision_id = NULL, accepted_plan_version = 0
          WHERE tenant_id = 'default' AND id = ?`,
      )
      .run(dirty.profile.id);
    const dirtyAbandon = dirty.repo.transitionPlanDraft({
      profileId: dirty.profile.id,
      draftId: dirty.draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    expect(dirtyAbandon.kind).toBe("transitioned");
    expect(
      dirty.repo.transitionPlanDraft({
        profileId: dirty.profile.id,
        draftId: dirty.draft.id,
        transition: { kind: "resume", expectedLifecycleVersion: 1 },
      }),
    ).toEqual({ kind: "accepted_baseline_required" });
    dirty.database.close();

    const moved = editableDraftFixture();
    const acceptedId = moved.draft.baseRevisionId;
    if (!acceptedId) throw new Error("accepted test revision is missing");
    const nextRevision = moved.raw
      .prepare(
        `INSERT INTO plan_revisions (
          tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
          provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
          created_at, accepted_at
        ) VALUES ('default', ?, 2, ?, NULL, 'legacy', 'plan-revision-parts-v1', ?,
          'test', 'test', ?, ?)`,
      )
      .run(
        moved.profile.id,
        acceptedId,
        "8".repeat(64),
        "2026-08-20T14:00:00.000Z",
        "2026-08-20T14:00:00.000Z",
      );
    moved.raw
      .prepare(
        `UPDATE build_profiles
            SET accepted_plan_revision_id = ?, accepted_plan_version = 2
          WHERE tenant_id = 'default' AND id = ?`,
      )
      .run(Number(nextRevision.lastInsertRowid), moved.profile.id);
    const staleAbandon = moved.repo.transitionPlanDraft({
      profileId: moved.profile.id,
      draftId: moved.draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    expect(staleAbandon.kind).toBe("transitioned");
    if (staleAbandon.kind !== "transitioned") throw new Error("stale draft was not abandoned");
    expect(
      moved.repo.transitionPlanDraft({
        profileId: moved.profile.id,
        draftId: moved.draft.id,
        transition: { kind: "resume", expectedLifecycleVersion: 1 },
      }),
    ).toEqual({ kind: "base_changed", draft: staleAbandon.draft });
    moved.database.close();
  });

  it("rejects terminal, corrupt, foreign, and invalid-generation transitions", () => {
    const wrongSource = editableDraftFixture();
    expect(
      wrongSource.repo.transitionPlanDraft({
        profileId: wrongSource.profile.id,
        draftId: wrongSource.draft.id,
        transition: { kind: "resume", expectedLifecycleVersion: 0 },
      }),
    ).toEqual({ kind: "not_allowed", state: "open" });
    wrongSource.repo.transitionPlanDraft({
      profileId: wrongSource.profile.id,
      draftId: wrongSource.draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    expect(
      wrongSource.repo.transitionPlanDraft({
        profileId: wrongSource.profile.id,
        draftId: wrongSource.draft.id,
        transition: { kind: "abandon", expectedLifecycleVersion: 1 },
      }),
    ).toEqual({ kind: "not_allowed", state: "abandoned" });
    wrongSource.database.close();

    const consumed = editableDraftFixture();
    consumed.raw
      .prepare("UPDATE plan_drafts SET state = 'consumed', lifecycle_version = lifecycle_version + 1 WHERE id = ?")
      .run(consumed.draft.id);
    for (const kind of ["abandon", "resume"] as const) {
      expect(
        consumed.repo.transitionPlanDraft({
          profileId: consumed.profile.id,
          draftId: consumed.draft.id,
          transition: { kind, expectedLifecycleVersion: 1 },
        }),
      ).toEqual({ kind: "not_allowed", state: "consumed" });
    }
    const otherTenant = new AppRepository(
      getDb(consumed.database),
      "farm-b",
      consumed.database.reposDir,
    );
    expect(
      otherTenant.transitionPlanDraft({
        profileId: consumed.profile.id,
        draftId: consumed.draft.id,
        transition: { kind: "abandon", expectedLifecycleVersion: 0 },
      }),
    ).toEqual({ kind: "not_found" });
    const otherProfile = consumed.repo.createProfile("Other lifecycle Build");
    expect(
      consumed.repo.transitionPlanDraft({
        profileId: otherProfile.id,
        draftId: consumed.draft.id,
        transition: { kind: "abandon", expectedLifecycleVersion: 0 },
      }),
    ).toEqual({ kind: "not_found" });
    expect(
      consumed.repo.transitionPlanDraft({
        profileId: consumed.profile.id,
        draftId: consumed.draft.id,
        transition: {
          kind: "abandon",
          expectedLifecycleVersion: MAX_PLAN_DRAFT_LIFECYCLE_VERSION - 1,
        },
      }),
    ).toEqual({ kind: "not_allowed", state: "consumed" });
    expect(() =>
      consumed.repo.transitionPlanDraft({
        profileId: consumed.profile.id,
        draftId: consumed.draft.id,
        transition: {
          kind: "abandon",
          expectedLifecycleVersion: MAX_PLAN_DRAFT_LIFECYCLE_VERSION,
        },
      }),
    ).toThrow(/lifecycle version/i);
    consumed.database.close();

    const corrupt = editableDraftFixture();
    corrupt.raw
      .prepare("UPDATE plan_drafts SET snapshot_digest = ? WHERE id = ?")
      .run("0".repeat(64), corrupt.draft.id);
    expect(() =>
      corrupt.repo.transitionPlanDraft({
        profileId: corrupt.profile.id,
        draftId: corrupt.draft.id,
        transition: { kind: "abandon", expectedLifecycleVersion: 0 },
      }),
    ).toThrow(/digest mismatch/i);
    expect(
      corrupt.raw
        .prepare("SELECT state, lifecycle_version FROM plan_drafts WHERE id = ?")
        .get(corrupt.draft.id),
    ).toEqual({ state: "open", lifecycle_version: 0 });
    corrupt.database.close();
  });

  it("rolls back lifecycle state and generation when the transition write fails", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    const before = snapshotTables(raw, [
      ...ACCEPTED_STATE_TABLES,
      "plan_drafts",
      "plan_draft_inputs",
      "plan_draft_parts",
    ]);
    raw.exec(`
      CREATE TRIGGER corrupt_plan_draft_after_transition
      AFTER UPDATE OF state ON plan_drafts
      BEGIN
        UPDATE plan_drafts SET snapshot_digest = '${"0".repeat(64)}' WHERE id = NEW.id;
      END
    `);
    expect(() =>
      repo.transitionPlanDraft({
        profileId: profile.id,
        draftId: draft.id,
        transition: { kind: "abandon", expectedLifecycleVersion: 0 },
      }),
    ).toThrow(/digest mismatch/i);
    for (const [table, rows] of before) {
      expect(raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(rows);
    }
    database.close();
  });

  it("rebases saved Part decisions onto a newer accepted Plan without changing accepted state", () => {
    const { database, raw, profile, repo, draft, root } = editableDraftFixture();
    const partId = draft.parts[0]?.id;
    if (!partId) throw new Error("editable draft Part is missing");
    const edited = repo.editPlanDraftParts({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: draft.snapshotDigest,
      decision: { kind: "set_included", partIds: [partId], value: false },
    });
    if (edited.kind !== "updated") throw new Error("test draft was not edited");
    const abandoned = repo.transitionPlanDraft({
      profileId: profile.id,
      draftId: draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    if (abandoned.kind !== "transitioned") throw new Error("test draft was not abandoned");
    const nextRevisionId = advanceEmptyAcceptedRevision({
      raw,
      profileId: profile.id,
      parentRevisionId: draft.baseRevisionId,
    });
    const acceptedBefore = snapshotTables(raw, ACCEPTED_STATE_TABLES);

    const result = repo.rebasePlanDraft({
      profileId: profile.id,
      sourceDraftId: draft.id,
      expectedSourceLifecycleVersion: 1,
      expectedSourceSnapshotDigest: edited.draft.snapshotDigest,
      actor: "test:user",
      idempotencyKey: "rebase-draft",
    });

    expect(result).toMatchObject({
      kind: "rebased",
      draft: {
        baseRevisionId: nextRevisionId,
        basePlanVersion: 2,
        state: "open",
        lifecycleVersion: 0,
        origin: {
          kind: "rebase",
          sourceDraftId: draft.id,
          sourceLifecycleVersion: 1,
          sourceSnapshotDigest: edited.draft.snapshotDigest,
        },
        parts: expect.arrayContaining([
          expect.objectContaining({ partKey: "bracket.stl", included: false }),
        ]),
      },
    });
    if (result.kind !== "rebased") throw new Error("test draft was not rebased");
    raw
      .prepare(
        "UPDATE plan_drafts SET state = 'open', lifecycle_version = lifecycle_version + 1 WHERE id = ?",
      )
      .run(draft.id);
    expect(
      repo.rebasePlanDraft({
        profileId: profile.id,
        sourceDraftId: draft.id,
        expectedSourceLifecycleVersion: 1,
        expectedSourceSnapshotDigest: edited.draft.snapshotDigest,
        actor: "test:user",
        idempotencyKey: "rebase-draft",
      }),
    ).toEqual({ kind: "existing", draft: result.draft });
    expect(
      repo.rebasePlanDraft({
        profileId: profile.id,
        sourceDraftId: draft.id,
        expectedSourceLifecycleVersion: 1,
        expectedSourceSnapshotDigest: edited.draft.snapshotDigest,
        actor: "test:other-user",
        idempotencyKey: "other-rebase-key",
      }),
    ).toEqual({ kind: "existing", draft: result.draft });
    expect(
      repo.recomputePlanDraft({
        profileId: profile.id,
        actor: "test:user",
        idempotencyKey: "rebase-draft",
      }),
    ).toEqual({ kind: "idempotency_conflict" });
    expect(
      repo.rebasePlanDraft({
        profileId: profile.id,
        sourceDraftId: draft.id,
        expectedSourceLifecycleVersion: 2,
        expectedSourceSnapshotDigest: edited.draft.snapshotDigest,
        actor: "test:user",
        idempotencyKey: "editable-draft",
      }),
    ).toEqual({ kind: "idempotency_conflict" });
    for (const [table, rows] of acceptedBefore) {
      expect(raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(rows);
    }
    database.close();
    const reopened = new SqliteDatabase(root);
    reopened.connect();
    const reopenedRepo = new AppRepository(getDb(reopened), "default", reopened.reposDir);
    expect(reopenedRepo.getPlanDraft(profile.id, result.draft.id)).toEqual(result.draft);
    reopened.close();
  });

  it("refuses a same-base rebase and detects lifecycle ABA", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    const abandoned = repo.transitionPlanDraft({
      profileId: profile.id,
      draftId: draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    if (abandoned.kind !== "transitioned") throw new Error("test draft was not abandoned");
    const request = {
      profileId: profile.id,
      sourceDraftId: draft.id,
      expectedSourceLifecycleVersion: 1,
      expectedSourceSnapshotDigest: draft.snapshotDigest,
      actor: "test:user",
      idempotencyKey: "same-base-rebase",
    } as const;

    expect(repo.rebasePlanDraft(request)).toEqual({ kind: "base_unchanged" });
    const otherTenant = new AppRepository(getDb(database), "farm-b", database.reposDir);
    expect(otherTenant.rebasePlanDraft(request)).toEqual({ kind: "not_found" });
    const otherProfile = repo.createProfile("Other rebase Build");
    expect(
      repo.rebasePlanDraft({ ...request, profileId: otherProfile.id }),
    ).toEqual({ kind: "not_found" });
    raw
      .prepare(
        "UPDATE plan_drafts SET state = 'open', lifecycle_version = lifecycle_version + 1 WHERE id = ?",
      )
      .run(draft.id);
    raw
      .prepare(
        "UPDATE plan_drafts SET state = 'abandoned', lifecycle_version = lifecycle_version + 1 WHERE id = ?",
      )
      .run(draft.id);
    expect(repo.rebasePlanDraft(request)).toMatchObject({
      kind: "source_conflict",
      draft: { id: draft.id, state: "abandoned", lifecycleVersion: 3 },
    });
    expect(raw.prepare("SELECT count(*) AS count FROM plan_drafts").get()).toEqual({ count: 1 });
    database.close();
  });

  it("detects accepted movement before same-base refusal and immutable revision loading", () => {
    const sameBase = editableDraftFixture();
    const sameBaseAbandoned = sameBase.repo.transitionPlanDraft({
      profileId: sameBase.profile.id,
      draftId: sameBase.draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    if (sameBaseAbandoned.kind !== "transitioned") {
      throw new Error("test draft was not abandoned");
    }
    let sameBaseMoved = false;
    Object.assign(sameBase.repo, {
      planDraftNeedsAcceptedBaseline: () => {
        if (!sameBaseMoved) {
          sameBaseMoved = true;
          advanceEmptyAcceptedRevision({
            raw: sameBase.raw,
            profileId: sameBase.profile.id,
            parentRevisionId: sameBase.draft.baseRevisionId,
          });
        }
        return false;
      },
    });
    expect(
      sameBase.repo.rebasePlanDraft({
        profileId: sameBase.profile.id,
        sourceDraftId: sameBase.draft.id,
        expectedSourceLifecycleVersion: 1,
        expectedSourceSnapshotDigest: sameBase.draft.snapshotDigest,
        actor: "test:user",
        idempotencyKey: "same-base-moved",
      }),
    ).toEqual({ kind: "base_changed" });
    expect(sameBase.raw.prepare("SELECT count(*) AS count FROM plan_drafts").get()).toEqual({
      count: 1,
    });
    sameBase.database.close();

    const revisionLoad = editableDraftFixture();
    const revisionLoadAbandoned = revisionLoad.repo.transitionPlanDraft({
      profileId: revisionLoad.profile.id,
      draftId: revisionLoad.draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    if (revisionLoadAbandoned.kind !== "transitioned") {
      throw new Error("test draft was not abandoned");
    }
    const secondRevisionId = advanceEmptyAcceptedRevision({
      raw: revisionLoad.raw,
      profileId: revisionLoad.profile.id,
      parentRevisionId: revisionLoad.draft.baseRevisionId,
    });
    const thirdRevision = revisionLoad.raw
      .prepare(
        `INSERT INTO plan_revisions (
          tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
          provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
          created_at, accepted_at
        ) VALUES ('default', ?, 3, ?, NULL, 'legacy', 'plan-revision-parts-v1', ?,
          'test', 'test', ?, ?)`,
      )
      .run(
        revisionLoad.profile.id,
        secondRevisionId,
        "8".repeat(64),
        "2026-08-20T16:00:00.000Z",
        "2026-08-20T16:00:00.000Z",
      );
    let revisionLoadMoved = false;
    Object.assign(revisionLoad.repo, {
      planDraftNeedsAcceptedBaseline: () => {
        if (!revisionLoadMoved) {
          revisionLoadMoved = true;
          revisionLoad.raw
            .prepare(
              `UPDATE build_profiles
                  SET accepted_plan_revision_id = ?, accepted_plan_version = 3
                WHERE tenant_id = 'default' AND id = ?`,
            )
            .run(Number(thirdRevision.lastInsertRowid), revisionLoad.profile.id);
        }
        return false;
      },
    });
    expect(
      revisionLoad.repo.rebasePlanDraft({
        profileId: revisionLoad.profile.id,
        sourceDraftId: revisionLoad.draft.id,
        expectedSourceLifecycleVersion: 1,
        expectedSourceSnapshotDigest: revisionLoad.draft.snapshotDigest,
        actor: "test:user",
        idempotencyKey: "revision-load-moved",
      }),
    ).toEqual({ kind: "base_changed" });
    expect(
      revisionLoad.raw.prepare("SELECT count(*) AS count FROM plan_drafts").get(),
    ).toEqual({ count: 1 });
    revisionLoad.database.close();
  });

  it("writes nothing when a newer accepted quantity conflicts with the saved decision", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    const partId = draft.parts[0]?.id;
    if (!partId) throw new Error("editable draft Part is missing");
    const edited = repo.editPlanDraftParts({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: draft.snapshotDigest,
      decision: { kind: "set_quantity_override", partIds: [partId], value: 3 },
    });
    if (edited.kind !== "updated") throw new Error("test draft was not edited");
    const abandoned = repo.transitionPlanDraft({
      profileId: profile.id,
      draftId: draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    if (abandoned.kind !== "transitioned") throw new Error("test draft was not abandoned");
    const nextRevisionId = advanceEmptyAcceptedRevision({
      raw,
      profileId: profile.id,
      parentRevisionId: draft.baseRevisionId,
    });
    raw
      .prepare(
        `INSERT INTO plan_revision_parts (
          tenant_id, revision_id, projection_part_id, part_key, relative_path, filename,
          source_layer, status, role_inferred, role_override, filament_color_id,
          filament_custom_hex, spoolman_spool_id, quantity_inferred, quantity_override,
          quantity_effective, included, notes, github_blob_url, geometry_same, requirement,
          option_group_id, manifest_source, artifact_digest
        ) SELECT tenant_id, ?, projection_part_id, part_key, relative_path, filename,
          source_layer, status, role_inferred, role_override, filament_color_id,
          filament_custom_hex, spoolman_spool_id, quantity_inferred,
          CASE WHEN part_key = 'bracket.stl' THEN 4 ELSE quantity_override END,
          CASE WHEN part_key = 'bracket.stl' THEN 4 ELSE quantity_effective END,
          included, notes, github_blob_url, geometry_same, requirement, option_group_id,
          manifest_source, artifact_digest
          FROM plan_revision_parts WHERE revision_id = ?`,
      )
      .run(nextRevisionId, draft.baseRevisionId);
    const before = snapshotTables(raw, [
      ...ACCEPTED_STATE_TABLES,
      "plan_drafts",
      "plan_draft_inputs",
      "plan_draft_parts",
    ]);

    expect(
      repo.rebasePlanDraft({
        profileId: profile.id,
        sourceDraftId: draft.id,
        expectedSourceLifecycleVersion: 1,
        expectedSourceSnapshotDigest: edited.draft.snapshotDigest,
        actor: "test:user",
        idempotencyKey: "conflicting-rebase",
      }),
    ).toMatchObject({
      kind: "merge_conflicts",
      conflicts: [{ kind: "concurrent_decision", field: "quantityOverride" }],
    });
    for (const [table, rows] of before) {
      expect(raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(rows);
    }
    database.close();
  });

  it("returns typed zero-write outcomes when the rebase base or inputs move before write", () => {
    const baseRace = editableDraftFixture();
    const baseAbandoned = baseRace.repo.transitionPlanDraft({
      profileId: baseRace.profile.id,
      draftId: baseRace.draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    if (baseAbandoned.kind !== "transitioned") throw new Error("test draft was not abandoned");
    advanceEmptyAcceptedRevision({
      raw: baseRace.raw,
      profileId: baseRace.profile.id,
      parentRevisionId: baseRace.draft.baseRevisionId,
    });
    const thirdRevision = baseRace.raw
      .prepare(
        `INSERT INTO plan_revisions (
          tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
          provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
          created_at, accepted_at
        ) VALUES ('default', ?, 3, NULL, NULL, 'legacy', 'plan-revision-parts-v1', ?,
          'test', 'test', ?, ?)`,
      )
      .run(
        baseRace.profile.id,
        "8".repeat(64),
        "2026-08-20T16:00:00.000Z",
        "2026-08-20T16:00:00.000Z",
      );
    const nativeBaseTransaction = baseRace.repo.transaction.bind(baseRace.repo);
    baseRace.repo.transaction = <T>(
      fn: () => T,
      behavior: "deferred" | "immediate" = "deferred",
    ): T => {
      baseRace.raw
        .prepare(
          `UPDATE build_profiles
              SET accepted_plan_revision_id = ?, accepted_plan_version = 3
            WHERE tenant_id = 'default' AND id = ?`,
        )
        .run(Number(thirdRevision.lastInsertRowid), baseRace.profile.id);
      return nativeBaseTransaction(fn, behavior);
    };
    expect(
      baseRace.repo.rebasePlanDraft({
        profileId: baseRace.profile.id,
        sourceDraftId: baseRace.draft.id,
        expectedSourceLifecycleVersion: 1,
        expectedSourceSnapshotDigest: baseRace.draft.snapshotDigest,
        actor: "test:user",
        idempotencyKey: "base-race-rebase",
      }),
    ).toEqual({ kind: "base_changed" });
    expect(baseRace.raw.prepare("SELECT count(*) AS count FROM plan_drafts").get()).toEqual({
      count: 1,
    });
    baseRace.database.close();

    const inputRace = editableDraftFixture();
    const inputAbandoned = inputRace.repo.transitionPlanDraft({
      profileId: inputRace.profile.id,
      draftId: inputRace.draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    if (inputAbandoned.kind !== "transitioned") throw new Error("test draft was not abandoned");
    advanceEmptyAcceptedRevision({
      raw: inputRace.raw,
      profileId: inputRace.profile.id,
      parentRevisionId: inputRace.draft.baseRevisionId,
    });
    const nativeInputTransaction = inputRace.repo.transaction.bind(inputRace.repo);
    inputRace.repo.transaction = <T>(
      fn: () => T,
      behavior: "deferred" | "immediate" = "deferred",
    ): T => {
      inputRace.repo.updateImportRules(inputRace.source.id, ["parts/"]);
      return nativeInputTransaction(fn, behavior);
    };
    expect(
      inputRace.repo.rebasePlanDraft({
        profileId: inputRace.profile.id,
        sourceDraftId: inputRace.draft.id,
        expectedSourceLifecycleVersion: 1,
        expectedSourceSnapshotDigest: inputRace.draft.snapshotDigest,
        actor: "test:user",
        idempotencyKey: "input-race-rebase",
      }),
    ).toEqual({ kind: "inputs_changed" });
    expect(inputRace.raw.prepare("SELECT count(*) AS count FROM plan_drafts").get()).toEqual({
      count: 1,
    });
    inputRace.database.close();
  });

  it("returns the transaction-local source when a concurrent successor conflicts", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    const abandoned = repo.transitionPlanDraft({
      profileId: profile.id,
      draftId: draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    if (abandoned.kind !== "transitioned") throw new Error("test draft was not abandoned");
    advanceEmptyAcceptedRevision({
      raw,
      profileId: profile.id,
      parentRevisionId: draft.baseRevisionId,
    });
    const concurrentRepo = new AppRepository(getDb(database), "default", database.reposDir);
    const nativeTransaction = repo.transaction.bind(repo);
    repo.transaction = <T>(
      fn: () => T,
      behavior: "deferred" | "immediate" = "deferred",
    ): T => {
      const successor = concurrentRepo.rebasePlanDraft({
        profileId: profile.id,
        sourceDraftId: draft.id,
        expectedSourceLifecycleVersion: 1,
        expectedSourceSnapshotDigest: draft.snapshotDigest,
        actor: "test:concurrent",
        idempotencyKey: "concurrent-successor",
      });
      if (successor.kind !== "rebased") throw new Error("concurrent rebase was not created");
      raw.exec(`
        DROP TRIGGER trg_plan_drafts_lineage_immutable;
        DROP TRIGGER trg_plan_drafts_identity_immutable
      `);
      raw
        .prepare("UPDATE plan_drafts SET rebased_from_snapshot_digest = ? WHERE id = ?")
        .run("0".repeat(64), successor.draft.id);
      raw
        .prepare(
          "UPDATE plan_drafts SET state = 'open', lifecycle_version = lifecycle_version + 1 WHERE id = ?",
        )
        .run(draft.id);
      return nativeTransaction(fn, behavior);
    };

    expect(
      repo.rebasePlanDraft({
        profileId: profile.id,
        sourceDraftId: draft.id,
        expectedSourceLifecycleVersion: 1,
        expectedSourceSnapshotDigest: draft.snapshotDigest,
        actor: "test:user",
        idempotencyKey: "losing-rebase",
      }),
    ).toMatchObject({
      kind: "source_conflict",
      draft: { id: draft.id, state: "open", lifecycleVersion: 2 },
    });
    database.close();
  });

  it("enforces immutable complete rebase lineage and one successor per source generation", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    expect(() =>
      raw
        .prepare(
          "UPDATE plan_drafts SET rebased_from_draft_id = ? WHERE id = ?",
        )
        .run(draft.id, draft.id),
    ).toThrow(/lineage/i);
    const abandoned = repo.transitionPlanDraft({
      profileId: profile.id,
      draftId: draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    if (abandoned.kind !== "transitioned") throw new Error("test draft was not abandoned");
    const insertSuccessor = raw.prepare(
      `INSERT INTO plan_drafts (
        tenant_id, profile_id, base_revision_id, base_plan_version, state,
        lifecycle_version, rebased_from_draft_id, rebased_from_lifecycle_version,
        rebased_from_snapshot_digest, digest_format, snapshot_digest, created_by,
        idempotency_key, created_at
      ) SELECT tenant_id, profile_id, base_revision_id, base_plan_version, 'open', 0,
        id, lifecycle_version, snapshot_digest, digest_format, snapshot_digest, ?, ?, created_at
        FROM plan_drafts WHERE id = ?`,
    );
    const inserted = insertSuccessor.run("test:successor", "lineage-one", draft.id);
    const successorId = Number(inserted.lastInsertRowid);
    expect(() =>
      insertSuccessor.run("test:other", "lineage-two", draft.id),
    ).toThrow(/unique/i);
    expect(() =>
      raw
        .prepare(
          "UPDATE plan_drafts SET rebased_from_snapshot_digest = ? WHERE id = ?",
        )
        .run("0".repeat(64), successorId),
    ).toThrow(/immutable/i);
    const otherProfile = repo.createProfile("Other lineage Build");
    expect(() =>
      raw
        .prepare(
          `INSERT INTO plan_drafts (
            tenant_id, profile_id, base_revision_id, base_plan_version, state,
            lifecycle_version, rebased_from_draft_id, rebased_from_lifecycle_version,
            rebased_from_snapshot_digest, digest_format, snapshot_digest, created_by,
            idempotency_key, created_at
          ) SELECT tenant_id, ?, NULL, 0, 'open', 0, id, lifecycle_version,
            snapshot_digest, digest_format, snapshot_digest, 'test:foreign',
            'foreign-lineage', created_at FROM plan_drafts WHERE id = ?`,
        )
        .run(otherProfile.id, draft.id),
    ).toThrow(/lineage/i);
    expect(
      raw
        .prepare("DELETE FROM build_profiles WHERE tenant_id = 'default' AND id = ?")
        .run(profile.id).changes,
    ).toBe(1);
    expect(
      raw.prepare("SELECT count(*) AS count FROM plan_drafts WHERE profile_id = ?").get(profile.id),
    ).toEqual({ count: 0 });
    expect(raw.prepare("SELECT count(*) AS count FROM plan_draft_inputs").get()).toEqual({
      count: 0,
    });
    expect(raw.prepare("SELECT count(*) AS count FROM plan_draft_parts").get()).toEqual({
      count: 0,
    });
    database.close();
  });

  it("rolls back every rebase row when a result Part insert fails", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    const abandoned = repo.transitionPlanDraft({
      profileId: profile.id,
      draftId: draft.id,
      transition: { kind: "abandon", expectedLifecycleVersion: 0 },
    });
    if (abandoned.kind !== "transitioned") throw new Error("test draft was not abandoned");
    advanceEmptyAcceptedRevision({
      raw,
      profileId: profile.id,
      parentRevisionId: draft.baseRevisionId,
    });
    raw.exec(`
      CREATE TRIGGER reject_rebased_draft_part
      BEFORE INSERT ON plan_draft_parts
      WHEN EXISTS (
        SELECT 1 FROM plan_drafts draft
         WHERE draft.id = NEW.draft_id AND draft.rebased_from_draft_id IS NOT NULL
      )
      BEGIN
        SELECT RAISE(ABORT, 'injected rebase Part failure');
      END
    `);
    const before = snapshotTables(raw, [
      ...ACCEPTED_STATE_TABLES,
      "plan_drafts",
      "plan_draft_inputs",
      "plan_draft_parts",
    ]);

    expect(() =>
      repo.rebasePlanDraft({
        profileId: profile.id,
        sourceDraftId: draft.id,
        expectedSourceLifecycleVersion: 1,
        expectedSourceSnapshotDigest: draft.snapshotDigest,
        actor: "test:user",
        idempotencyKey: "rollback-rebase",
      }),
    ).toThrow(/injected rebase Part failure/i);
    for (const [table, rows] of before) {
      expect(raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(rows);
    }
    database.close();
  });

  it("rolls back the header and inputs when a draft Part insert fails", () => {
    const { database, raw, repo } = fixture();
    const sourceRoot = join(database.reposDir, "rollback-source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "part.stl"), "solid part");
    const source = repo.createSource({
      name: "Rollback source",
      source_kind: "local",
      local_path: sourceRoot,
    });
    const profile = repo.createProfile("Rollback Build", source.id);
    raw.exec(
      `CREATE TRIGGER reject_draft_part
       BEFORE INSERT ON plan_draft_parts
       BEGIN
         SELECT RAISE(ABORT, 'injected draft Part failure');
       END`,
    );

    expect(() =>
      repo.recomputePlanDraft({
        profileId: profile.id,
        actor: "test:user",
        idempotencyKey: "rollback-draft",
      }),
    ).toThrow(/injected draft Part failure/i);
    for (const table of ["plan_drafts", "plan_draft_inputs", "plan_draft_parts"]) {
      expect(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    database.close();
  });

  it("saves, retries, supersedes, and invalidates frozen Required-unit reconciliation", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    backfillCurrentRequiredUnitSets(raw, {
      tokenFactory: (() => {
        let value = 1;
        return () => `ppu_${(value++).toString(16).padStart(32, "0")}`;
      })(),
    });
    const bracket = draft.parts.find((part) => part.filename === "bracket.stl");
    const gear = draft.parts.find((part) => part.filename === "gear.stl");
    if (!bracket?.baseRevisionPartId || !gear?.baseRevisionPartId) {
      throw new Error("test draft predecessors are missing");
    }
    const decisions = [
      {
        kind: "accept_prior_completion" as const,
        targetDraftPartId: bracket.id,
        predecessorRevisionPartId: bracket.baseRevisionPartId,
      },
      { kind: "replace" as const, targetDraftPartId: gear.id },
    ];
    const protectedBefore = snapshotTables(raw, ACCEPTED_STATE_TABLES);
    const expectedAssignmentCount = draft.parts.reduce(
      (total, part) => total + part.quantityEffective,
      0,
    );
    const first = repo.savePlanDraftRequiredUnitReconciliation({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: draft.snapshotDigest,
      decisions,
      actorId: "test:user",
      idempotencyKey: "required-units-first",
    });
    expect(first).toMatchObject({
      kind: "saved",
      draft: { digestFormat: "plan-draft-v2" },
      reconciliation: { resultKind: "ready", expectedAssignmentCount },
    });
    if (first.kind !== "saved") throw new Error("reconciliation was not saved");
    expect(first.reconciliation.assignments[0]).toMatchObject({
        kind: "reuse",
        draftPartId: bracket.id,
        unitIndex: 0,
    });
    expect(first.reconciliation.assignments.slice(1)).toEqual(
      Array.from({ length: gear.quantityEffective }, (_, unitIndex) => ({
        kind: "create",
        draftPartId: gear.id,
        unitIndex,
      })),
    );
    expect(
      repo.savePlanDraftRequiredUnitReconciliation({
        profileId: profile.id,
        draftId: draft.id,
        expectedSnapshotDigest: draft.snapshotDigest,
        decisions,
        actorId: "test:user",
        idempotencyKey: "required-units-first",
      }),
    ).toMatchObject({ kind: "existing" });
    expect(
      repo.savePlanDraftRequiredUnitReconciliation({
        profileId: profile.id,
        draftId: draft.id,
        expectedSnapshotDigest: draft.snapshotDigest,
        decisions: [],
        actorId: "test:user",
        idempotencyKey: "required-units-first",
      }),
    ).toEqual({ kind: "idempotency_conflict" });
    expect(
      repo.transitionPlanDraft({
        profileId: profile.id,
        draftId: draft.id,
        transition: { kind: "abandon", expectedLifecycleVersion: 0 },
      }),
    ).toMatchObject({
      kind: "transitioned",
      draft: { requiredUnitReconciliation: first.draft.requiredUnitReconciliation },
    });
    expect(
      repo.transitionPlanDraft({
        profileId: profile.id,
        draftId: draft.id,
        transition: { kind: "resume", expectedLifecycleVersion: 1 },
      }),
    ).toMatchObject({
      kind: "transitioned",
      draft: { requiredUnitReconciliation: first.draft.requiredUnitReconciliation },
    });
    const second = repo.savePlanDraftRequiredUnitReconciliation({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: first.draft.snapshotDigest,
      decisions,
      actorId: "test:user",
      idempotencyKey: "required-units-second",
    });
    expect(second).toMatchObject({ kind: "saved" });
    expect(
      repo.savePlanDraftRequiredUnitReconciliation({
        profileId: profile.id,
        draftId: draft.id,
        expectedSnapshotDigest: draft.snapshotDigest,
        decisions,
        actorId: "test:user",
        idempotencyKey: "required-units-first",
      }),
    ).toMatchObject({ kind: "superseded", reconciliationId: first.reconciliation.id });
    if (second.kind !== "saved") throw new Error("replacement reconciliation was not saved");
    const edited = repo.editPlanDraftParts({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: second.draft.snapshotDigest,
      decision: { kind: "set_included", partIds: [gear.id], value: false },
    });
    expect(edited).toMatchObject({
      kind: "updated",
      draft: {
        digestFormat: "plan-draft-v2",
        requiredUnitReconciliation: null,
      },
    });
    for (const [table, rows] of protectedBefore) {
      expect(raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).toEqual(rows);
    }
    expect(() =>
      raw
        .prepare(
          `UPDATE plan_draft_required_unit_reconciliations
              SET result_digest = ? WHERE id = ?`,
        )
        .run("f".repeat(64), first.reconciliation.id),
    ).toThrow(/finalization/i);
    expect(() =>
      raw
        .prepare("DELETE FROM plan_draft_required_unit_reconciliations WHERE id = ?")
        .run(first.reconciliation.id),
    ).toThrow(/immutable/i);
    expect(() =>
      raw
        .prepare(
          `UPDATE plan_draft_required_unit_assignments
              SET unit_index = unit_index + 1 WHERE reconciliation_id = ?`,
        )
        .run(first.reconciliation.id),
    ).toThrow(/immutable/i);
    expect(() => repo.deleteProfile(profile.id)).not.toThrow();
    for (const table of [
      "plan_draft_required_unit_reconciliations",
      "plan_draft_required_unit_decisions",
      "plan_draft_required_unit_assignments",
    ]) {
      expect(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    database.close();
  });

  it("upgrades a v23 draft without rewriting its v1 snapshot", () => {
    const { database, raw, profile, draft, root } = editableDraftFixture();
    raw.exec(`
      DROP TRIGGER IF EXISTS trg_plan_drafts_required_unit_selection_update;
      DROP TRIGGER IF EXISTS trg_plan_draft_required_unit_assignments_immutable_delete;
      DROP TRIGGER IF EXISTS trg_plan_draft_required_unit_assignments_immutable_update;
      DROP TRIGGER IF EXISTS trg_plan_draft_required_unit_assignments_ownership_insert;
      DROP TRIGGER IF EXISTS trg_plan_draft_required_unit_decisions_immutable_delete;
      DROP TRIGGER IF EXISTS trg_plan_draft_required_unit_decisions_immutable_update;
      DROP TRIGGER IF EXISTS trg_plan_draft_required_unit_decisions_ownership_insert;
      DROP TRIGGER IF EXISTS trg_plan_draft_required_unit_reconciliations_immutable_delete;
      DROP TRIGGER IF EXISTS trg_plan_draft_required_unit_reconciliations_finalize;
      DROP TRIGGER IF EXISTS trg_plan_draft_required_unit_reconciliations_ownership_insert;
      DROP TABLE plan_draft_required_unit_assignments;
      DROP TABLE plan_draft_required_unit_decisions;
      DROP TABLE plan_draft_required_unit_reconciliations;
      ALTER TABLE plan_drafts DROP COLUMN current_required_unit_reconciliation_id;
      UPDATE app_settings SET value = '23'
       WHERE tenant_id = 'default' AND key = 'schema_version';
    `);
    database.close();

    const migrated = new SqliteDatabase(root);
    migrated.connect();
    const migratedRepo = new AppRepository(getDb(migrated), "default", migrated.reposDir);
    expect(migratedRepo.getPlanDraft(profile.id, draft.id)).toEqual(draft);
    expect(
      (migrated as unknown as { sqlite: Database.Database }).sqlite
        .prepare(
          `SELECT value FROM app_settings
            WHERE tenant_id = 'default' AND key = 'schema_version'`,
        )
        .get(),
    ).toEqual({ value: "24" });
    migrated.close();
  });

  it("appends an unresolved reconciliation before a complete ready replacement", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    backfillCurrentRequiredUnitSets(raw, {
      tokenFactory: (() => {
        let value = 100;
        return () => `ppu_${(value++).toString(16).padStart(32, "0")}`;
      })(),
    });
    const unresolved = repo.savePlanDraftRequiredUnitReconciliation({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: draft.snapshotDigest,
      decisions: [],
      actorId: "test:user",
      idempotencyKey: "required-units-unresolved",
    });
    expect(unresolved).toMatchObject({
      kind: "saved",
      reconciliation: { resultKind: "unresolved", assignments: [], conflicts: expect.any(Array) },
    });
    if (unresolved.kind !== "saved") throw new Error("unresolved snapshot was not saved");
    expect(
      repo.savePlanDraftRequiredUnitReconciliation({
        profileId: profile.id,
        draftId: draft.id,
        expectedSnapshotDigest: draft.snapshotDigest,
        decisions: [],
        actorId: "test:user",
        idempotencyKey: "required-units-unresolved",
      }),
    ).toEqual({
      kind: "existing",
      draft: unresolved.draft,
      reconciliation: unresolved.reconciliation,
    });
    const decisions = draft.parts.map((part) => {
      if (part.baseRevisionPartId == null) throw new Error("test predecessor is missing");
      return {
        kind: "accept_prior_completion" as const,
        targetDraftPartId: part.id,
        predecessorRevisionPartId: part.baseRevisionPartId,
      };
    });
    expect(
      repo.savePlanDraftRequiredUnitReconciliation({
        profileId: profile.id,
        draftId: draft.id,
        expectedSnapshotDigest: unresolved.draft.snapshotDigest,
        decisions,
        actorId: "test:user",
        idempotencyKey: "required-units-ready",
      }),
    ).toMatchObject({ kind: "saved", reconciliation: { resultKind: "ready" } });
    expect(
      repo.getPlanDraftRequiredUnitReconciliation(
        profile.id,
        draft.id,
        unresolved.reconciliation.id,
      ),
    ).toEqual(unresolved.reconciliation);
    expect(
      raw.prepare("SELECT result_kind FROM plan_draft_required_unit_reconciliations ORDER BY id").all(),
    ).toEqual([{ result_kind: "unresolved" }, { result_kind: "ready" }]);
    expect(() => repo.deleteProfile(profile.id)).not.toThrow();
    expect(
      raw.prepare("SELECT count(*) AS count FROM plan_draft_required_unit_reconciliations").get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  it("reopens a complete shrink result with the same surplus and progress basis", () => {
    const { database, raw, profile, repo, draft, root } = editableDraftFixture();
    backfillCurrentRequiredUnitSets(raw, {
      tokenFactory: (() => {
        let value = 200;
        return () => `ppu_${(value++).toString(16).padStart(32, "0")}`;
      })(),
    });
    const gear = draft.parts.find((part) => part.filename === "gear.stl");
    if (!gear) throw new Error("gear draft Part is missing");
    const edited = repo.editPlanDraftParts({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: draft.snapshotDigest,
      decision: { kind: "set_quantity_override", partIds: [gear.id], value: 1 },
    });
    if (edited.kind !== "updated") throw new Error("shrink edit was not applied");
    const decisions = edited.draft.parts.map((part) => {
      if (part.baseRevisionPartId == null) throw new Error("test predecessor is missing");
      return {
        kind: "accept_prior_completion" as const,
        targetDraftPartId: part.id,
        predecessorRevisionPartId: part.baseRevisionPartId,
      };
    });
    const saved = repo.savePlanDraftRequiredUnitReconciliation({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: edited.draft.snapshotDigest,
      decisions,
      actorId: "test:user",
      idempotencyKey: "required-units-shrink",
    });
    if (saved.kind !== "saved") throw new Error("shrink reconciliation was not saved");
    expect(saved.reconciliation.surplus).toHaveLength(2);
    expect(saved.reconciliation.selectionBasis).toHaveLength(3);
    database.close();

    const reopened = new SqliteDatabase(root);
    reopened.connect();
    const reopenedRepo = new AppRepository(getDb(reopened), "default", reopened.reposDir);
    expect(
      reopenedRepo.getPlanDraftRequiredUnitReconciliation(
        profile.id,
        draft.id,
        saved.reconciliation.id,
      ),
    ).toEqual(saved.reconciliation);
    expect(
      reopenedRepo.savePlanDraftRequiredUnitReconciliation({
        profileId: profile.id,
        draftId: draft.id,
        expectedSnapshotDigest: edited.draft.snapshotDigest,
        decisions,
        actorId: "test:user",
        idempotencyKey: "required-units-shrink",
      }),
    ).toEqual({ kind: "existing", draft: saved.draft, reconciliation: saved.reconciliation });
    reopened.close();
  });

  it("rejects wrong assignment tokens and every persisted result component mismatch", () => {
    const { database, raw, profile, repo, draft } = editableDraftFixture();
    backfillCurrentRequiredUnitSets(raw, {
      tokenFactory: (() => {
        let value = 300;
        return () => `ppu_${(value++).toString(16).padStart(32, "0")}`;
      })(),
    });
    const decisions = draft.parts.map((part) => {
      if (part.baseRevisionPartId == null) throw new Error("test predecessor is missing");
      return {
        kind: "accept_prior_completion" as const,
        targetDraftPartId: part.id,
        predecessorRevisionPartId: part.baseRevisionPartId,
      };
    });
    const saved = repo.savePlanDraftRequiredUnitReconciliation({
      profileId: profile.id,
      draftId: draft.id,
      expectedSnapshotDigest: draft.snapshotDigest,
      decisions,
      actorId: "test:user",
      idempotencyKey: "required-units-integrity",
    });
    if (saved.kind !== "saved") throw new Error("integrity reconciliation was not saved");
    const cloneHeader = raw.prepare(
      `INSERT INTO plan_draft_required_unit_reconciliations (
        tenant_id, profile_id, draft_id, format, planning_digest, base_revision_id,
        base_mapping_digest, selection_basis_digest, selection_basis_json,
        decision_digest, result_kind, result_digest, result_json,
        reconciliation_digest, expected_assignment_count, actor_id, idempotency_key,
        payload_digest, created_at, finalized_at
      ) SELECT tenant_id, profile_id, draft_id, format, planning_digest, base_revision_id,
        base_mapping_digest, selection_basis_digest, ?, decision_digest, result_kind,
        result_digest, ?, reconciliation_digest, expected_assignment_count, actor_id, ?,
        payload_digest, created_at, NULL
      FROM plan_draft_required_unit_reconciliations WHERE id = ?`,
    );
    const copyChildren = (reconciliationId: number, tokenOverride?: string) => {
      raw.prepare(
        `INSERT INTO plan_draft_required_unit_decisions (
          tenant_id, reconciliation_id, target_draft_part_id, kind,
          predecessor_revision_part_id
        ) SELECT tenant_id, ?, target_draft_part_id, kind, predecessor_revision_part_id
          FROM plan_draft_required_unit_decisions WHERE reconciliation_id = ?`,
      ).run(reconciliationId, saved.reconciliation.id);
      raw.prepare(
        `INSERT INTO plan_draft_required_unit_assignments (
          tenant_id, reconciliation_id, target_draft_part_id, unit_index, kind,
          required_unit_token
        ) SELECT tenant_id, ?, target_draft_part_id, unit_index, kind,
          CASE WHEN kind = 'reuse' AND ? IS NOT NULL THEN ? ELSE required_unit_token END
          FROM plan_draft_required_unit_assignments WHERE reconciliation_id = ?`,
      ).run(reconciliationId, tokenOverride ?? null, tokenOverride ?? null, saved.reconciliation.id);
    };
    const sourceHeader = raw
      .prepare(
        `SELECT selection_basis_json AS selectionBasisJson, result_json AS resultJson
           FROM plan_draft_required_unit_reconciliations WHERE id = ?`,
      )
      .get(saved.reconciliation.id) as
      | { selectionBasisJson: string; resultJson: string }
      | undefined;
    if (!sourceHeader) throw new Error("source reconciliation header is missing");
    const wrongToken = raw
      .prepare(
        `SELECT token FROM required_units
          WHERE tenant_id = 'default' AND profile_id = ?
            AND token NOT IN (
              SELECT required_unit_token FROM plan_draft_required_unit_assignments
               WHERE reconciliation_id = ? AND required_unit_token IS NOT NULL
            ) ORDER BY token LIMIT 1`,
      )
      .pluck()
      .get(profile.id, saved.reconciliation.id) as string | undefined;
    if (!wrongToken) throw new Error("same-Build wrong token fixture is missing");
    const wrong = cloneHeader.run(
      sourceHeader.selectionBasisJson,
      sourceHeader.resultJson,
      "wrong-token",
      saved.reconciliation.id,
    );
    copyChildren(Number(wrong.lastInsertRowid), wrongToken);
    expect(() =>
      raw
        .prepare(
          "UPDATE plan_draft_required_unit_reconciliations SET finalized_at = created_at WHERE id = ?",
        )
        .run(Number(wrong.lastInsertRowid)),
    ).toThrow(/finalization/i);

    const basisJson = raw
      .prepare(
        `SELECT json_set(?, '$[0].createdAt', json_extract(?, '$[0].createdAt') || 'x')`,
      )
      .pluck()
      .get(sourceHeader.selectionBasisJson, sourceHeader.selectionBasisJson) as string;
    const basis = cloneHeader.run(
      basisJson,
      sourceHeader.resultJson,
      "basis-tamper",
      saved.reconciliation.id,
    );
    copyChildren(Number(basis.lastInsertRowid));
    raw
      .prepare(
        "UPDATE plan_draft_required_unit_reconciliations SET finalized_at = created_at WHERE id = ?",
      )
      .run(Number(basis.lastInsertRowid));
    raw
      .prepare("UPDATE plan_drafts SET current_required_unit_reconciliation_id = ? WHERE id = ?")
      .run(Number(basis.lastInsertRowid), draft.id);
    expect(() => repo.getPlanDraft(profile.id, draft.id)).toThrow(/selection basis digest/i);

    const resultJson = raw
      .prepare("SELECT json_insert(?, '$.surplus[#]', ?)")
      .pluck()
      .get(sourceHeader.resultJson, `ppu_${"f".repeat(32)}`) as string;
    const result = cloneHeader.run(
      sourceHeader.selectionBasisJson,
      resultJson,
      "result-tamper",
      saved.reconciliation.id,
    );
    copyChildren(Number(result.lastInsertRowid));
    raw
      .prepare(
        "UPDATE plan_draft_required_unit_reconciliations SET finalized_at = created_at WHERE id = ?",
      )
      .run(Number(result.lastInsertRowid));
    raw
      .prepare("UPDATE plan_drafts SET current_required_unit_reconciliation_id = ? WHERE id = ?")
      .run(Number(result.lastInsertRowid), draft.id);
    expect(() => repo.getPlanDraft(profile.id, draft.id)).toThrow(/result digest/i);
    database.close();
  });

  it("resolves a delayed retry inside IMMEDIATE after another connection selects newer", () => {
    const firstConnection = editableDraftFixture();
    backfillCurrentRequiredUnitSets(firstConnection.raw, {
      tokenFactory: (() => {
        let value = 400;
        return () => `ppu_${(value++).toString(16).padStart(32, "0")}`;
      })(),
    });
    const decisions = firstConnection.draft.parts.map((part) => {
      if (part.baseRevisionPartId == null) throw new Error("test predecessor is missing");
      return {
        kind: "accept_prior_completion" as const,
        targetDraftPartId: part.id,
        predecessorRevisionPartId: part.baseRevisionPartId,
      };
    });
    const first = firstConnection.repo.savePlanDraftRequiredUnitReconciliation({
      profileId: firstConnection.profile.id,
      draftId: firstConnection.draft.id,
      expectedSnapshotDigest: firstConnection.draft.snapshotDigest,
      decisions,
      actorId: "test:user",
      idempotencyKey: "required-units-delayed",
    });
    if (first.kind !== "saved") throw new Error("first reconciliation was not saved");
    const secondDatabase = new SqliteDatabase(firstConnection.root);
    secondDatabase.connect();
    const secondRepo = new AppRepository(
      getDb(secondDatabase),
      "default",
      secondDatabase.reposDir,
    );
    const nativeTransaction = firstConnection.repo.transaction.bind(firstConnection.repo);
    let injected = false;
    firstConnection.repo.transaction = <T>(
      fn: () => T,
      behavior: "deferred" | "immediate" = "deferred",
    ): T => {
      if (!injected) {
        injected = true;
        expect(
          secondRepo.savePlanDraftRequiredUnitReconciliation({
            profileId: firstConnection.profile.id,
            draftId: firstConnection.draft.id,
            expectedSnapshotDigest: first.draft.snapshotDigest,
            decisions,
            actorId: "test:user",
            idempotencyKey: "required-units-newer",
          }),
        ).toMatchObject({ kind: "saved" });
      }
      return nativeTransaction(fn, behavior);
    };
    expect(
      firstConnection.repo.savePlanDraftRequiredUnitReconciliation({
        profileId: firstConnection.profile.id,
        draftId: firstConnection.draft.id,
        expectedSnapshotDigest: firstConnection.draft.snapshotDigest,
        decisions,
        actorId: "test:user",
        idempotencyKey: "required-units-delayed",
      }),
    ).toEqual({ kind: "superseded", reconciliationId: first.reconciliation.id });
    secondDatabase.close();
    firstConnection.database.close();
  });
});

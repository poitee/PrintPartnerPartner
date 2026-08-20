import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backfillAcceptedPlanRevisions } from "./accepted-plan-revisions.js";
import { getDb, SqliteDatabase } from "./client.js";
import { AppRepository } from "./repository.js";

const tempDirs: string[] = [];

function createDatabase(): { dir: string; database: SqliteDatabase } {
  const dir = mkdtempSync(join(tmpdir(), "pp-plan-revision-"));
  tempDirs.push(dir);
  const database = new SqliteDatabase(dir);
  database.connect();
  return { dir, database };
}

function rawDatabase(database: SqliteDatabase): Database.Database {
  return (database as unknown as { sqlite: Database.Database }).sqlite;
}

function repository(database: SqliteDatabase, tenantId = "default"): AppRepository {
  return new AppRepository(getDb(database), tenantId, database.reposDir);
}

function markAsV18(raw: Database.Database): void {
  raw.prepare(
    `UPDATE app_settings SET value = '18'
      WHERE tenant_id = 'default' AND key = 'schema_version'`,
  ).run();
}

function downgradeToV18(raw: Database.Database): void {
  raw.exec(`
    DROP TRIGGER IF EXISTS trg_plan_revisions_ownership_insert;
    DROP TRIGGER IF EXISTS trg_plan_revision_parts_ownership_insert;
    DROP TRIGGER IF EXISTS trg_build_profiles_revision_ownership_insert;
    DROP TRIGGER IF EXISTS trg_build_profiles_revision_ownership_update;
    DROP TRIGGER IF EXISTS trg_plan_revisions_immutable_update;
    DROP TRIGGER IF EXISTS trg_plan_revisions_immutable_delete;
    DROP TRIGGER IF EXISTS trg_plan_revision_parts_immutable_update;
    DROP TRIGGER IF EXISTS trg_plan_revision_parts_immutable_delete;
    DROP TRIGGER IF EXISTS trg_parts_invalidate_accepted_revision_insert;
    DROP TRIGGER IF EXISTS trg_parts_invalidate_accepted_revision_update;
    DROP TRIGGER IF EXISTS trg_parts_invalidate_accepted_revision_delete;
    DROP TRIGGER IF EXISTS trg_profile_layers_invalidate_accepted_revision_insert;
    DROP TRIGGER IF EXISTS trg_profile_layers_invalidate_accepted_revision_update;
    DROP TRIGGER IF EXISTS trg_profile_layers_invalidate_accepted_revision_delete;
    ALTER TABLE build_profiles DROP COLUMN accepted_plan_revision_id;
    ALTER TABLE build_profiles DROP COLUMN accepted_plan_version;
    DROP TABLE plan_revision_parts;
    DROP TABLE plan_revisions;
  `);
  markAsV18(raw);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("accepted Plan revision backfill", () => {
  it("does not manufacture a revision for a Build created on schema v19", () => {
    const { dir, database } = createDatabase();
    const profile = repository(database).createProfile("New empty Build");
    database.close();

    const reopened = new SqliteDatabase(dir);
    reopened.connect();
    expect(repository(reopened).getAcceptedPlanRevision(profile.id)).toBeNull();
    expect(
      rawDatabase(reopened)
        .prepare(
          `SELECT accepted_plan_revision_id, accepted_plan_version
             FROM build_profiles WHERE id = ?`,
        )
        .get(profile.id),
    ).toEqual({ accepted_plan_revision_id: null, accepted_plan_version: 0 });
    reopened.close();
  });

  it("fails closed on a corrupt recorded schema version", () => {
    const { dir, database } = createDatabase();
    rawDatabase(database)
      .prepare(
        `UPDATE app_settings SET value = 'not-a-version'
          WHERE tenant_id = 'default' AND key = 'schema_version'`,
      )
      .run();
    database.close();

    const reopened = new SqliteDatabase(dir);
    expect(() => reopened.connect()).toThrow(/invalid database schema version/i);
    reopened.close();
  });

  it("upgrades a populated v18-shaped Build", () => {
    const { dir, database } = createDatabase();
    const raw = rawDatabase(database);
    const profile = repository(database).createProfile("Existing v18 Build");
    raw.prepare(
      `INSERT INTO parts (
        tenant_id, profile_id, match_key, relative_path, filename, source_layer,
        status, role, quantity_auto, quantity_effective, included, notes
      ) VALUES ('default', ?, 'legacy', '', 'legacy.stl', '', 'base', 'primary', 1, 1, 1, '')`,
    ).run(profile.id);
    downgradeToV18(raw);
    database.close();

    const migrated = new SqliteDatabase(dir);
    expect(() => migrated.connect()).not.toThrow();
    expect(repository(migrated).getAcceptedPlanRevision(profile.id)).toMatchObject({
      planVersion: 1,
      revisionNumber: 1,
      parts: [expect.objectContaining({ partKey: "legacy" })],
    });
    migrated.close();
  });

  it("captures a tracked populated Build without changing live state", () => {
    const { dir, database } = createDatabase();
    const raw = rawDatabase(database);
    const profile = repository(database).createProfile("Tracked Trident");
    const part = raw
      .prepare(
        `INSERT INTO parts (
          tenant_id, profile_id, match_key, relative_path, filename, source_layer,
          status, role, filament_color_id, filament_custom_hex, spoolman_spool_id,
          quantity_auto, quantity_override, quantity_effective, included, notes,
          github_blob_url, geometry_same, requirement, option_group_id, manifest_source
        ) VALUES (
          'default', ?, 'gantry/clip', 'STLs/Gantry', 'clip.stl', 'voron',
          'modified', 'accent', 'orange', '#ff5500', '42',
          2, 3, 4, 1, 'print three',
          'https://example.test/clip.stl', 1, 'required', 'gantry', 'manifest.json'
        )`,
      )
      .run(profile.id);
    raw.prepare(
      `INSERT INTO print_progress (tenant_id, part_id, unit_index, completed, assembled)
       VALUES ('default', ?, 0, 1, 1)`,
    ).run(Number(part.lastInsertRowid));
    raw.prepare(
      `INSERT INTO app_settings (tenant_id, key, value)
       VALUES ('default', 'test_setting', 'preserve-me')`,
    ).run();
    const inputSet = raw
      .prepare(
        `INSERT INTO plan_revision_input_sets (
          tenant_id, profile_id, input_set_digest, expected_input_count,
          format_version, recorded_at, published_at
        ) VALUES ('default', ?, ?, 0, 2, ?, ?)`,
      )
      .run(
        profile.id,
        "a".repeat(64),
        "2026-08-20T10:00:00.000Z",
        "2026-08-20T10:00:00.000Z",
      );
    raw.prepare(
      `INSERT INTO plan_accepted_input_sets (tenant_id, profile_id, input_set_id, accepted_at)
       VALUES ('default', ?, ?, ?)`,
    ).run(profile.id, Number(inputSet.lastInsertRowid), "2026-08-20T10:00:00.000Z");

    const partsBefore = raw.prepare("SELECT * FROM parts ORDER BY id").all();
    const partRowsBefore = repository(database).listParts(profile.id).parts;
    const progressBefore = raw.prepare("SELECT * FROM print_progress ORDER BY id").all();
    const settingBefore = raw
      .prepare("SELECT * FROM app_settings WHERE key = 'test_setting'")
      .all();
    downgradeToV18(raw);
    database.close();

    const migrated = new SqliteDatabase(dir);
    migrated.connect();
    const accepted = repository(migrated).getAcceptedPlanRevision(profile.id);
    const migratedRaw = rawDatabase(migrated);

    expect(accepted).toMatchObject({
      profileId: profile.id,
      planVersion: 1,
      revisionNumber: 1,
      parentRevisionId: null,
      inputSetId: Number(inputSet.lastInsertRowid),
      provenanceKind: "tracked",
      digestFormat: "plan-revision-parts-v1",
      acceptedAt: "2026-08-20T10:00:00.000Z",
    });
    expect(accepted?.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(repository(migrated).getAcceptedPlanPartRows(profile.id)).toEqual(partRowsBefore);
    expect(accepted?.parts).toEqual([
      expect.objectContaining({
        projectionPartId: Number(part.lastInsertRowid),
        partKey: "gantry/clip",
        relativePath: "STLs/Gantry",
        filename: "clip.stl",
        sourceLayer: "voron",
        status: "modified",
        roleInferred: "accent",
        roleOverride: null,
        effectiveRole: "accent",
        filamentColorId: "orange",
        filamentCustomHex: "#ff5500",
        spoolmanSpoolId: "42",
        quantityInferred: 2,
        quantityOverride: 3,
        effectiveQuantity: 4,
        included: true,
        notes: "print three",
        githubBlobUrl: "https://example.test/clip.stl",
        geometrySame: true,
        requirement: "required",
        optionGroupId: "gantry",
        manifestSource: "manifest.json",
        artifactDigest: null,
      }),
    ]);
    expect(migratedRaw.prepare("SELECT * FROM parts ORDER BY id").all()).toEqual(partsBefore);
    expect(migratedRaw.prepare("SELECT * FROM print_progress ORDER BY id").all()).toEqual(
      progressBefore,
    );
    expect(
      migratedRaw.prepare("SELECT * FROM app_settings WHERE key = 'test_setting'").all(),
    ).toEqual(settingBefore);
    expect(() =>
      migratedRaw.prepare("DELETE FROM plan_revisions WHERE id = ?").run(accepted?.id),
    ).toThrow(/immutable/i);
    migrated.close();
  });

  it("returns accepted PartRows in the existing filename order", () => {
    const { dir, database } = createDatabase();
    const raw = rawDatabase(database);
    const profile = repository(database).createProfile("PartRow order");
    const insert = raw.prepare(
      `INSERT INTO parts (
        tenant_id, profile_id, match_key, relative_path, filename, source_layer,
        status, role, quantity_auto, quantity_effective, included, notes
      ) VALUES ('default', ?, ?, '', ?, '', 'base', 'primary', 1, 1, 1, '')`,
    );
    insert.run(profile.id, "z-path", "a-file.stl");
    insert.run(profile.id, "a-path", "z-file.stl");
    const livePartRows = repository(database).listParts(profile.id).parts;
    downgradeToV18(raw);
    database.close();

    const migrated = new SqliteDatabase(dir);
    migrated.connect();
    expect(repository(migrated).getAcceptedPlanPartRows(profile.id)).toEqual(livePartRows);
    migrated.close();
  });

  it("backfills empty legacy Builds once and keeps reads tenant-scoped", () => {
    const { dir, database } = createDatabase();
    const defaultProfile = repository(database).createProfile("Default empty");
    const tenantProfile = repository(database, "farm-b").createProfile("Farm B empty");
    downgradeToV18(rawDatabase(database));
    database.close();

    const first = new SqliteDatabase(dir);
    first.connect();
    const defaultAccepted = repository(first).getAcceptedPlanRevision(defaultProfile.id);
    const tenantAccepted = repository(first, "farm-b").getAcceptedPlanRevision(tenantProfile.id);
    const raw = rawDatabase(first);
    const firstRows = raw
      .prepare("SELECT * FROM plan_revisions ORDER BY tenant_id, profile_id, revision_number")
      .all();

    expect(defaultAccepted).toMatchObject({
      profileId: defaultProfile.id,
      planVersion: 1,
      provenanceKind: "legacy",
      inputSetId: null,
      parts: [],
    });
    expect(tenantAccepted).toMatchObject({
      profileId: tenantProfile.id,
      planVersion: 1,
      provenanceKind: "legacy",
      inputSetId: null,
      parts: [],
    });
    expect(repository(first).getAcceptedPlanRevision(tenantProfile.id)).toBeNull();
    first.close();

    const second = new SqliteDatabase(dir);
    second.connect();
    expect(
      rawDatabase(second)
        .prepare("SELECT * FROM plan_revisions ORDER BY tenant_id, profile_id, revision_number")
        .all(),
    ).toEqual(firstRows);
    second.close();
  });

  it("keeps Build deletion available after the accepted pointer is populated", () => {
    const { dir, database } = createDatabase();
    const profile = repository(database).createProfile("Disposable");
    downgradeToV18(rawDatabase(database));
    database.close();

    const migrated = new SqliteDatabase(dir);
    migrated.connect();
    const repo = repository(migrated);
    expect(repo.getAcceptedPlanRevision(profile.id)).not.toBeNull();
    expect(() => repo.deleteProfile(profile.id)).not.toThrow();
    expect(repo.getProfile(profile.id)).toBeNull();
    expect(
      rawDatabase(migrated)
        .prepare("SELECT count(*) AS count FROM plan_revisions WHERE profile_id = ?")
        .get(profile.id),
    ).toEqual({ count: 0 });
    migrated.close();
  });

  it("digests duplicate legacy keys independently of row identity and insertion order", () => {
    const { dir, database } = createDatabase();
    const raw = rawDatabase(database);
    const firstProfile = repository(database).createProfile("First order");
    const secondProfile = repository(database).createProfile("Second order");
    const insert = raw.prepare(
      `INSERT INTO parts (
        tenant_id, profile_id, match_key, relative_path, filename, source_layer,
        status, role, quantity_auto, quantity_effective, included, notes
      ) VALUES ('default', ?, 'duplicate', '', ?, '', 'base', 'primary', 1, 1, 1, '')`,
    );
    insert.run(firstProfile.id, "a.stl");
    insert.run(firstProfile.id, "b.stl");
    insert.run(secondProfile.id, "b.stl");
    insert.run(secondProfile.id, "a.stl");
    downgradeToV18(raw);
    database.close();

    const migrated = new SqliteDatabase(dir);
    migrated.connect();
    const repo = repository(migrated);
    expect(repo.getAcceptedPlanRevision(firstProfile.id)?.snapshotDigest).toBe(
      repo.getAcceptedPlanRevision(secondProfile.id)?.snapshotDigest,
    );
    expect(repo.getAcceptedPlanRevision(firstProfile.id)?.parts).toHaveLength(2);
    expect(repo.getAcceptedPlanRevision(secondProfile.id)?.parts).toHaveLength(2);
    migrated.close();
  });

  it("rolls back the complete Build when a snapshot row cannot be written", () => {
    const { database } = createDatabase();
    const raw = rawDatabase(database);
    const profile = repository(database).createProfile("Rollback");
    raw.prepare(
      `INSERT INTO parts (
        tenant_id, profile_id, match_key, relative_path, filename, source_layer,
        status, role, quantity_auto, quantity_effective, included, notes
      ) VALUES ('default', ?, 'bad', '', 'bad.stl', '', 'base', 'primary', 1, 1, 1, '')`,
    ).run(profile.id);
    raw.exec(
      `CREATE TRIGGER reject_revision_part
       BEFORE INSERT ON plan_revision_parts
       BEGIN
         SELECT RAISE(ABORT, 'injected revision part failure');
       END`,
    );

    expect(() =>
      backfillAcceptedPlanRevisions(raw, "2026-08-20T12:00:00.000Z"),
    ).toThrow(/injected revision part failure/i);
    expect(
      raw.prepare("SELECT count(*) AS count FROM plan_revisions WHERE profile_id = ?").get(
        profile.id,
      ),
    ).toEqual({ count: 0 });
    expect(
      raw
        .prepare(
          `SELECT accepted_plan_revision_id, accepted_plan_version
             FROM build_profiles WHERE id = ?`,
        )
        .get(profile.id),
    ).toEqual({ accepted_plan_revision_id: null, accepted_plan_version: 0 });
    database.close();
  });

  it("fails instead of omitting a legacy Part with a mismatched tenant", () => {
    const { dir, database } = createDatabase();
    const raw = rawDatabase(database);
    const profile = repository(database).createProfile("Mismatched Part");
    raw.prepare(
      `INSERT INTO parts (
        tenant_id, profile_id, match_key, relative_path, filename, source_layer,
        status, role, quantity_auto, quantity_effective, included, notes
      ) VALUES ('farm-b', ?, 'visible-before', '', 'visible.stl', '', 'base', 'primary', 1, 1, 1, '')`,
    ).run(profile.id);
    expect(repository(database).listParts(profile.id).parts).toEqual([
      expect.objectContaining({ match_key: "visible-before" }),
    ]);
    downgradeToV18(raw);
    database.close();

    const migrated = new SqliteDatabase(dir);
    expect(() => migrated.connect()).toThrow(/tenant does not match owning Build/i);
    migrated.close();
  });

  it("rejects accepted input provenance owned by another Build", () => {
    const { dir, database } = createDatabase();
    const raw = rawDatabase(database);
    const firstProfile = repository(database).createProfile("Wrong provenance");
    const secondProfile = repository(database).createProfile("Input owner");
    const inputSet = raw
      .prepare(
        `INSERT INTO plan_revision_input_sets (
          tenant_id, profile_id, input_set_digest, expected_input_count,
          format_version, recorded_at, published_at
        ) VALUES ('default', ?, ?, 0, 2, ?, ?)`,
      )
      .run(
        secondProfile.id,
        "c".repeat(64),
        "2026-08-20T14:00:00.000Z",
        "2026-08-20T14:00:00.000Z",
      );
    raw.prepare(
      `INSERT INTO plan_accepted_input_sets (tenant_id, profile_id, input_set_id, accepted_at)
       VALUES ('default', ?, ?, ?)`,
    ).run(
      firstProfile.id,
      Number(inputSet.lastInsertRowid),
      "2026-08-20T14:00:00.000Z",
    );
    downgradeToV18(raw);
    database.close();

    const migrated = new SqliteDatabase(dir);
    expect(() => migrated.connect()).toThrow(/accepted input set .* does not belong/i);
    migrated.close();
  });

  it("rejects cross-owner accepted revision relationships", () => {
    const { dir, database } = createDatabase();
    const initialRaw = rawDatabase(database);
    const firstProfile = repository(database).createProfile("First owner");
    const secondProfile = repository(database).createProfile("Second owner");
    initialRaw.prepare(
      `INSERT INTO parts (
        tenant_id, profile_id, match_key, relative_path, filename, source_layer,
        status, role, quantity_auto, quantity_effective, included, notes
      ) VALUES ('default', ?, 'second-part', '', 'second.stl', '', 'base', 'primary', 1, 1, 1, '')`,
    ).run(secondProfile.id);
    downgradeToV18(initialRaw);
    database.close();

    const migrated = new SqliteDatabase(dir);
    migrated.connect();
    const raw = rawDatabase(migrated);
    const first = repository(migrated).getAcceptedPlanRevision(firstProfile.id)!;
    const second = repository(migrated).getAcceptedPlanRevision(secondProfile.id)!;
    const secondInput = raw
      .prepare(
        `INSERT INTO plan_revision_input_sets (
          tenant_id, profile_id, input_set_digest, expected_input_count,
          format_version, recorded_at, published_at
        ) VALUES ('default', ?, ?, 0, 2, ?, ?)`,
      )
      .run(
        secondProfile.id,
        "b".repeat(64),
        "2026-08-20T13:00:00.000Z",
        "2026-08-20T13:00:00.000Z",
      );

    expect(() =>
      raw
        .prepare("UPDATE build_profiles SET accepted_plan_revision_id = ? WHERE id = ?")
        .run(second.id, firstProfile.id),
    ).toThrow(/ownership/i);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO plan_revisions (
            tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
            provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
            created_at, accepted_at
          ) VALUES ('default', ?, 2, ?, NULL, 'legacy', ?, ?, 'test', 'test', ?, ?)`,
        )
        .run(
          firstProfile.id,
          second.id,
          first.digestFormat,
          first.snapshotDigest,
          first.createdAt,
          first.acceptedAt,
        ),
    ).toThrow(/ownership/i);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO plan_revisions (
            tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
            provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
            created_at, accepted_at
          ) VALUES ('default', ?, 2, NULL, ?, 'tracked', ?, ?, 'test', 'test', ?, ?)`,
        )
        .run(
          firstProfile.id,
          Number(secondInput.lastInsertRowid),
          first.digestFormat,
          first.snapshotDigest,
          first.createdAt,
          first.acceptedAt,
        ),
    ).toThrow(/ownership/i);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO plan_revision_parts (
            tenant_id, revision_id, part_key, quantity_inferred,
            quantity_effective, included
          ) VALUES ('farm-b', ?, 'cross-tenant', 1, 1, 1)`,
        )
        .run(first.id),
    ).toThrow(/ownership/i);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO plan_revision_parts (
            tenant_id, revision_id, projection_part_id, part_key,
            quantity_inferred, quantity_effective, included
          ) VALUES ('default', ?, ?, 'cross-build', 1, 1, 1)`,
        )
        .run(first.id, second.parts[0]!.projectionPartId),
    ).toThrow(/ownership/i);
    migrated.close();
  });

  it("rejects contradictory tracked and legacy provenance", () => {
    const { database } = createDatabase();
    const raw = rawDatabase(database);
    const profile = repository(database).createProfile("Provenance checks");
    const inputSet = raw
      .prepare(
        `INSERT INTO plan_revision_input_sets (
          tenant_id, profile_id, input_set_digest, expected_input_count,
          format_version, recorded_at, published_at
        ) VALUES ('default', ?, ?, 0, 2, ?, ?)`,
      )
      .run(
        profile.id,
        "d".repeat(64),
        "2026-08-20T15:00:00.000Z",
        "2026-08-20T15:00:00.000Z",
      );
    const insertRevision = raw.prepare(
      `INSERT INTO plan_revisions (
        tenant_id, profile_id, revision_number, parent_revision_id, input_set_id,
        provenance_kind, digest_format, snapshot_digest, created_by, accepted_by,
        created_at, accepted_at
      ) VALUES ('default', ?, 1, NULL, ?, ?, 'plan-revision-parts-v1', ?, 'test', 'test', ?, ?)`,
    );

    expect(() =>
      insertRevision.run(
        profile.id,
        null,
        "tracked",
        "e".repeat(64),
        "2026-08-20T15:00:00.000Z",
        "2026-08-20T15:00:00.000Z",
      ),
    ).toThrow(/check constraint/i);
    expect(() =>
      insertRevision.run(
        profile.id,
        Number(inputSet.lastInsertRowid),
        "legacy",
        "e".repeat(64),
        "2026-08-20T15:00:00.000Z",
        "2026-08-20T15:00:00.000Z",
      ),
    ).toThrow(/check constraint/i);
    database.close();
  });

  it("rejects accepted snapshot mutation while its Build exists", () => {
    const { dir, database } = createDatabase();
    const raw = rawDatabase(database);
    const profile = repository(database).createProfile("Immutable");
    raw.prepare(
      `INSERT INTO parts (
        tenant_id, profile_id, match_key, relative_path, filename, source_layer,
        status, role, quantity_auto, quantity_effective, included, notes
      ) VALUES ('default', ?, 'fixed', '', 'fixed.stl', '', 'base', 'primary', 1, 1, 1, '')`,
    ).run(profile.id);
    downgradeToV18(raw);
    database.close();

    const migrated = new SqliteDatabase(dir);
    migrated.connect();
    const migratedRaw = rawDatabase(migrated);
    const accepted = repository(migrated).getAcceptedPlanRevision(profile.id)!;
    expect(() =>
      migratedRaw
        .prepare("UPDATE plan_revisions SET snapshot_digest = ? WHERE id = ?")
        .run("f".repeat(64), accepted.id),
    ).toThrow(/immutable/i);
    expect(() =>
      migratedRaw
        .prepare("UPDATE plan_revision_parts SET filename = 'changed.stl' WHERE revision_id = ?")
        .run(accepted.id),
    ).toThrow(/immutable/i);
    expect(() =>
      migratedRaw.prepare("DELETE FROM plan_revision_parts WHERE revision_id = ?").run(accepted.id),
    ).toThrow(/immutable/i);
    migrated.close();
  });

  it("marks legacy Part and layer writes as compatibility-dirty", () => {
    const { dir, database } = createDatabase();
    const raw = rawDatabase(database);
    const partProfile = repository(database).createProfile("Mutable Part projection");
    const layerProfile = repository(database).createProfile("Mutable layer projection");
    raw.prepare(
      `INSERT INTO parts (
        tenant_id, profile_id, match_key, relative_path, filename, source_layer,
        status, role, quantity_auto, quantity_effective, included, notes
      ) VALUES ('default', ?, 'mutable', '', 'mutable.stl', '', 'base', 'primary', 1, 1, 1, '')`,
    ).run(partProfile.id);
    downgradeToV18(raw);
    database.close();

    const migrated = new SqliteDatabase(dir);
    migrated.connect();
    const repo = repository(migrated);
    const partRevision = repo.getAcceptedPlanRevision(partProfile.id)!;
    const layerRevision = repo.getAcceptedPlanRevision(layerProfile.id)!;
    repo.patchPart(partRevision.parts[0]!.projectionPartId!, { included: false });
    rawDatabase(migrated)
      .prepare(
        `INSERT INTO profile_layers (tenant_id, profile_id, layer_order, layer_type, project_id)
         VALUES ('default', ?, 0, 'base', NULL)`,
      )
      .run(layerProfile.id);

    expect(repo.getAcceptedPlanRevision(partProfile.id)).toBeNull();
    expect(repo.getAcceptedPlanRevision(layerProfile.id)).toBeNull();
    expect(
      rawDatabase(migrated)
        .prepare(
          `SELECT id, accepted_plan_version
             FROM build_profiles
            WHERE id IN (?, ?)
            ORDER BY id`,
        )
        .all(partProfile.id, layerProfile.id),
    ).toEqual([
      { id: partProfile.id, accepted_plan_version: 1 },
      { id: layerProfile.id, accepted_plan_version: 1 },
    ]);
    expect(
      rawDatabase(migrated)
        .prepare("SELECT count(*) AS count FROM plan_revisions WHERE id IN (?, ?)")
        .get(partRevision.id, layerRevision.id),
    ).toEqual({ count: 2 });
    migrated.close();
  });

  it("invalidates both Builds when a compatibility row changes owner", () => {
    const { dir, database } = createDatabase();
    const raw = rawDatabase(database);
    const partFrom = repository(database).createProfile("Part from");
    const partTo = repository(database).createProfile("Part to");
    const layerFrom = repository(database).createProfile("Layer from");
    const layerTo = repository(database).createProfile("Layer to");
    const part = raw
      .prepare(
        `INSERT INTO parts (
          tenant_id, profile_id, match_key, relative_path, filename, source_layer,
          status, role, quantity_auto, quantity_effective, included, notes
        ) VALUES ('default', ?, 'moving', '', 'moving.stl', '', 'base', 'primary', 1, 1, 1, '')`,
      )
      .run(partFrom.id);
    const layer = raw
      .prepare(
        `INSERT INTO profile_layers (tenant_id, profile_id, layer_order, layer_type, project_id)
         VALUES ('default', ?, 0, 'base', NULL)`,
      )
      .run(layerFrom.id);
    downgradeToV18(raw);
    database.close();

    const migrated = new SqliteDatabase(dir);
    migrated.connect();
    const migratedRaw = rawDatabase(migrated);
    migratedRaw.prepare("UPDATE parts SET profile_id = ? WHERE id = ?").run(
      partTo.id,
      Number(part.lastInsertRowid),
    );
    migratedRaw.prepare("UPDATE profile_layers SET profile_id = ? WHERE id = ?").run(
      layerTo.id,
      Number(layer.lastInsertRowid),
    );

    expect(
      migratedRaw
        .prepare(
          `SELECT id, accepted_plan_revision_id, accepted_plan_version
             FROM build_profiles
            WHERE id IN (?, ?, ?, ?)
            ORDER BY id`,
        )
        .all(partFrom.id, partTo.id, layerFrom.id, layerTo.id),
    ).toEqual(
      [partFrom.id, partTo.id, layerFrom.id, layerTo.id].map((id) => ({
        id,
        accepted_plan_revision_id: null,
        accepted_plan_version: 1,
      })),
    );
    migrated.close();
  });
});

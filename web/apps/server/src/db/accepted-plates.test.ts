import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { acceptedPlanBasis } from "./accepted-plan-progress.js";
import { backfillAcceptedPlanRevisions } from "./accepted-plan-revisions.js";
import { AcceptedPlateIntegrityError } from "./accepted-plates.js";
import { getDb, SqliteDatabase } from "./client.js";
import { backfillCurrentRequiredUnitSets } from "./required-units.js";
import { AppRepository } from "./repository.js";
import * as pgSchema from "./schema-pg.js";
import { registerPostgresSyncQuery, unregisterPostgresSyncQuery } from "./sync-db-bridge.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture(firstToken = 1) {
  const root = mkdtempSync(join(tmpdir(), "pp-accepted-plates-"));
  const database = new SqliteDatabase(root);
  database.connect();
  const repo = new AppRepository(getDb(database), "default", database.reposDir, undefined, {
    clock: () => new Date("2026-08-21T16:00:00.000Z"),
  });
  const raw = (database as unknown as { sqlite: Database.Database }).sqlite;
  const profile = repo.createProfile("Accepted Plate Build");
  const insertPart = raw.prepare(
    `INSERT INTO parts (
      tenant_id, profile_id, match_key, relative_path, filename, source_layer,
      status, role, quantity_auto, quantity_effective, included, notes
    ) VALUES ('default', ?, ?, ?, ?, 'base:test', 'base', 'primary', ?, ?, ?, '')`,
  );
  insertPart.run(profile.id, "bracket.stl", "bracket.stl", "bracket.stl", 2, 2, 1);
  insertPart.run(profile.id, "optional.stl", "optional.stl", "optional.stl", 1, 1, 0);
  backfillAcceptedPlanRevisions(raw, "2026-08-21T15:00:00.000Z");
  let token = firstToken;
  backfillCurrentRequiredUnitSets(raw, {
    now: () => "2026-08-21T15:01:00.000Z",
    tokenFactory: () => `ppu_${(token++).toString(16).padStart(32, "0")}`,
  });
  const accepted = repo.readAcceptedPlanOperationalSnapshot(profile.id);
  if (accepted.kind !== "ready") throw new Error("accepted fixture is unavailable");
  const required = accepted.snapshot.parts
    .filter((part) => part.included)
    .flatMap((part) => part.units);
  const notRequired = accepted.snapshot.parts
    .filter((part) => !part.included)
    .flatMap((part) => part.units);
  cleanups.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { database, root, repo, raw, profile, accepted: accepted.snapshot, required, notRequired };
}

function plateInput(tokens: readonly string[]) {
  return [
    {
      plateId: "plate-main",
      printerId: "printer-core-one",
      printerName: "Core One",
      printerModel: "Prusa Core One",
      bedWidthUm: 250_000,
      bedDepthUm: 220_000,
      bedHeightUm: 220_000,
      marginUm: 5_000,
      units: tokens.map((token, index) => ({
        token,
        xUm: 5_000 + index * 60_000,
        yUm: 5_000,
        widthUm: 50_000,
        depthUm: 40_000,
        heightUm: 30_000,
      })),
    },
  ];
}

function acceptedPlateRows(raw: Database.Database) {
  return {
    heads: raw.prepare("SELECT * FROM accepted_plate_heads ORDER BY profile_id").all(),
    revisions: raw.prepare("SELECT * FROM accepted_plate_revisions ORDER BY id").all(),
    plates: raw.prepare("SELECT * FROM accepted_plates ORDER BY revision_id, plate_id").all(),
    units: raw
      .prepare(
        "SELECT * FROM accepted_plate_units ORDER BY revision_id, plate_id, required_unit_token",
      )
      .all(),
  };
}

describe("accepted Plate repository", () => {
  it("publishes and reads exact micrometre geometry while projecting Object names", () => {
    const { repo, raw, profile, accepted, required } = fixture();
    const result = repo.publishAcceptedPlates({
      profileId: profile.id,
      expected: acceptedPlanBasis(accepted),
      expectedPlateRevisionId: null,
      plates: plateInput(required.map((unit) => unit.token)),
    });

    expect(result).toMatchObject({ kind: "published", plateRevisionNumber: 1 });
    const read = repo.readAcceptedPlates(profile.id);
    expect(read).toMatchObject({
      kind: "ready",
      basis: acceptedPlanBasis(accepted),
      plateRevisionNumber: 1,
      plates: [
        {
          plateId: "plate-main",
          ordinal: 1,
          printerId: "printer-core-one",
          printerName: "Core One",
          printerModel: "Prusa Core One",
          bedWidthUm: 250_000,
          bedDepthUm: 220_000,
          bedHeightUm: 220_000,
          marginUm: 5_000,
          units: [
            {
              token: required[0]!.token,
              objectName: required[0]!.objectName,
              xUm: 5_000,
              yUm: 5_000,
              widthUm: 50_000,
              depthUm: 40_000,
              heightUm: 30_000,
            },
            {
              token: required[1]!.token,
              objectName: required[1]!.objectName,
              xUm: 65_000,
              yUm: 5_000,
              widthUm: 50_000,
              depthUm: 40_000,
              heightUm: 30_000,
            },
          ],
        },
      ],
    });
    const storedUnitColumns = (
      raw.pragma("table_info(accepted_plate_units)") as { name: string }[]
    ).map((column) => column.name);
    expect(storedUnitColumns).not.toContain("object_name");
    expect(storedUnitColumns).not.toContain("rotation");
    expect(
      (raw.pragma("table_info(accepted_plates)") as { name: string; notnull: number }[]).find(
        (column) => column.name === "bed_height_um",
      )?.notnull,
    ).toBe(1);
  });

  it("preserves publication order as an immutable Plate ordinal", () => {
    const { repo, profile, accepted, required } = fixture();
    const plates = plateInput(required.map((unit) => unit.token));
    const first = plates[0]!;
    const published = repo.publishAcceptedPlates({
      profileId: profile.id,
      expected: acceptedPlanBasis(accepted),
      expectedPlateRevisionId: null,
      plates: [
        { ...first, plateId: "z-first" },
        { ...first, plateId: "a-second", units: [] },
      ],
    });
    expect(published).toMatchObject({ kind: "published" });

    const read = repo.readAcceptedPlates(profile.id);
    expect(read.kind).toBe("ready");
    if (read.kind !== "ready") throw new Error("Plate read failed");
    expect(read.plates.map((plate) => [plate.plateId, plate.ordinal])).toEqual([
      ["z-first", 1],
      ["a-second", 2],
    ]);

    if (published.kind !== "published") throw new Error("Plate publish failed");
    expect(
      repo.moveAcceptedPlateUnit({
        profileId: profile.id,
        expected: acceptedPlanBasis(accepted),
        expectedPlateRevisionId: published.plateRevisionId,
        plateId: "z-first",
        token: required[0]!.token,
        xUm: 6_000,
        yUm: 5_000,
      }),
    ).toMatchObject({ kind: "moved" });
    const moved = repo.readAcceptedPlates(profile.id);
    expect(moved.kind).toBe("ready");
    if (moved.kind !== "ready") throw new Error("Plate read failed");
    expect(moved.plates.map((plate) => [plate.plateId, plate.ordinal])).toEqual([
      ["z-first", 1],
      ["a-second", 2],
    ]);
  });

  it("makes exact publication retries idempotent and stale changes compare-and-swap", () => {
    const { repo, raw, profile, accepted, required } = fixture();
    const basis = acceptedPlanBasis(accepted);
    const plates = plateInput(required.map((unit) => unit.token));
    const first = repo.publishAcceptedPlates({
      profileId: profile.id,
      expected: basis,
      expectedPlateRevisionId: null,
      plates,
    });
    if (first.kind !== "published") throw new Error("Plate publish failed");
    const before = acceptedPlateRows(raw);

    expect(
      repo.publishAcceptedPlates({
        profileId: profile.id,
        expected: basis,
        expectedPlateRevisionId: null,
        plates,
      }),
    ).toEqual({ kind: "unchanged", plateRevisionId: first.plateRevisionId });
    expect(acceptedPlateRows(raw)).toEqual(before);

    const changed = structuredClone(plates);
    changed[0]!.units[0]!.xUm += 1;
    expect(
      repo.publishAcceptedPlates({
        profileId: profile.id,
        expected: basis,
        expectedPlateRevisionId: null,
        plates: changed,
      }),
    ).toEqual({ kind: "plate_revision_changed" });
    expect(acceptedPlateRows(raw)).toEqual(before);

    expect(
      repo.publishAcceptedPlates({
        profileId: profile.id,
        expected: basis,
        expectedPlateRevisionId: first.plateRevisionId,
        plates: changed,
      }),
    ).toMatchObject({ kind: "published", plateRevisionNumber: 2 });
  });

  it("requires full positive build volume and PostgreSQL-sized coordinates", () => {
    const { repo, raw, profile, accepted, required } = fixture();
    const basis = acceptedPlanBasis(accepted);
    const tooLarge = plateInput(required.map((unit) => unit.token));
    tooLarge[0]!.bedWidthUm = 2_147_483_648;
    for (const plates of [tooLarge]) {
      const before = acceptedPlateRows(raw);
      expect(
        repo.publishAcceptedPlates({
          profileId: profile.id,
          expected: basis,
          expectedPlateRevisionId: null,
          plates,
        }),
      ).toEqual({ kind: "invalid_geometry", reason: "outside_build_area" });
      expect(acceptedPlateRows(raw)).toEqual(before);
    }
  });

  it("blocks direct immutable history deletion while the Build exists", () => {
    const { repo, raw, profile, accepted, required } = fixture();
    expect(
      repo.publishAcceptedPlates({
        profileId: profile.id,
        expected: acceptedPlanBasis(accepted),
        expectedPlateRevisionId: null,
        plates: plateInput(required.map((unit) => unit.token)),
      }),
    ).toMatchObject({ kind: "published" });

    expect(() =>
      raw.prepare(`INSERT INTO accepted_plates (
        tenant_id, revision_id, plate_id, ordinal, printer_id, printer_name, printer_model,
        bed_width_um, bed_depth_um, bed_height_um, margin_um
      ) SELECT tenant_id, revision_id, 'late-plate', 2, printer_id, printer_name, printer_model,
               bed_width_um, bed_depth_um, bed_height_um, margin_um
          FROM accepted_plates LIMIT 1`).run(),
    ).toThrow(/ownership/i);
    for (const statement of [
      "UPDATE accepted_plate_units SET x_um = x_um + 1",
      "UPDATE accepted_plates SET printer_name = 'Changed'",
      "UPDATE accepted_plate_revisions SET created_at = 'changed'",
    ]) {
      expect(() => raw.prepare(statement).run()).toThrow(/immutable/i);
    }
    for (const table of ["accepted_plate_units", "accepted_plates", "accepted_plate_revisions"]) {
      expect(() => raw.prepare(`DELETE FROM ${table}`).run()).toThrow(/immutable/i);
    }
  });

  it.each([
    {
      label: "removed unit",
      corrupt(raw: Database.Database) {
        raw.exec("DROP TRIGGER trg_accepted_plate_units_immutable_delete");
        raw.prepare("DELETE FROM accepted_plate_units WHERE required_unit_token = (SELECT required_unit_token FROM accepted_plate_units LIMIT 1)").run();
      },
      code: "counts",
    },
    {
      label: "orphan unit",
      corrupt(raw: Database.Database) {
        raw.exec("DROP TRIGGER trg_accepted_plate_units_immutable_update");
        raw.prepare("UPDATE accepted_plate_units SET plate_id = 'missing-plate' WHERE required_unit_token = (SELECT required_unit_token FROM accepted_plate_units LIMIT 1)").run();
      },
      code: "layout",
    },
    {
      label: "extra Plate",
      corrupt(raw: Database.Database) {
        raw.exec("DROP TRIGGER trg_accepted_plates_ownership_insert");
        raw.prepare(`INSERT INTO accepted_plates (
          tenant_id, revision_id, plate_id, ordinal, printer_id, printer_name, printer_model,
          bed_width_um, bed_depth_um, bed_height_um, margin_um
        ) SELECT tenant_id, revision_id, 'extra-plate', 2, printer_id, printer_name, printer_model,
                 bed_width_um, bed_depth_um, bed_height_um, margin_um
            FROM accepted_plates LIMIT 1`).run();
      },
      code: "counts",
    },
    {
      label: "tenant-mismatched unit",
      corrupt(raw: Database.Database) {
        raw.exec("DROP TRIGGER trg_accepted_plate_units_immutable_update");
        raw.prepare("UPDATE accepted_plate_units SET tenant_id = 'other' WHERE required_unit_token = (SELECT required_unit_token FROM accepted_plate_units LIMIT 1)").run();
      },
      code: "layout",
    },
    {
      label: "digest mismatch",
      corrupt(raw: Database.Database) {
        raw.exec("DROP TRIGGER trg_accepted_plate_units_immutable_update");
        raw.prepare("UPDATE accepted_plate_units SET x_um = x_um + 1 WHERE required_unit_token = (SELECT required_unit_token FROM accepted_plate_units LIMIT 1)").run();
      },
      code: "layout_digest",
    },
  ] satisfies readonly {
    label: string;
    corrupt: (raw: Database.Database) => void;
    code: AcceptedPlateIntegrityError["code"];
  }[])("rejects $label corruption with a typed integrity error", ({ corrupt, code }) => {
    const { repo, raw, profile, accepted, required } = fixture();
    expect(
      repo.publishAcceptedPlates({
        profileId: profile.id,
        expected: acceptedPlanBasis(accepted),
        expectedPlateRevisionId: null,
        plates: plateInput(required.map((unit) => unit.token)),
      }),
    ).toMatchObject({ kind: "published" });
    corrupt(raw);

    expect(() => repo.readAcceptedPlates(profile.id)).toThrowError(
      expect.objectContaining<Partial<AcceptedPlateIntegrityError>>({ code }),
    );
  });

  it("rolls back a publication failure after inserting its revision", () => {
    const { repo, raw, profile, accepted, required } = fixture();
    const before = acceptedPlateRows(raw);
    raw.exec(`CREATE TRIGGER fail_accepted_plate_insert
      BEFORE INSERT ON accepted_plates
      BEGIN
        SELECT RAISE(ABORT, 'injected accepted Plate insert failure');
      END`);

    expect(() =>
      repo.publishAcceptedPlates({
        profileId: profile.id,
        expected: acceptedPlanBasis(accepted),
        expectedPlateRevisionId: null,
        plates: plateInput(required.map((unit) => unit.token)),
      }),
    ).toThrow(/injected accepted Plate insert failure/i);
    expect(acceptedPlateRows(raw)).toEqual(before);
  });

  it("serializes two publishers and rejects the stale layout without writes", () => {
    const { root, repo, raw, profile, accepted, required } = fixture();
    const secondDatabase = new SqliteDatabase(root);
    secondDatabase.connect();
    cleanups.push(() => secondDatabase.close());
    const secondRepo = new AppRepository(getDb(secondDatabase), "default", secondDatabase.reposDir);
    const basis = acceptedPlanBasis(accepted);
    const first = repo.publishAcceptedPlates({
      profileId: profile.id,
      expected: basis,
      expectedPlateRevisionId: null,
      plates: plateInput(required.map((unit) => unit.token)),
    });
    if (first.kind !== "published") throw new Error("Plate publish failed");
    const before = acceptedPlateRows(raw);
    const changed = plateInput(required.map((unit) => unit.token));
    changed[0]!.units[0]!.xUm += 1;

    expect(
      secondRepo.publishAcceptedPlates({
        profileId: profile.id,
        expected: basis,
        expectedPlateRevisionId: null,
        plates: changed,
      }),
    ).toEqual({ kind: "plate_revision_changed" });
    expect(acceptedPlateRows(raw)).toEqual(before);
  });

  it("makes another tenant's Plate state indistinguishable from missing state", () => {
    const { database, repo, raw, profile, accepted, required } = fixture();
    const basis = acceptedPlanBasis(accepted);
    const published = repo.publishAcceptedPlates({
      profileId: profile.id,
      expected: basis,
      expectedPlateRevisionId: null,
      plates: plateInput(required.map((unit) => unit.token)),
    });
    if (published.kind !== "published") throw new Error("Plate publish failed");
    const otherRepo = new AppRepository(getDb(database), "other", database.reposDir);
    const before = acceptedPlateRows(raw);

    expect(otherRepo.readAcceptedPlates(profile.id)).toEqual(otherRepo.readAcceptedPlates(999_999));
    expect(
      otherRepo.publishAcceptedPlates({
        profileId: profile.id,
        expected: basis,
        expectedPlateRevisionId: published.plateRevisionId,
        plates: plateInput(required.map((unit) => unit.token)),
      }),
    ).toEqual({ kind: "stale_accepted_plan" });
    expect(
      otherRepo.moveAcceptedPlateUnit({
        profileId: profile.id,
        expected: basis,
        expectedPlateRevisionId: published.plateRevisionId,
        plateId: "plate-main",
        token: required[0]!.token,
        xUm: 6_000,
        yUm: 5_000,
      }),
    ).toEqual({ kind: "stale_accepted_plan" });
    expect(acceptedPlateRows(raw)).toEqual(before);
  });

  it.each([
    ["missing", (tokens: string[]) => plateInput(tokens.slice(0, 1))],
    ["duplicate", (tokens: string[]) => plateInput([tokens[0]!, tokens[0]!])],
    ["invented", (tokens: string[]) => plateInput([tokens[0]!, "ppu_ffffffffffffffffffffffffffffffff"])],
  ])("rejects %s token coverage without writing", (_label, arrange) => {
    const { repo, raw, profile, accepted, required } = fixture();
    const before = acceptedPlateRows(raw);
    expect(
      repo.publishAcceptedPlates({
        profileId: profile.id,
        expected: acceptedPlanBasis(accepted),
        expectedPlateRevisionId: null,
        plates: arrange(required.map((unit) => unit.token)),
      }),
    ).toEqual({ kind: "invalid_units" });
    expect(acceptedPlateRows(raw)).toEqual(before);
  });

  it("rejects a not-required token and a token from another Build without writing", () => {
    const first = fixture();
    const foreign = fixture(100);
    const cases = [first.notRequired[0]!.token, foreign.required[0]!.token];
    for (const token of cases) {
      const before = acceptedPlateRows(first.raw);
      expect(
        first.repo.publishAcceptedPlates({
          profileId: first.profile.id,
          expected: acceptedPlanBasis(first.accepted),
          expectedPlateRevisionId: null,
          plates: plateInput([first.required[0]!.token, token]),
        }),
      ).toEqual({ kind: "invalid_units" });
      expect(acceptedPlateRows(first.raw)).toEqual(before);
    }
  });

  it("rejects a stale accepted basis without writing", () => {
    const { repo, raw, profile, accepted, required } = fixture();
    const before = acceptedPlateRows(raw);
    const stale = { ...acceptedPlanBasis(accepted), revisionDigest: "f".repeat(64) };
    expect(
      repo.publishAcceptedPlates({
        profileId: profile.id,
        expected: stale,
        expectedPlateRevisionId: null,
        plates: plateInput(required.map((unit) => unit.token)),
      }),
    ).toEqual({ kind: "stale_accepted_plan" });
    expect(acceptedPlateRows(raw)).toEqual(before);
  });

  it("moves one token by copying the full immutable Plate revision", () => {
    const { repo, raw, profile, accepted, required } = fixture();
    const published = repo.publishAcceptedPlates({
      profileId: profile.id,
      expected: acceptedPlanBasis(accepted),
      expectedPlateRevisionId: null,
      plates: plateInput(required.map((unit) => unit.token)),
    });
    if (published.kind !== "published") throw new Error("Plate publish failed");

    const moved = repo.moveAcceptedPlateUnit({
      profileId: profile.id,
      expected: acceptedPlanBasis(accepted),
      expectedPlateRevisionId: published.plateRevisionId,
      plateId: "plate-main",
      token: required[1]!.token,
      xUm: 70_000,
      yUm: 10_000,
    });
    expect(moved).toMatchObject({ kind: "moved", plateRevisionNumber: 2 });
    const read = repo.readAcceptedPlates(profile.id);
    expect(read.kind).toBe("ready");
    if (read.kind !== "ready") throw new Error("Plate read failed");
    expect(read.plates[0]!.units).toMatchObject([
      { token: required[0]!.token, xUm: 5_000, yUm: 5_000, heightUm: 30_000 },
      { token: required[1]!.token, xUm: 70_000, yUm: 10_000, heightUm: 30_000 },
    ]);
    expect(
      raw.prepare("SELECT count(*) AS count FROM accepted_plate_revisions").get(),
    ).toEqual({ count: 2 });
    expect(
      raw.prepare("SELECT count(*) AS count FROM accepted_plate_units").get(),
    ).toEqual({ count: 4 });
  });

  it("returns unchanged for an exact repeated move and rejects a stale Plate revision", () => {
    const { repo, raw, profile, accepted, required } = fixture();
    const published = repo.publishAcceptedPlates({
      profileId: profile.id,
      expected: acceptedPlanBasis(accepted),
      expectedPlateRevisionId: null,
      plates: plateInput(required.map((unit) => unit.token)),
    });
    if (published.kind !== "published") throw new Error("Plate publish failed");
    const before = acceptedPlateRows(raw);

    expect(
      repo.moveAcceptedPlateUnit({
        profileId: profile.id,
        expected: acceptedPlanBasis(accepted),
        expectedPlateRevisionId: published.plateRevisionId,
        plateId: "plate-main",
        token: required[0]!.token,
        xUm: 5_000,
        yUm: 5_000,
      }),
    ).toEqual({ kind: "unchanged", plateRevisionId: published.plateRevisionId });
    expect(acceptedPlateRows(raw)).toEqual(before);

    expect(
      repo.moveAcceptedPlateUnit({
        profileId: profile.id,
        expected: acceptedPlanBasis(accepted),
        expectedPlateRevisionId: published.plateRevisionId + 1,
        plateId: "plate-main",
        token: required[0]!.token,
        xUm: 6_000,
        yUm: 5_000,
      }),
    ).toEqual({ kind: "plate_revision_changed" });
    expect(acceptedPlateRows(raw)).toEqual(before);
  });

  it("enforces exact bounds and rejects one micrometre outside or an overlap", () => {
    const { repo, raw, profile, accepted, required } = fixture();
    const basis = acceptedPlanBasis(accepted);
    const exact = plateInput(required.map((unit) => unit.token));
    exact[0]!.units[1]!.xUm = 195_000;
    expect(repo.publishAcceptedPlates({ profileId: profile.id, expected: basis, expectedPlateRevisionId: null, plates: exact }))
      .toMatchObject({ kind: "published" });
    const count = acceptedPlateRows(raw).revisions.length;

    const outside = plateInput(required.map((unit) => unit.token));
    outside[0]!.units[1]!.xUm = 195_001;
    expect(
      repo.publishAcceptedPlates({ profileId: profile.id, expected: basis, expectedPlateRevisionId: null, plates: outside }),
    ).toEqual({ kind: "invalid_geometry", reason: "outside_build_area" });

    const overlap = plateInput(required.map((unit) => unit.token));
    overlap[0]!.units[1]!.xUm = 54_999;
    expect(
      repo.publishAcceptedPlates({ profileId: profile.id, expected: basis, expectedPlateRevisionId: null, plates: overlap }),
    ).toEqual({ kind: "invalid_geometry", reason: "overlap" });
    expect(acceptedPlateRows(raw).revisions).toHaveLength(count);
  });

  it("accepts the exact captured height and rejects one micrometre above it without writing", () => {
    const { repo, raw, profile, accepted, required } = fixture();
    const basis = acceptedPlanBasis(accepted);
    const exact = plateInput(required.map((unit) => unit.token));
    exact[0]!.bedHeightUm = 30_000;
    expect(repo.publishAcceptedPlates({ profileId: profile.id, expected: basis, expectedPlateRevisionId: null, plates: exact }))
      .toMatchObject({ kind: "published" });
    const before = acceptedPlateRows(raw);

    const tooTall = plateInput(required.map((unit) => unit.token));
    tooTall[0]!.bedHeightUm = 29_999;
    expect(
      repo.publishAcceptedPlates({ profileId: profile.id, expected: basis, expectedPlateRevisionId: null, plates: tooTall }),
    ).toEqual({ kind: "invalid_geometry", reason: "outside_build_area" });
    expect(acceptedPlateRows(raw)).toEqual(before);
  });

  it("returns transaction_unavailable for PostgreSQL reads and mutations without querying", () => {
    const postgres = drizzle({} as Pool, { schema: pgSchema });
    let queries = 0;
    registerPostgresSyncQuery(postgres, () => {
      queries += 1;
      throw new Error("PostgreSQL mutation queried");
    });
    const repo = new AppRepository(postgres, "default", "/tmp/unused-accepted-plates");
    const expected = {
      profileId: 1,
      planVersion: 1,
      revisionId: 1,
      revisionDigest: "a".repeat(64),
      requiredUnitMappingDigest: "b".repeat(64),
    };
    try {
      expect(repo.readAcceptedPlates(1)).toEqual({ kind: "transaction_unavailable" });
      expect(repo.publishAcceptedPlates({ profileId: 1, expected, expectedPlateRevisionId: null, plates: [] })).toEqual({
        kind: "transaction_unavailable",
      });
      expect(
        repo.moveAcceptedPlateUnit({
          profileId: 1,
          expected,
          expectedPlateRevisionId: 1,
          plateId: "plate-main",
          token: "ppu_00000000000000000000000000000001",
          xUm: 0,
          yUm: 0,
        }),
      ).toEqual({ kind: "transaction_unavailable" });
      expect(queries).toBe(0);
    } finally {
      unregisterPostgresSyncQuery(postgres);
    }
  });

  it("cascades the current head and all immutable Plate history when the Build is deleted", () => {
    const { repo, raw, profile, accepted, required } = fixture();
    expect(
      repo.publishAcceptedPlates({
        profileId: profile.id,
        expected: acceptedPlanBasis(accepted),
        expectedPlateRevisionId: null,
        plates: plateInput(required.map((unit) => unit.token)),
      }),
    ).toMatchObject({ kind: "published" });

    expect(() => repo.deleteProfile(profile.id)).not.toThrow();
    for (const table of [
      "accepted_plate_heads",
      "accepted_plate_revisions",
      "accepted_plates",
      "accepted_plate_units",
    ]) {
      expect(raw.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
    }
  });
});

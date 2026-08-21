import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createSelfHostPorts } from "../adapters/self-host/index.js";
import { loadConfig } from "../config.js";
import { backfillAcceptedPlanRevisions } from "../db/accepted-plan-revisions.js";
import { backfillCurrentRequiredUnitSets } from "../db/required-units.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("accepted Plan read routes", () => {
  it("serves Checkoff and assembled state through one accepted read per request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pp-accepted-read-routes-"));
    directories.push(directory);
    const ports = createSelfHostPorts(directory);
    await ports.db.connect();
    const repo = ports.repository;
    const source = repo.createSource({
      name: "Repo",
      url: "https://github.com/a/b",
    });
    const sourceRoot = join(directory, "repos", String(source.id));
    mkdirSync(join(sourceRoot, "parts"), { recursive: true });
    writeFileSync(join(sourceRoot, "parts", "widget.stl"), "solid widget");
    repo.updateSource(source.id, { local_path: sourceRoot });
    repo.updateImportRules(source.id, ["parts/"]);
    const profile = repo.createProfile("Accepted route Plan", source.id);
    repo.recomputeProfile(profile.id);
    const part = repo.listParts(profile.id).parts[0];
    if (!part) throw new Error("test Part is missing");

    const raw = new Database(join(directory, "print-partner.db"));
    raw.pragma("foreign_keys = ON");
    backfillAcceptedPlanRevisions(raw, "2026-08-21T06:00:00.000Z");
    backfillCurrentRequiredUnitSets(raw, {
      now: () => "2026-08-21T06:01:00.000Z",
      tokenFactory: () => "ppu_00000000000000000000000000000001",
    });
    raw.close();

    repo.patchPartProgress(part.id, 0, true);
    repo.patchPartAssembled(part.id, 0, true);

    const progressBeforeRead = new Database(
      join(directory, "print-partner.db"),
      {
        readonly: true,
      },
    );
    const progressBeforeRequests = progressBeforeRead
      .prepare("SELECT * FROM print_progress ORDER BY id")
      .all();
    progressBeforeRead.close();

    const readAccepted = repo.readAcceptedPlanOperationalSnapshot.bind(repo);
    let acceptedReadCount = 0;
    repo.readAcceptedPlanOperationalSnapshot = (profileId) => {
      acceptedReadCount += 1;
      return readAccepted(profileId);
    };

    const app = await buildApp(loadConfig(), ports);
    try {
      const checkoff = await app.inject({
        method: "GET",
        url: `/plans/${profile.id}/checkoff`,
      });
      expect(checkoff.statusCode).toBe(200);
      expect(checkoff.json()).toEqual({
        profile_id: profile.id,
        summary: "1/1 parts fully printed · 1/1 units",
        parts: [
          {
            id: part.id,
            filename: "widget.stl",
            match_key: part.match_key,
            relative_path: part.relative_path,
            source_layer: part.source_layer,
            role: part.role,
            quantity_effective: part.quantity_effective,
            printed_count: 1,
            print_units: [true],
            missing: false,
            filament_display: "",
            filament_hex: null,
          },
        ],
      });
      expect(acceptedReadCount).toBe(1);

      const assembled = await app.inject({
        method: "GET",
        url: `/parts/${part.id}/assembled`,
      });
      expect(assembled.statusCode).toBe(200);
      expect(assembled.json()).toEqual({
        part_id: part.id,
        assembled_count: 1,
        assembled_units: [true],
      });
      expect(acceptedReadCount).toBe(2);

      const emptyProfile = repo.createProfile("Empty accepted route Plan");
      const empty = await app.inject({
        method: "GET",
        url: `/plans/${emptyProfile.id}/checkoff`,
      });
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toEqual({
        profile_id: emptyProfile.id,
        summary: "0/0 parts fully printed · 0/0 units",
        parts: [],
      });
      expect(acceptedReadCount).toBe(3);

      const dirtyProfile = repo.createProfile(
        "Dirty accepted route Plan",
        source.id,
      );
      repo.recomputeProfile(dirtyProfile.id);
      const dirtyPart = repo.listParts(dirtyProfile.id).parts[0];
      if (!dirtyPart) throw new Error("dirty test Part is missing");
      const dirtyCheckoff = await app.inject({
        method: "GET",
        url: `/plans/${dirtyProfile.id}/checkoff`,
      });
      expect(dirtyCheckoff.statusCode).toBe(409);
      expect(dirtyCheckoff.json()).toEqual({
        detail: "Accepted Plan requires compatibility repair",
      });
      const dirtyAssembled = await app.inject({
        method: "GET",
        url: `/parts/${dirtyPart.id}/assembled`,
      });
      expect(dirtyAssembled.statusCode).toBe(409);
      expect(dirtyAssembled.json()).toEqual({
        detail: "Accepted Plan requires compatibility repair",
      });
      expect(acceptedReadCount).toBe(5);

      const missingProfile = await app.inject({
        method: "GET",
        url: "/plans/999999/checkoff",
      });
      expect(missingProfile.statusCode).toBe(404);
      expect(missingProfile.json()).toEqual({ detail: "Profile not found" });
      const missingPart = await app.inject({
        method: "GET",
        url: "/parts/999999/assembled",
      });
      expect(missingPart.statusCode).toBe(404);
      expect(missingPart.json()).toEqual({ detail: "Part not found" });
      expect(acceptedReadCount).toBe(5);

      const repairRaw = new Database(join(directory, "print-partner.db"));
      repairRaw.pragma("foreign_keys = ON");
      backfillAcceptedPlanRevisions(repairRaw, "2026-08-21T06:02:00.000Z");
      repairRaw.close();
      const uninitialized = await app.inject({
        method: "GET",
        url: `/plans/${dirtyProfile.id}/checkoff`,
      });
      expect(uninitialized.statusCode).toBe(409);
      expect(uninitialized.json()).toEqual({
        detail: "Accepted Plan operational state is not initialized",
      });
      expect(acceptedReadCount).toBe(6);

      const corruptRaw = new Database(join(directory, "print-partner.db"));
      corruptRaw.pragma("foreign_keys = ON");
      corruptRaw.exec("DROP TRIGGER trg_plan_revisions_immutable_update");
      corruptRaw
        .prepare(
          `UPDATE plan_revisions
            SET snapshot_digest = ?
          WHERE id = (SELECT accepted_plan_revision_id FROM build_profiles WHERE id = ?)`,
        )
        .run("f".repeat(64), profile.id);
      corruptRaw.close();
      const corrupt = await app.inject({
        method: "GET",
        url: `/plans/${profile.id}/checkoff`,
      });
      expect(corrupt.statusCode).toBe(500);
      expect(corrupt.json()).toEqual({
        detail: "Accepted Plan data is inconsistent",
      });
      expect(acceptedReadCount).toBe(7);

      repo.readAcceptedPlanOperationalSnapshot = () => {
        acceptedReadCount += 1;
        throw new Error("private failure detail");
      };
      const unexpected = await app.inject({
        method: "GET",
        url: `/plans/${emptyProfile.id}/checkoff`,
      });
      expect(unexpected.statusCode).toBe(500);
      expect(unexpected.json()).toEqual({ detail: "Internal Server Error" });
      expect(acceptedReadCount).toBe(8);

      const getProfile = repo.getProfile.bind(repo);
      repo.getProfile = () => {
        throw new Error("private profile lookup failure");
      };
      const profileLookupFailure = await app.inject({
        method: "GET",
        url: `/plans/${emptyProfile.id}/checkoff`,
      });
      expect(profileLookupFailure.statusCode).toBe(500);
      expect(profileLookupFailure.json()).toEqual({
        detail: "Internal Server Error",
      });
      repo.getProfile = getProfile;

      repo.getPartRow = () => {
        throw new Error("private Part lookup failure");
      };
      const partLookupFailure = await app.inject({
        method: "GET",
        url: `/parts/${part.id}/assembled`,
      });
      expect(partLookupFailure.statusCode).toBe(500);
      expect(partLookupFailure.json()).toEqual({
        detail: "Internal Server Error",
      });

      const progressAfterFailures = new Database(
        join(directory, "print-partner.db"),
        {
          readonly: true,
        },
      );
      expect(
        progressAfterFailures
          .prepare("SELECT * FROM print_progress ORDER BY id")
          .all(),
      ).toEqual(progressBeforeRequests);
      progressAfterFailures.close();
    } finally {
      await app.close();
    }
  });
});

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import { getDb, SqliteDatabase } from "./db/client.js";
import { AppRepository } from "./db/repository.js";
import { tenantStorage } from "./middleware/tenant-context.js";

describe("Phase 6 tenant isolation", () => {
  it("scopes sources and profiles per tenant", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-tenant-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const db = getDb(sqlite);

    let sourceA!: ReturnType<AppRepository["createSource"]>;
    let planA!: ReturnType<AppRepository["createProfile"]>;
    let sourceB!: ReturnType<AppRepository["createSource"]>;

    tenantStorage.run("tenant-a", () => {
      const repoA = new AppRepository(db, "tenant-a", sqlite.reposDir);
      sourceA = repoA.createSource({ name: "RepoA", url: "https://github.com/a/a" });
      planA = repoA.createProfile("PlanA", sourceA.id);
      expect(repoA.listSources()).toHaveLength(1);
    });

    tenantStorage.run("tenant-b", () => {
      const repoB = new AppRepository(db, "tenant-b", sqlite.reposDir);
      sourceB = repoB.createSource({ name: "RepoB", url: "https://github.com/b/b" });
      expect(repoB.listSources()).toHaveLength(1);
      expect(repoB.getSource(sourceA.id)).toBeNull();
      expect(repoB.getProfile(planA.id)).toBeNull();
    });

    tenantStorage.run("tenant-a", () => {
      const repoA = new AppRepository(db, "tenant-a", sqlite.reposDir);
      expect(repoA.getSource(sourceB.id)).toBeNull();
    });

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects cross-tenant profile recompute and export reads", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-profile-guard-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const db = getDb(sqlite);
    const repoPath = join(dir, "tenant-a-source");
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "part.stl"), "solid part\nendsolid part\n");

    let profileId = 0;
    tenantStorage.run("tenant-a", () => {
      const repo = new AppRepository(db, "default", sqlite.reposDir);
      const source = repo.createSource({
        name: "Tenant A source",
        source_kind: "local",
        local_path: repoPath,
      });
      repo.updateSource(source.id, { local_path: repoPath });
      repo.updateImportRules(source.id, ["parts/"]);
      profileId = repo.createProfile("Tenant A plan", source.id).id;
      expect(repo.recomputeProfile(profileId).merged).toBe(true);
    });

    tenantStorage.run("tenant-b", () => {
      const repo = new AppRepository(db, "default", sqlite.reposDir);
      expect(repo.getProfile(profileId)).toBeNull();
      expect(() => repo.listParts(profileId)).toThrow("Profile not found");
      expect(() => repo.recomputeProfile(profileId)).toThrow("Profile not found");
      expect(() => repo.buildMergePartsForProfile(profileId)).toThrow("Profile not found");
      expect(() => repo.buildKitBundle(profileId, false)).toThrow("Profile not found");
      expect(() =>
        repo.createPlanDecision({
          planId: profileId,
          actor: "user",
          kind: "applied_action",
          label: "Cross-tenant decision",
          summary: "must be rejected",
        }),
      ).toThrow("Profile not found");
    });

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rolls back every SQLite recompute mutation when a later write fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-recompute-rollback-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), "default", sqlite.reposDir);
    const repoPath = join(dir, "source");
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    const originalPath = join(repoPath, "parts", "original.stl");
    writeFileSync(originalPath, "solid original\nendsolid original\n");
    const source = repo.createSource({
      name: "Atomic source",
      source_kind: "local",
      local_path: repoPath,
    });
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);
    const profile = repo.createProfile("Atomic plan", source.id);
    expect(repo.recomputeProfile(profile.id).merged).toBe(true);
    const before = repo.listParts(profile.id).parts;

    unlinkSync(originalPath);
    writeFileSync(
      join(repoPath, "parts", "replacement.stl"),
      "solid replacement\nendsolid replacement\n",
    );
    const native = (sqlite as unknown as { sqlite: Database.Database }).sqlite;
    native.exec(`
      CREATE TRIGGER fail_recompute_insert
      BEFORE INSERT ON parts
      WHEN NEW.filename = 'replacement.stl'
      BEGIN
        SELECT RAISE(ABORT, 'injected recompute failure');
      END
    `);

    expect(() => repo.recomputeProfile(profile.id)).toThrow("injected recompute failure");
    expect(repo.listParts(profile.id).parts).toEqual(before);

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase, getDb } from "./client.js";
import { AppRepository } from "./repository.js";

function assembledForPart(repo: AppRepository, profileId: number, partId: number) {
  const part = repo
    .getEnrichedPartsForReview(profileId, true)
    .find((candidate) => candidate.id === partId);
  if (!part) throw new Error("test Part is missing");
  return {
    assembled_count: part.assembled_units.filter(Boolean).length,
    assembled_units: part.assembled_units,
  };
}

/**
 * Migration coverage for print_progress.assembled (assembly tracking).
 *
 * These exercise the REAL SqliteDatabase.runMigrations() against a database that
 * predates the column, rather than a copy of the migration SQL — so the test
 * fails if the production migration is ever changed or dropped.
 */
describe("print_progress.assembled migration", () => {
  it("adds the column to a pre-existing DB, defaulting every existing row to false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-mig-"));
    try {
      // 1. Build a real, populated DB via the normal path: a plan with parts and
      //    print_progress rows, one of them checked off.
      const first = new SqliteDatabase(dir);
      first.connect();
      const repo = new AppRepository(getDb(first), undefined, first.reposDir);
      const source = repo.createSource({ name: "R", url: "https://github.com/a/b", source_kind: "github" });
      const repoPath = join(dir, "repos", String(source.id));
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(join(repoPath, "x"), { recursive: true });
      writeFileSync(join(repoPath, "x", "part.stl"), "x");
      repo.updateSource(source.id, { local_path: repoPath });
      repo.updateImportRules(source.id, ["x/"]);
      const plan = repo.createProfile("Plan", source.id);
      await repo.recomputeProfile(plan.id);
      const partId = repo.getCheckoff(plan.id).parts[0].id;
      repo.patchPartProgress(partId, 0, true);
      repo.patchPartAssembled(partId, 0, true);
      first.close();

      // 2. Rewind to the pre-assembled schema, so the next connect() sees exactly
      //    what an upgrading user's existing database looks like.
      const raw = new Database(join(dir, "print-partner.db"));
      raw.exec("ALTER TABLE print_progress DROP COLUMN assembled");
      const cols = raw.pragma("table_info(print_progress)") as { name: string }[];
      expect(cols.some((c) => c.name === "assembled")).toBe(false);
      const preCount = raw.prepare("SELECT COUNT(*) AS n FROM print_progress").get() as { n: number };
      expect(preCount.n).toBeGreaterThan(0);
      raw.close();

      // 3. Re-open through the production migration path.
      const upgraded = new SqliteDatabase(dir);
      upgraded.connect();
      const db = new Database(join(dir, "print-partner.db"), { readonly: true });
      const after = db.pragma("table_info(print_progress)") as { name: string }[];
      expect(after.some((c) => c.name === "assembled")).toBe(true);

      // Existing data survives, and every pre-existing row defaults to assembled=false.
      const legacy = db
        .prepare("SELECT unit_index, completed, assembled FROM print_progress ORDER BY id")
        .all() as Array<{ unit_index: number; completed: number; assembled: number }>;
      expect(legacy).toHaveLength(preCount.n);
      // The checked-off unit is still checked off — the migration didn't clobber data.
      expect(legacy.some((r) => r.completed === 1)).toBe(true);
      expect(legacy.every((r) => r.assembled === 0)).toBe(true);
      db.close();
      upgraded.close();

      // 4. Idempotent: a further restart re-runs migrations without throwing.
      const again = new SqliteDatabase(dir);
      expect(() => again.connect()).not.toThrow();
      const check = new Database(join(dir, "print-partner.db"), { readonly: true });
      const stillThere = check.prepare("SELECT COUNT(*) AS n FROM print_progress").get() as { n: number };
      expect(stillThere.n).toBe(preCount.n);
      check.close();
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults new rows to assembled=false and round-trips the accessors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-mig-rw-"));
    const sqlite = new SqliteDatabase(dir);
    try {
      sqlite.connect();
      const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
      const source = repo.createSource({ name: "R", url: "https://github.com/a/b", source_kind: "github" });
      const repoPath = join(dir, "repos", String(source.id));
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(join(repoPath, "x"), { recursive: true });
      writeFileSync(join(repoPath, "x", "part.stl"), "x");
      repo.updateSource(source.id, { local_path: repoPath });
      repo.updateImportRules(source.id, ["x/"]);
      const plan = repo.createProfile("Plan", source.id);
      await repo.recomputeProfile(plan.id);

      const partId = repo.getCheckoff(plan.id).parts[0].id;

      // New rows default to false via the read accessor.
      expect(assembledForPart(repo, plan.id, partId)).toMatchObject({
        assembled_count: 0,
        assembled_units: [false],
      });

      // Write accessor is gated on the unit being printed first.
      repo.patchPartAssembled(partId, 0, true);
      expect(assembledForPart(repo, plan.id, partId).assembled_units).toEqual([false]);

      repo.patchPartProgress(partId, 0, true);
      repo.patchPartAssembled(partId, 0, true);
      expect(assembledForPart(repo, plan.id, partId)).toMatchObject({
        assembled_count: 1,
        assembled_units: [true],
      });

      // The flag persists across a reconnect (it is really on disk, not in memory).
      sqlite.close();
      const reopened = new SqliteDatabase(dir);
      reopened.connect();
      const repo2 = new AppRepository(getDb(reopened), undefined, reopened.reposDir);
      expect(assembledForPart(repo2, plan.id, partId).assembled_units).toEqual([true]);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an out-of-range unit index on the write accessor", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-mig-rng-"));
    const sqlite = new SqliteDatabase(dir);
    try {
      sqlite.connect();
      const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
      expect(() => repo.patchPartAssembled(999999, 0, true)).toThrow(/not found/i);
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase, type DrizzleDb } from "./client.js";
import { AppRepository } from "./repository.js";
import * as schema from "./schema.js";

function withRepo(fn: (repo: AppRepository, db: DrizzleDb) => void) {
  const dir = mkdtempSync(join(tmpdir(), "pp-db-"));
  const sqlite = new SqliteDatabase(dir);
  sqlite.connect();
  try {
    fn(new AppRepository(getDb(sqlite), undefined, sqlite.reposDir), getDb(sqlite));
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertIncludedPart(db: DrizzleDb, profileId: number, filename = "bracket.stl") {
  return db
    .insert(schema.parts)
    .values({
      tenantId: "default",
      profileId,
      matchKey: filename,
      relativePath: filename,
      filename,
      quantityEffective: 1,
      included: true,
    })
    .returning()
    .get()!;
}

describe("AppRepository", () => {
  it("creates and lists sources and plans", () => {
    withRepo((repo) => {
      expect(repo.listSources()).toEqual([]);
      const source = repo.createSource({
        name: "Test Repo",
        url: "https://github.com/example/test",
        source_kind: "github",
      });
      expect(source.name).toBe("Test Repo");

      const plan = repo.createProfile("My Plan");
      expect(plan.name).toBe("My Plan");
      expect(plan.archived_at).toBeNull();
      expect(plan.last_used_at).toBeTruthy();
      expect(repo.listProfiles()).toHaveLength(1);
    });
  });

  it("rejects archive when remaining units are not zero", () => {
    withRepo((repo, db) => {
      const plan = repo.createProfile("In progress");
      const part = insertIncludedPart(db, plan.id);
      expect(() => repo.archiveProfile(plan.id)).toThrow(/remaining/i);
      repo.patchPartProgress(part.id, 0, true);
      const archived = repo.archiveProfile(plan.id);
      expect(archived.archived_at).toBeTruthy();
      expect(repo.listProfiles().find((p) => p.id === plan.id)?.archived_at).toBeTruthy();
      expect(() => repo.unarchiveProfile(plan.id)).toThrow(/unarchive/i);
    });
  });

  it("touches last_used_at and duplicates as a fresh non-archived spine plan", () => {
    withRepo((repo, db) => {
      const plan = repo.createProfile("Template");
      const part = insertIncludedPart(db, plan.id);
      repo.patchPartProgress(part.id, 0, true);
      repo.archiveProfile(plan.id);
      const touched = repo.touchProfileLastUsed(plan.id);
      expect(touched.last_used_at).toBeTruthy();

      const copy = repo.duplicateProfile(plan.id, "Next customer", { clearCheckoff: true });
      expect(copy.archived_at).toBeNull();
      expect(copy.last_used_at).toBeTruthy();
      expect(copy.name).toBe("Next customer");
    });
  });

  it("persists special_request on the plan and copies it on duplicate", () => {
    withRepo((repo) => {
      const plan = repo.createProfile("Desk job");
      expect(plan.special_request).toBeNull();

      const updated = repo.updateProfileSpecialRequest(
        plan.id,
        "contact customer before printing",
      );
      expect(updated.special_request).toBe("contact customer before printing");
      expect(repo.getProfile(plan.id)?.special_request).toBe(
        "contact customer before printing",
      );

      const cleared = repo.updateProfileSpecialRequest(plan.id, "  ");
      expect(cleared.special_request).toBeNull();

      repo.updateProfileSpecialRequest(plan.id, "bag separately");
      const copy = repo.duplicateProfile(plan.id, "Desk job copy");
      expect(copy.special_request).toBe("bag separately");
    });
  });
});

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "./client.js";
import { AppRepository } from "./repository.js";

function withRepo(fn: (repo: AppRepository) => void) {
  const dir = mkdtempSync(join(tmpdir(), "pp-db-"));
  const sqlite = new SqliteDatabase(dir);
  sqlite.connect();
  try {
    fn(new AppRepository(getDb(sqlite), undefined, sqlite.reposDir));
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
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
      expect(plan.last_used_at).toBeNull();
      expect(repo.listProfiles()).toHaveLength(1);
    });
  });

  it("archives a plan and keeps it listed without unarchive", () => {
    withRepo((repo) => {
      const plan = repo.createProfile("Done kit");
      const archived = repo.archiveProfile(plan.id);
      expect(archived.archived_at).toBeTruthy();
      expect(repo.listProfiles().find((p) => p.id === plan.id)?.archived_at).toBeTruthy();
      expect(() => repo.unarchiveProfile(plan.id)).toThrow(/unarchive/i);
    });
  });

  it("touches last_used_at and duplicates as a fresh non-archived spine plan", () => {
    withRepo((repo) => {
      const plan = repo.createProfile("Template");
      repo.archiveProfile(plan.id);
      const touched = repo.touchProfileLastUsed(plan.id);
      expect(touched.last_used_at).toBeTruthy();

      const copy = repo.duplicateProfile(plan.id, "Next customer", { clearCheckoff: true });
      expect(copy.archived_at).toBeNull();
      expect(copy.last_used_at).toBeTruthy();
      expect(copy.name).toBe("Next customer");
    });
  });
});

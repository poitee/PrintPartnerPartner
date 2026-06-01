import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "./client.js";
import { AppRepository } from "./repository.js";

describe("AppRepository", () => {
  it("creates and lists sources and plans", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-db-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

    expect(repo.listSources()).toEqual([]);
    const source = repo.createSource({
      name: "Test Repo",
      url: "https://github.com/example/test",
      source_kind: "github",
    });
    expect(source.name).toBe("Test Repo");

    const plan = repo.createProfile("My Plan");
    expect(plan.name).toBe("My Plan");
    expect(repo.listProfiles()).toHaveLength(1);

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

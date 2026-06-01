import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
});

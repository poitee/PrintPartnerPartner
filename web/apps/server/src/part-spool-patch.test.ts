import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "./db/client.js";
import { AppRepository } from "./db/repository.js";

describe("patchPart spoolman_spool_id", () => {
  it("updates per-part spool override and clears spool when filament changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-part-spool-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const db = getDb(sqlite);
    const repo = new AppRepository(db, undefined, sqlite.reposDir);

    const source = repo.createSource({ name: "PartSpoolRepo", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "widget.stl"), "solid widget");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);

    const plan = repo.createProfile("PartSpoolPlan", source.id);
    repo.recomputeProfile(plan.id);
    const partId = repo.listParts(plan.id).parts[0]!.id;
    const filamentId = "spoolman:test-int:filament:7";
    const spoolRef = "spoolman:test-int:spool:3";
    const overrideRef = "spoolman:test-int:spool:9";

    let row = repo.patchPart(partId, { filament_color_id: filamentId, spoolman_spool_id: spoolRef });
    expect(row.filament_color_id).toBe(filamentId);
    expect(row.spoolman_spool_id).toBe(spoolRef);

    row = repo.patchPart(partId, { spoolman_spool_id: overrideRef });
    expect(row.spoolman_spool_id).toBe(overrideRef);

    row = repo.patchPart(partId, { spoolman_spool_id: null });
    expect(row.spoolman_spool_id).toBeNull();

    repo.patchPart(partId, { spoolman_spool_id: spoolRef });
    row = repo.patchPart(partId, { filament_color_id: "pla-black" });
    expect(row.filament_color_id).toBe("pla-black");
    expect(row.spoolman_spool_id).toBeNull();

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

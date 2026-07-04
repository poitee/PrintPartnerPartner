import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "./db/client.js";
import { AppRepository } from "./db/repository.js";
import { globalThumbnailPath } from "./lib/thumbnails.js";
import { clearPlanThumbnailCache } from "./services/plan-thumbnails.js";
import { canonicalRoleOrder, loadRoleFilamentDefaults } from "./services/role-filament-store.js";
import { resolvePartFilamentHex } from "./services/filament-catalog.js";
import { resolvePartStl } from "./services/part-paths.js";

describe("clearPlanThumbnailCache", () => {
  it("removes cached PNGs for parts in a plan", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-thumb-clear-"));
    const thumbsDir = join(dir, "thumbs");
    mkdirSync(thumbsDir, { recursive: true });
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

    const source = repo.createSource({ name: "ThumbRepo", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "widget.stl"), "solid widget");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);

    const plan = repo.createProfile("ThumbPlan", source.id);
    repo.recomputeProfile(plan.id);
    repo.bulkSetRoleFilament(plan.id, "primary", "pla-black", null);

    const part = repo.getProfilePartRows(plan.id)[0]!;
    const stl = resolvePartStl(repo, part)!;
    const hex = resolvePartFilamentHex(part);
    const thumbPath = globalThumbnailPath(thumbsDir, stl, part.role || "primary", hex);
    mkdirSync(join(thumbPath, ".."), { recursive: true });
    writeFileSync(thumbPath, Buffer.from("fake png"));

    const cleared = clearPlanThumbnailCache(repo, thumbsDir, plan.id);
    expect(cleared).toBeGreaterThan(0);

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("apply-role-colors route logic", () => {
  it("re-applies saved role defaults to matching parts", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-apply-roles-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

    const plan = repo.createProfile("ApplyRolesPlan");
    repo.bulkSetRoleFilament(plan.id, "accent", null, "#ff6600");

    const source = repo.createSource({ name: "AccentRepo", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "[a]_bracket.stl"), "solid accent");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);
    repo.setBaseLayer(plan.id, source.id);
    repo.recomputeProfile(plan.id);

    const part = repo.listParts(plan.id).parts.find((p) => p.role === "accent")!;
    repo.patchPart(part.id, { filament_color_id: "pla-white" });

    let updated = 0;
    const savedDefaults = loadRoleFilamentDefaults(repo, plan.id);
    for (const role of canonicalRoleOrder()) {
      const saved = savedDefaults[role];
      if (!saved?.filament_color_id && !saved?.filament_custom_hex) continue;
      updated += repo.bulkSetRoleFilament(
        plan.id,
        role,
        saved.filament_color_id ?? null,
        saved.filament_custom_hex ?? null,
        saved.spoolman_spool_id ?? undefined,
      );
    }
    expect(updated).toBeGreaterThan(0);
    expect(repo.listParts(plan.id).parts.find((p) => p.id === part.id)?.filament_custom_hex).toBe(
      "#ff6600",
    );

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

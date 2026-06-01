import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository } from "../db/repository.js";
import { buildPlanReview } from "./plan-review.js";

describe("buildPlanReview", () => {
  it("returns only included parts in part_groups", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-review-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

    const source = repo.createSource({ name: "Repo", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "included.stl"), "solid");
    writeFileSync(join(repoPath, "parts", "excluded.stl"), "solid");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);

    const plan = repo.createProfile("ReviewPlan", source.id);
    repo.recomputeProfile(plan.id);
    const parts = repo.listParts(plan.id).parts;
    expect(parts.length).toBe(2);

    const includedPart = parts.find((p) => p.filename === "included.stl")!;
    const excludedPart = parts.find((p) => p.filename === "excluded.stl")!;
    repo.patchPart(excludedPart.id, { included: false });

    const review = buildPlanReview(repo, plan.id);
    const reviewParts = review.part_groups.flatMap((g) => g.parts);
    expect(reviewParts).toHaveLength(1);
    expect(reviewParts[0]?.id).toBe(includedPart.id);
    expect(review.totals.included_parts).toBe(1);

    const withExcluded = buildPlanReview(repo, plan.id, { includeExcluded: true });
    const allReviewParts = withExcluded.part_groups.flatMap((g) => g.parts);
    expect(allReviewParts).toHaveLength(2);

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("clears merge_conflict when duplicate is excluded", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-review-conflict-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

    const baseSource = repo.createSource({ name: "BaseRepo", url: "https://github.com/a/base" });
    const addonSource = repo.createSource({ name: "AddonRepo", url: "https://github.com/a/addon" });
    const basePath = join(dir, "repos", String(baseSource.id));
    const addonPath = join(dir, "repos", String(addonSource.id));
    mkdirSync(join(basePath, "a"), { recursive: true });
    mkdirSync(join(addonPath, "b"), { recursive: true });
    writeFileSync(join(basePath, "a", "widget.stl"), "solid");
    writeFileSync(join(addonPath, "b", "widget.stl"), "solid");
    repo.updateSource(baseSource.id, { local_path: basePath });
    repo.updateSource(addonSource.id, { local_path: addonPath });
    repo.updateImportRules(baseSource.id, ["a/"]);
    repo.updateImportRules(addonSource.id, ["b/"]);

    const plan = repo.createProfile("ConflictPlan", baseSource.id);
    repo.addAddonLayer(plan.id, addonSource.id);
    repo.recomputeProfile(plan.id);
    const parts = repo.listParts(plan.id).parts;
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.status === "conflict")).toBe(true);

    const withConflict = buildPlanReview(repo, plan.id);
    expect(withConflict.issues.filter((i) => i.code === "merge_conflict")).toHaveLength(2);

    const keep = parts[0]!;
    const drop = parts.find((p) => p.id !== keep.id)!;
    repo.patchPart(drop.id, { included: false });

    const resolved = buildPlanReview(repo, plan.id);
    expect(resolved.issues.filter((i) => i.code === "merge_conflict")).toHaveLength(0);

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("includes print_units and progress fields on each part", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-review-units-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

    const source = repo.createSource({ name: "Repo", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "widget.stl"), "solid");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);

    const plan = repo.createProfile("UnitsPlan", source.id);
    repo.recomputeProfile(plan.id);
    const part = repo.listParts(plan.id).parts[0]!;
    repo.patchPart(part.id, { quantity_override: 2 });

    const review = buildPlanReview(repo, plan.id);
    const reviewPart = review.part_groups.flatMap((g) => g.parts)[0]!;
    expect(reviewPart.print_units).toEqual([false, false]);
    expect(reviewPart.printed_count).toBe(0);
    expect(reviewPart.missing).toBe(true);
    expect(reviewPart.quantity_effective).toBe(2);

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

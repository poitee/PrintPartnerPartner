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

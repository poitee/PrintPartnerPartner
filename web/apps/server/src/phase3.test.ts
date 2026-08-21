import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "./db/client.js";
import { AppRepository } from "./db/repository.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSelfHostPorts } from "./adapters/self-host/index.js";
import { buildStlTreePayload, progressSummary } from "@print-partner/domain";
import { exportProfileStlPack, exportStlPackJobMessage, STL_EXPORT_MISSING_HINT } from "./services/export-stl-pack.js";
import { buildPlanReview } from "./services/plan-review.js";
import { backfillAcceptedPlanRevisions } from "./db/accepted-plan-revisions.js";
import { backfillCurrentRequiredUnitSets } from "./db/required-units.js";

describe("Phase 3 APIs", () => {
  it("builds STL tree from repo folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-stl-"));
    mkdirSync(join(dir, "parts"), { recursive: true });
    writeFileSync(join(dir, "parts", "bracket.stl"), "solid");
    const payload = buildStlTreePayload(dir, JSON.stringify(["parts/"]));
    expect(payload.total).toBe(1);
    expect(payload.selected).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("plan review includes print_units and include_excluded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-rev-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    const source = repo.createSource({ name: "Repo", url: "https://github.com/a/b", source_kind: "github" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "x"), { recursive: true });
    writeFileSync(join(repoPath, "x", "part.stl"), "x");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["x/"]);

    const plan = repo.createProfile("Plan", source.id);
    await repo.recomputeProfile(plan.id);

    const review = buildPlanReview(repo, plan.id);
    const parts = review.part_groups.flatMap((g) => g.parts);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts[0].print_units).toEqual([false]);
    expect(parts[0].printed_count).toBe(0);
    expect(parts[0].missing).toBe(true);
    expect(parts[0].filament_display).toBeDefined();

    const partId = parts[0].id;
    repo.patchPart(partId, { included: false });
    const defaultReview = buildPlanReview(repo, plan.id);
    expect(defaultReview.part_groups.flatMap((g) => g.parts)).toHaveLength(0);

    const withExcluded = buildPlanReview(repo, plan.id, { includeExcluded: true });
    const excludedParts = withExcluded.part_groups.flatMap((g) => g.parts);
    expect(excludedParts.some((p) => !p.included)).toBe(true);

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("checkoff and progress patch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-chk-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    const source = repo.createSource({ name: "Repo", url: "https://github.com/a/b", source_kind: "github" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "x"), { recursive: true });
    writeFileSync(join(repoPath, "x", "part.stl"), "x");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["x/"]);

    const plan = repo.createProfile("Plan", source.id);
    await repo.recomputeProfile(plan.id);

    const checkoff = repo.getCheckoff(plan.id);
    expect(checkoff.parts.length).toBeGreaterThan(0);
    const partId = checkoff.parts[0].id;
    const patched = repo.patchPartProgress(partId, 0, true);
    expect(patched.printed_count).toBe(1);
    expect(patched.missing).toBe(false);

    const again = repo.getCheckoff(plan.id);
    expect(progressSummary(again.parts)).toContain("1/");

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("assembled field: defaults false, round-trips via repo and HTTP API", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-asm-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    const source = repo.createSource({ name: "Repo", url: "https://github.com/a/b", source_kind: "github" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "x"), { recursive: true });
    writeFileSync(join(repoPath, "x", "part.stl"), "x");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["x/"]);

    const plan = repo.createProfile("Plan", source.id);
    await repo.recomputeProfile(plan.id);

    const checkoff = repo.getCheckoff(plan.id);
    const partId = checkoff.parts[0].id;

    // New print_progress rows default to assembled=false, and it's only
    // reachable once a unit is completed (mirrors the checkoff UI's own gating).
    const enriched = repo.getEnrichedPartsForReview(plan.id, false);
    expect(enriched[0].assembled_units).toEqual([false]);

    repo.patchPartProgress(partId, 0, true);
    const patched = repo.patchPartAssembled(partId, 0, true);
    expect(patched.assembled_count).toBe(1);
    expect(patched.assembled_units).toEqual([true]);

    const afterAssembled = repo.getEnrichedPartsForReview(plan.id, false);
    expect(afterAssembled[0].assembled_units).toEqual([true]);

    // Toggling back off works too — the column is read/write, not append-only.
    const unset = repo.patchPartAssembled(partId, 0, false);
    expect(unset.assembled_units).toEqual([false]);

    // Same round trip through the actual HTTP endpoint used by the frontend,
    // to prove the route is wired end-to-end and doesn't break the existing
    // /parts/:id/progress contract alongside it.
    const raw = new Database(join(dir, "print-partner.db"));
    raw.pragma("foreign_keys = ON");
    backfillAcceptedPlanRevisions(raw, "2026-08-21T06:00:00.000Z");
    backfillCurrentRequiredUnitSets(raw, {
      now: () => "2026-08-21T06:01:00.000Z",
      tokenFactory: () => "ppu_00000000000000000000000000000001",
    });
    raw.close();
    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const app = await buildApp(config, ports);

    const progressRes = await app.inject({
      method: "PATCH",
      url: `/parts/${partId}/progress`,
      payload: { unit_index: 0, completed: true },
    });
    expect(progressRes.statusCode).toBe(200);
    expect(progressRes.json()).toMatchObject({ printed_count: 1, missing: false });

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/parts/${partId}/assembled`,
      payload: { unit_index: 0, assembled: true },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toMatchObject({ part_id: partId, assembled_count: 1, assembled_units: [true] });

    const missingFieldRes = await app.inject({
      method: "PATCH",
      url: `/parts/${partId}/assembled`,
      payload: { unit_index: 0 },
    });
    expect(missingFieldRes.statusCode).toBe(400);

    // Read accessor mirrors the write.
    const getRes = await app.inject({ method: "GET", url: `/parts/${partId}/assembled` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toMatchObject({ part_id: partId, assembled_count: 1, assembled_units: [true] });

    // Un-printing a unit clears its assembled flag, so re-checking the print
    // does not silently resurrect a stale "installed" state.
    await app.inject({
      method: "PATCH",
      url: `/parts/${partId}/progress`,
      payload: { unit_index: 0, completed: false },
    });
    await app.inject({
      method: "PATCH",
      url: `/parts/${partId}/progress`,
      payload: { unit_index: 0, completed: true },
    });
    const afterReprint = await app.inject({ method: "GET", url: `/parts/${partId}/assembled` });
    expect(afterReprint.json()).toMatchObject({ assembled_count: 0, assembled_units: [false] });

    // The progress PATCH response itself carries the post-toggle assembled
    // state, so the checkoff UI can clear the Assembled toggle in the same
    // round trip instead of showing a stale "installed" pip until a refetch.
    await app.inject({
      method: "PATCH",
      url: `/parts/${partId}/assembled`,
      payload: { unit_index: 0, assembled: true },
    });
    const unprintRes = await app.inject({
      method: "PATCH",
      url: `/parts/${partId}/progress`,
      payload: { unit_index: 0, completed: false },
    });
    expect(unprintRes.statusCode).toBe(200);
    expect(unprintRes.json()).toMatchObject({
      printed_count: 0,
      assembled_units: [false],
    });

    // An unknown part is a 404 on the read path.
    const missingPart = await app.inject({ method: "GET", url: `/parts/99999/assembled` });
    expect(missingPart.statusCode).toBe(404);

    await app.close();
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("export STL pack job via HTTP", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-exp-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const repo = ports.repository;
    const source = repo.createSource({ name: "R", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "p"), { recursive: true });
    writeFileSync(join(repoPath, "p", "a.stl"), "stl");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["p/"]);
    const plan = repo.createProfile("ExportPlan", source.id);
    repo.recomputeProfile(plan.id);

    const app = await buildApp(config, ports);
    const res = await app.inject({
      method: "POST",
      url: "/jobs/export-stl-pack",
      payload: { profile_id: plan.id },
    });
    expect(res.statusCode).toBe(200);
    const { job_id } = res.json() as { job_id: string };
    await new Promise((r) => setTimeout(r, 300));
    const jobRes = await app.inject({ method: "GET", url: `/jobs/${job_id}` });
    const job = jobRes.json() as { status: string; result?: { root_path?: string } };
    expect(job.status).toBe("done");
    expect(job.result?.root_path).toBeTruthy();

    await app.close();
    await ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("export remaining on fresh composed plan succeeds (missing_only)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-exp-remaining-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const repo = ports.repository;
    const source = repo.createSource({ name: "R", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "p"), { recursive: true });
    writeFileSync(join(repoPath, "p", "a.stl"), "stl");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["p/"]);
    const plan = repo.createProfile("RemainingFresh", source.id);
    await repo.recomputeProfile(plan.id);

    const review = buildPlanReview(repo, plan.id);
    expect(review.has_blockers).toBe(false);
    expect(review.totals.total_print_units).toBeGreaterThan(0);

    const app = await buildApp(config, ports);
    const res = await app.inject({
      method: "POST",
      url: "/jobs/export-stl-pack",
      payload: { profile_id: plan.id, missing_only: true },
    });
    expect(res.statusCode).toBe(200);
    const { job_id } = res.json() as { job_id: string };
    await new Promise((r) => setTimeout(r, 300));
    const jobRes = await app.inject({ method: "GET", url: `/jobs/${job_id}` });
    const job = jobRes.json() as {
      status: string;
      result?: { file_total?: number; warnings?: string[] };
    };
    expect(job.status).toBe("done");
    expect(job.result?.file_total ?? 0).toBeGreaterThan(0);
    expect((job.result?.warnings ?? []).some((w) => /already marked printed/i.test(w))).toBe(false);

    await app.close();
    await ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("export remaining still packs when review has a missing-STL blocker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-exp-blocker-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const repo = ports.repository;
    const source = repo.createSource({ name: "R", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "p"), { recursive: true });
    writeFileSync(join(repoPath, "p", "good.stl"), "stl");
    writeFileSync(join(repoPath, "p", "gone.stl"), "stl");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["p/"]);
    const plan = repo.createProfile("BlockerFresh", source.id);
    await repo.recomputeProfile(plan.id);
    rmSync(join(repoPath, "p", "gone.stl"));

    const review = buildPlanReview(repo, plan.id);
    expect(review.has_blockers).toBe(true);
    expect(review.issues.some((i) => i.code === "missing_stl")).toBe(true);

    const app = await buildApp(config, ports);
    const res = await app.inject({
      method: "POST",
      url: "/jobs/export-stl-pack",
      payload: { profile_id: plan.id, missing_only: true },
    });
    expect(res.statusCode).toBe(200);
    const { job_id } = res.json() as { job_id: string };
    await new Promise((r) => setTimeout(r, 300));
    const jobRes = await app.inject({ method: "GET", url: `/jobs/${job_id}` });
    const job = jobRes.json() as { status: string; result?: { file_total?: number } };
    expect(job.status).toBe("done");
    expect(job.result?.file_total ?? 0).toBeGreaterThan(0);

    await app.close();
    await ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("export STL pack job via HTTP with group_by color", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-exp-color-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const repo = ports.repository;
    const source = repo.createSource({ name: "R", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "alpha"), { recursive: true });
    mkdirSync(join(repoPath, "beta"), { recursive: true });
    writeFileSync(join(repoPath, "alpha", "part.stl"), "stl");
    writeFileSync(join(repoPath, "beta", "part.stl"), "stl");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["alpha/", "beta/"]);
    const plan = repo.createProfile("ExportFlat", source.id);
    await repo.recomputeProfile(plan.id);

    const app = await buildApp(config, ports);
    const res = await app.inject({
      method: "POST",
      url: "/jobs/export-stl-pack",
      payload: { profile_id: plan.id, group_by: "color" },
    });
    expect(res.statusCode).toBe(200);
    const { job_id } = res.json() as { job_id: string };
    await new Promise((r) => setTimeout(r, 300));
    const jobRes = await app.inject({ method: "GET", url: `/jobs/${job_id}` });
    const job = jobRes.json() as {
      status: string;
      result?: { root_path?: string };
    };
    expect(job.status).toBe("done");
    const rootPath = job.result?.root_path;
    expect(rootPath).toBeTruthy();
    const roleDir = join(rootPath!, "primary");
    expect(existsSync(roleDir)).toBe(true);
    expect(existsSync(join(roleDir, "alpha"))).toBe(false);
    expect(existsSync(join(roleDir, "beta"))).toBe(false);
    const files = readdirSync(roleDir);
    expect(files.some((f) => f.endsWith(".stl"))).toBe(true);

    await app.close();
    await ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("exportProfileStlPack copies files", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pack-"));
    const stl = join(dir, "part.stl");
    writeFileSync(stl, "solid");
    const { rootPath, fileCounts } = exportProfileStlPack(
      "Test",
      [
        {
          matchKey: "part.stl",
          relativePath: "part.stl",
          filename: "part.stl",
          sourceLayer: "base:R",
          status: "base",
          role: "primary",
          quantityAuto: 1,
          quantityOverride: null,
          partSlug: "part",
          included: true,
          notes: "",
          geometrySame: null,
          absolutePath: stl,
        },
      ],
      join(dir, "exports"),
    );
    expect(rootPath).toContain("stl");
    expect(fileCounts.primary).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("exportProfileStlPack groups by color + directory by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pack-dir-"));
    mkdirSync(join(dir, "alpha"), { recursive: true });
    mkdirSync(join(dir, "beta"), { recursive: true });
    const stlA = join(dir, "alpha", "part.stl");
    const stlB = join(dir, "beta", "part.stl");
    writeFileSync(stlA, "solidA");
    writeFileSync(stlB, "solidB");
    const part = (relativePath: string, absolutePath: string) => ({
      matchKey: relativePath,
      relativePath,
      filename: "part.stl",
      sourceLayer: "base:R",
      status: "base",
      role: "primary",
      quantityAuto: 1,
      quantityOverride: null,
      partSlug: "part",
      included: true,
      notes: "",
      geometrySame: null,
      absolutePath,
    });
    const { rootPath, fileCounts } = exportProfileStlPack(
      "Test",
      [part("alpha/part.stl", stlA), part("beta/part.stl", stlB)],
      join(dir, "exports"),
    );
    expect(fileCounts.primary).toBe(2);
    expect(existsSync(join(rootPath, "primary", "alpha", "part_01.stl"))).toBe(true);
    expect(existsSync(join(rootPath, "primary", "beta", "part_01.stl"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("exportProfileStlPack flattens by color and de-dupes collisions", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pack-flat-"));
    mkdirSync(join(dir, "alpha"), { recursive: true });
    mkdirSync(join(dir, "beta"), { recursive: true });
    const stlA = join(dir, "alpha", "part.stl");
    const stlB = join(dir, "beta", "part.stl");
    writeFileSync(stlA, "solidA");
    writeFileSync(stlB, "solidB");
    const part = (relativePath: string, absolutePath: string) => ({
      matchKey: relativePath,
      relativePath,
      filename: "part.stl",
      sourceLayer: "base:R",
      status: "base",
      role: "primary",
      quantityAuto: 1,
      quantityOverride: null,
      partSlug: "part",
      included: true,
      notes: "",
      geometrySame: null,
      absolutePath,
    });
    const { rootPath, fileCounts } = exportProfileStlPack(
      "Test",
      [part("alpha/part.stl", stlA), part("beta/part.stl", stlB)],
      join(dir, "exports"),
      { groupBy: "color" },
    );
    expect(fileCounts.primary).toBe(2);
    const roleDir = join(rootPath, "primary");
    const files = readdirSync(roleDir);
    expect(files).toHaveLength(2);
    expect(files).toContain("part_01.stl");
    // Second same-named file is de-duped with a directory prefix.
    expect(files.some((f) => f !== "part_01.stl" && f.endsWith("part_01.stl"))).toBe(true);
    // No nested directory folders were created in flat mode.
    expect(existsSync(join(roleDir, "alpha"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("exportProfileStlPack warns with sync hint when STL paths missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pack-missing-"));
    const { warnings } = exportProfileStlPack(
      "Test",
      [
        {
          matchKey: "missing.stl",
          relativePath: "parts/missing.stl",
          filename: "missing.stl",
          sourceLayer: "base:R",
          status: "base",
          role: "primary",
          quantityAuto: 1,
          quantityOverride: null,
          partSlug: "missing",
          included: true,
          notes: "",
          geometrySame: null,
          absolutePath: null,
        },
      ],
      join(dir, "exports"),
    );
    expect(warnings[0]).toContain("Missing STL: parts/missing.stl");
    expect(warnings[0]).toContain(STL_EXPORT_MISSING_HINT);
    rmSync(dir, { recursive: true, force: true });
  });

  it("missing_only with no included parts does not claim everything is printed", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pack-empty-missing-"));
    const { warnings, fileCounts } = exportProfileStlPack("Empty", [], join(dir, "exports"), {
      missingOnly: true,
      completedByMatchKey: {},
    });
    expect(Object.values(fileCounts).reduce((a, b) => a + b, 0)).toBe(0);
    expect(warnings.some((w) => /already marked printed/i.test(w))).toBe(false);
    expect(warnings[0]).toMatch(/no included parts/i);
    rmSync(dir, { recursive: true, force: true });
  });

  it("missing_only with only missing STL paths does not claim everything is printed", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pack-all-missing-"));
    const { warnings } = exportProfileStlPack(
      "Missing",
      [
        {
          matchKey: "missing.stl",
          relativePath: "parts/missing.stl",
          filename: "missing.stl",
          sourceLayer: "base:R",
          status: "base",
          role: "primary",
          quantityAuto: 1,
          quantityOverride: null,
          partSlug: "missing",
          included: true,
          notes: "",
          geometrySame: null,
          absolutePath: null,
        },
      ],
      join(dir, "exports"),
      { missingOnly: true, completedByMatchKey: {} },
    );
    expect(warnings.some((w) => /already marked printed/i.test(w))).toBe(false);
    expect(warnings.some((w) => /Missing STL/i.test(w))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("exportStlPackJobMessage surfaces warnings-only completion", () => {
    expect(
      exportStlPackJobMessage({
        file_total: 2,
        warnings: ["Missing STL: a.stl (base:R). Sync Sources and fix Review blockers, then export again."],
      }),
    ).toBe("Exported 2 file(s) with 1 warning(s)");
    expect(exportStlPackJobMessage({ file_total: 0, warnings: [] })).toContain(
      STL_EXPORT_MISSING_HINT,
    );
  });
});

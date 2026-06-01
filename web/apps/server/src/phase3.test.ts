import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "./db/client.js";
import { AppRepository } from "./db/repository.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSelfHostPorts } from "./adapters/self-host/index.js";
import { buildStlTreePayload, progressSummary } from "@print-partner/domain";
import { exportProfileStlPack } from "./services/export-stl-pack.js";

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
});

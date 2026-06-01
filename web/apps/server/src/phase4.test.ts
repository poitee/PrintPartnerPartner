import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "./db/client.js";
import { AppRepository } from "./db/repository.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSelfHostPorts } from "./adapters/self-host/index.js";
import { loadFleet, saveFleet } from "./services/printer-fleet.js";

const MINI_STL = `solid t
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 0 10 0
    endloop
  endfacet
endsolid t
`;

describe("Phase 4 APIs", () => {
  it("export 3mf job via HTTP", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-3mf-api-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const repo = ports.repository;
    saveFleet(repo, [
      {
        id: "test-printer",
        name: "Test",
        bed_width_mm: 200,
        bed_depth_mm: 200,
        bed_height_mm: 200,
        margin_mm: 4,
        max_filament_slots: 1,
        loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
      },
    ]);
    const source = repo.createSource({ name: "R", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "p"), { recursive: true });
    writeFileSync(join(repoPath, "p", "a.stl"), MINI_STL);
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["p/"]);
    const plan = repo.createProfile("3MF Plan", source.id);
    repo.recomputeProfile(plan.id);

    const app = await buildApp(config, ports);
    const res = await app.inject({
      method: "POST",
      url: "/jobs/export-3mf",
      payload: {
        profile_id: plan.id,
        enabled_printer_ids: ["test-printer"],
      },
    });
    expect(res.statusCode).toBe(200);
    const { job_id } = res.json() as { job_id: string };
    await new Promise((r) => setTimeout(r, 500));
    const jobRes = await app.inject({ method: "GET", url: `/jobs/${job_id}` });
    const job = jobRes.json() as { status: string; result?: { object_count?: number } };
    expect(job.status).toBe("done");
    expect((job.result?.object_count ?? 0) > 0).toBe(true);
    await ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("pack-preview job returns preview", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pack-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const repo = ports.repository;
    saveFleet(repo, [
      {
        id: "p1",
        name: "Bed",
        bed_width_mm: 200,
        bed_depth_mm: 200,
        bed_height_mm: 200,
        margin_mm: 4,
        max_filament_slots: 1,
        loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
      },
    ]);
    const source = repo.createSource({ name: "S", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "x"), { recursive: true });
    writeFileSync(join(repoPath, "x", "part.stl"), MINI_STL);
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["x/"]);
    const plan = repo.createProfile("Pack", source.id);
    repo.recomputeProfile(plan.id);

    const app = await buildApp(config, ports);
    const res = await app.inject({
      method: "POST",
      url: "/jobs/pack-preview",
      payload: {
        profile_id: plan.id,
        enabled_printer_ids: ["p1"],
        auto_assign: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const { job_id } = res.json() as { job_id: string };
    await new Promise((r) => setTimeout(r, 400));
    const job = (await app.inject({ method: "GET", url: `/jobs/${job_id}` })).json() as {
      status: string;
      result?: { preview?: unknown[] };
    };
    expect(job.status).toBe("done");
    expect(Array.isArray(job.result?.preview)).toBe(true);
    await ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("printer fleet CRUD", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-printers-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    saveFleet(repo, []);
    expect(loadFleet(repo)).toEqual([]);
    saveFleet(repo, [
      {
        id: "p1",
        name: "A",
        bed_width_mm: 250,
        bed_depth_mm: 210,
        bed_height_mm: 250,
        margin_mm: 4,
        max_filament_slots: 1,
        loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
      },
    ]);
    expect(loadFleet(repo)).toHaveLength(1);
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

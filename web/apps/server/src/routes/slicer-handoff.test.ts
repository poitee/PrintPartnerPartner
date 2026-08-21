import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository } from "../db/repository.js";
import { registerSlicerHandoffRoutes } from "./slicer-handoff.js";
import type { ServerConfig } from "../config.js";

vi.mock("../services/export-3mf-job.js", () => ({
  runExport3mfJob: vi.fn(),
}));

vi.mock("../services/printer-fleet.js", () => ({
  loadFleet: vi.fn(() => [{ id: "p1", name: "Printer 1" }]),
}));

import { runExport3mfJob } from "../services/export-3mf-job.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
  vi.clearAllMocks();
});

function minimalConfig(exchangeDir: string): ServerConfig {
  return { exchangeDir } as ServerConfig;
}

describe("slicer handoff exchange-status", () => {
  it("reports ready when exchange dir is writable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-exchange-"));
    const app = Fastify();
    const sqliteDir = mkdtempSync(join(tmpdir(), "pp-handoff-db-"));
    const sqlite = new SqliteDatabase(sqliteDir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    await registerSlicerHandoffRoutes(app, {
      repo,
      config: minimalConfig(dir),
      exportsDir: join(dir, "exports"),
      dataDir: dir,
      reposDir: sqlite.reposDir,
    });
    cleanup.push(() => {
      void app.close();
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(sqliteDir, { recursive: true, force: true });
    });

    const res = await app.inject({ method: "GET", url: "/slicer-handoff/exchange-status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ready: true, configured: true });
  });

  it("reports not ready when exchange dir is missing", async () => {
    const app = Fastify();
    const sqliteDir = mkdtempSync(join(tmpdir(), "pp-handoff-db2-"));
    const sqlite = new SqliteDatabase(sqliteDir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    await registerSlicerHandoffRoutes(app, {
      repo,
      config: minimalConfig("/definitely/missing/exchange-pp"),
      exportsDir: join(sqliteDir, "exports"),
      dataDir: sqliteDir,
      reposDir: sqlite.reposDir,
    });
    cleanup.push(() => {
      void app.close();
      sqlite.close();
      rmSync(sqliteDir, { recursive: true, force: true });
    });

    const res = await app.inject({ method: "GET", url: "/slicer-handoff/exchange-status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ready: false });
  });
});

describe("POST /slicer-instances/:id/open-plates", () => {
  it("exports, stages plates, and returns gui_url", async () => {
    const root = mkdtempSync(join(tmpdir(), "pp-open-plates-"));
    const exchangeDir = join(root, "exchange");
    const exportsDir = join(root, "exports");
    mkdirSync(exchangeDir, { recursive: true });
    mkdirSync(exportsDir, { recursive: true });

    const sqlite = new SqliteDatabase(join(root, "db"));
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    const plan = repo.createProfile("Handoff Plan");
    const instance = repo.upsertSlicerInstance({
      name: "Orca",
      kind: "orca",
      dialect: "orca_json",
      guiUrl: "http://127.0.0.1:18888",
      watchPath: "/profiles/orca",
      enabled: true,
    });

    const plate = join(exportsDir, "tenant-default", "plate_01.3mf");
    mkdirSync(join(exportsDir, "tenant-default"), { recursive: true });
    writeFileSync(plate, "fake-3mf");
    vi.mocked(runExport3mfJob).mockReturnValue({
      paths: [plate],
      object_count: 1,
      warnings: [],
      primary_path: plate,
      plate_count: 1,
      printer_summaries: [],
    } as unknown as ReturnType<typeof runExport3mfJob>);

    const app = Fastify();
    await registerSlicerHandoffRoutes(app, {
      repo,
      config: minimalConfig(exchangeDir),
      exportsDir,
      dataDir: root,
      reposDir: sqlite.reposDir,
    });
    cleanup.push(() => {
      void app.close();
      sqlite.close();
      rmSync(root, { recursive: true, force: true });
    });

    const res = await app.inject({
      method: "POST",
      url: `/slicer-instances/${instance.id}/open-plates`,
      payload: { profile_id: plan.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gui_url).toBe("http://127.0.0.1:18888");
    expect(body.staged).toHaveLength(1);
    expect(body.staged[0].filename).toBe("plate_01.3mf");
    expect(body.inbox_dir).toContain("pp-inbox");
    expect(runExport3mfJob).toHaveBeenCalled();
  });

  it("returns 400 when exchange is not ready", async () => {
    const root = mkdtempSync(join(tmpdir(), "pp-open-plates-bad-"));
    const sqlite = new SqliteDatabase(join(root, "db"));
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    const instance = repo.upsertSlicerInstance({
      name: "Orca",
      kind: "orca",
      dialect: "orca_json",
      guiUrl: "http://127.0.0.1:18888",
      watchPath: "/profiles/orca",
      enabled: true,
    });
    const app = Fastify();
    await registerSlicerHandoffRoutes(app, {
      repo,
      config: minimalConfig("/missing/exchange-dir-pp"),
      exportsDir: join(root, "exports"),
      dataDir: root,
      reposDir: sqlite.reposDir,
    });
    cleanup.push(() => {
      void app.close();
      sqlite.close();
      rmSync(root, { recursive: true, force: true });
    });

    const res = await app.inject({
      method: "POST",
      url: `/slicer-instances/${instance.id}/open-plates`,
      payload: { profile_id: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/Exchange|PP_EXCHANGE/i);
  });
});

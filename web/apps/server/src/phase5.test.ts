import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "./db/client.js";
import { AppRepository } from "./db/repository.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { matchKeyMatches } from "./services/manifest-apply.js";
import { exportKitBundle, loadKitBundleBytes, parseKitBundleBuffer, KIT_FORMAT } from "./services/export-kit.js";
import { setRequestTenantId } from "./middleware/tenant-context.js";
import { SaasS3StoragePort } from "./adapters/saas/storage-s3.js";
import { fetchPrintablesMetadata } from "./services/source-adapters.js";
import { buildPlanReview } from "./services/plan-review.js";

describe("Phase 5", () => {
  it("matchKeyMatches supports globs", () => {
    expect(matchKeyMatches("parts/*.stl", "parts/bracket.stl")).toBe(true);
    expect(matchKeyMatches("bracket.stl", "parts/bracket.stl")).toBe(true);
  });

  it("apply-manifest after recompute sets requirement", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-mf-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    const source = repo.createSource({ name: "Repo", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "bracket.stl"), "solid");
    writeFileSync(
      join(repoPath, "print-partner.manifest.yaml"),
      "format: print-partner-manifest-v2\nversion: 2\nparts:\n  - match: parts/bracket.stl\n    requirement: required\n",
    );
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);
    const plan = repo.createProfile("Plan", source.id);
    repo.recomputeProfile(plan.id, { apply_manifest: true });
    const { parts } = repo.listParts(plan.id, 100, 0);
    expect(parts[0]?.requirement).toBe("required");
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("kit bundle import round-trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-kit-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    const source = repo.createSource({ name: "R", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "p"), { recursive: true });
    writeFileSync(join(repoPath, "p", "a.stl"), "stl");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["p/"]);
    const plan = repo.createProfile("KitPlan", source.id);
    repo.recomputeProfile(plan.id);
    const bundlePath = exportKitBundle(repo, plan.id, join(dir, "exports"), false);
    const data = loadKitBundleBytes(bundlePath);
    expect(data.format).toBe(KIT_FORMAT);
    const imported = repo.importKitBundle(data, "Imported");
    expect(imported.parts_imported).toBeGreaterThan(0);
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("parseKitBundleBuffer reads zip bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-kit-buf-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    const source = repo.createSource({ name: "R", url: "https://github.com/a/b" });
    const plan = repo.createProfile("KitPlan", source.id);
    const bundlePath = exportKitBundle(repo, plan.id, join(dir, "exports"), false);
    const data = parseKitBundleBuffer(readFileSync(bundlePath), bundlePath);
    expect(data.format).toBe(KIT_FORMAT);
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("plan review reports unsynced blocker", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-rev-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    const source = repo.createSource({ name: "Offline", url: "https://github.com/a/b" });
    const plan = repo.createProfile("Review", source.id);
    repo.setBaseLayer(plan.id, source.id);
    const review = buildPlanReview(repo, plan.id);
    expect(review.has_blockers).toBe(true);
    expect(review.issues.some((i) => i.code === "unsynced_source")).toBe(true);
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("printables adapter returns not supported", () => {
    const meta = fetchPrintablesMetadata("https://www.printables.com/model/123");
    expect(meta.supported).toBe(false);
    expect(meta.message).toContain("not supported");
  });

  it("S3 storage resolvePath uses tenant prefix", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-s3-"));
    const storage = new SaasS3StoragePort("test-bucket", "tenant-a", dir);
    expect(storage.resolvePath("exports/foo.zip")).toBe("s3://test-bucket/tenant-a/exports/foo.zip");
    rmSync(dir, { recursive: true, force: true });
  });

  it("createSaasPorts with DATABASE_URL defers repository until connect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-saas-pg-"));
    process.env.DATABASE_URL = "postgresql://printpartner:printpartner@localhost:5432/printpartner";
    const { createSaasPorts } = await import("./adapters/saas/index.js");
    expect(() => createSaasPorts(dir)).not.toThrow();
    const ports = createSaasPorts(dir);
    expect(ports.db.defaultRepository).toBeNull();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.DATABASE_URL;
  });

  it("saas health includes db when anonymous allowed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-saas-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    process.env.DEPLOY_MODE = "saas";
    process.env.SAAS_DATA_DIR = dir;
    process.env.SAAS_ALLOW_ANONYMOUS = "1";
    delete process.env.DATABASE_URL;

    const config = loadConfig();
    const { createSaasPorts } = await import("./adapters/saas/index.js");
    const ports = createSaasPorts(dir);
    await ports.db.connect();
    const app = await buildApp(config, ports);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; deploy_mode: string };
    expect(body.ok).toBe(true);
    expect(body.deploy_mode).toBe("saas");

    await app.close();
    await ports.db.close();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.DEPLOY_MODE;
    delete process.env.SAAS_DATA_DIR;
    delete process.env.SAAS_ALLOW_ANONYMOUS;
  });

  it("tenant context scopes repository queries", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-ten-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), "default", sqlite.reposDir);
    setRequestTenantId("tenant-b");
    repo.createSource({ name: "T", url: "https://github.com/a/b" });
    setRequestTenantId("default");
    expect(repo.listSources().length).toBe(0);
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

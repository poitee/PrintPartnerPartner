import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createSelfHostPorts } from "../adapters/self-host/index.js";
import { registerExportRoutes } from "./exports.js";

/**
 * GET /exports/* serves the files export jobs produce. Auto-slice writes a
 * plate thumbnail (gcode/thumbnails/plate_NN.png) that the UI renders with an
 * <img src>, so a PNG must come back inline with image/png — an
 * octet-stream attachment would download instead of render.
 */

let cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "pp-exports-route-"));
  process.env.PRINT_PARTNER_DATA_DIR = dir;
  delete process.env.PRINT_PARTNER_API_KEY;
  const config = loadConfig();
  const ports = createSelfHostPorts(dir);
  await ports.db.connect();
  const app = await buildApp(config, ports);
  cleanup.push(() => {
    void app.close();
    void ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { app, dir };
}

/** 1x1 transparent PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("GET /exports/*", () => {
  it("serves same-named artifacts only from the authenticated tenant directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-exports-tenant-route-"));
    const app = Fastify();
    app.decorateRequest("tenantId", "default");
    app.addHook("onRequest", async (request) => {
      request.tenantId = String(request.headers["x-test-tenant"] ?? "default");
    });
    await registerExportRoutes(app, { dataDir: dir });
    cleanup.push(() => {
      void app.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const tenantA = join(dir, "exports", "tenant-tenant-a", "same");
    const tenantB = join(dir, "exports", "tenant-tenant-b", "same");
    mkdirSync(tenantA, { recursive: true });
    mkdirSync(tenantB, { recursive: true });
    writeFileSync(join(tenantA, "plate.gcode"), "TENANT-A\n");
    writeFileSync(join(tenantB, "plate.gcode"), "TENANT-B\n");

    const a = await app.inject({
      method: "GET",
      url: "/exports/same/plate.gcode",
      headers: { "x-test-tenant": "tenant-a" },
    });
    const b = await app.inject({
      method: "GET",
      url: "/exports/same/plate.gcode",
      headers: { "x-test-tenant": "tenant-b" },
    });
    const crossTenant = await app.inject({
      method: "GET",
      url: "/exports/tenant-tenant-a/same/plate.gcode",
      headers: { "x-test-tenant": "tenant-b" },
    });

    expect(a.statusCode).toBe(200);
    expect(a.body).toBe("TENANT-A\n");
    expect(b.statusCode).toBe(200);
    expect(b.body).toBe("TENANT-B\n");
    expect(crossTenant.statusCode).toBe(404);
  });

  it("serves an auto-slice plate thumbnail inline as image/png", async () => {
    const { app, dir } = await makeApp();
    const thumbDir = join(dir, "exports", "my_plan", "gcode", "thumbnails");
    mkdirSync(thumbDir, { recursive: true });
    writeFileSync(join(thumbDir, "plate_01.png"), PNG);

    const res = await app.inject({
      method: "GET",
      url: "/exports/my_plan/gcode/thumbnails/plate_01.png",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-disposition"]).toContain("inline");
    expect(res.rawPayload.subarray(0, 8)).toEqual(PNG.subarray(0, 8));
  });

  it("still serves gcode as a downloadable attachment", async () => {
    const { app, dir } = await makeApp();
    const gcodeDir = join(dir, "exports", "my_plan", "gcode");
    mkdirSync(gcodeDir, { recursive: true });
    writeFileSync(join(gcodeDir, "my_plan_voron_plate_01.gcode"), "G28\n");

    const res = await app.inject({
      method: "GET",
      url: "/exports/my_plan/gcode/my_plan_voron_plate_01.gcode",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.body).toContain("G28");
  });

  it("404s a missing export and rejects traversal", async () => {
    const { app } = await makeApp();
    const missing = await app.inject({ method: "GET", url: "/exports/nope/plate_01.png" });
    expect(missing.statusCode).toBe(404);

    const traversal = await app.inject({
      method: "GET",
      url: "/exports/../../etc/passwd",
    });
    expect(traversal.statusCode).toBeGreaterThanOrEqual(400);
  });
});

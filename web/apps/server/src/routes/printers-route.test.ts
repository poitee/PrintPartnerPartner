import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createSelfHostPorts } from "../adapters/self-host/index.js";

/**
 * Route-level checks for PUT /printers/:id — the per-printer slicer override
 * endpoint that Settings' printer cards call.
 */

let cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

async function makeApp() {
  const previousDataDir = process.env.PRINT_PARTNER_DATA_DIR;
  const previousApiKey = process.env.PRINT_PARTNER_API_KEY;
  const dir = mkdtempSync(join(tmpdir(), "pp-printers-route-"));
  process.env.PRINT_PARTNER_DATA_DIR = dir;
  delete process.env.PRINT_PARTNER_API_KEY;
  const config = loadConfig();
  const ports = createSelfHostPorts(dir);
  await ports.db.connect();
  const app = await buildApp(config, ports);
  cleanup.push(async () => {
    try {
      await app.close();
      await ports.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (previousDataDir === undefined) delete process.env.PRINT_PARTNER_DATA_DIR;
      else process.env.PRINT_PARTNER_DATA_DIR = previousDataDir;
      if (previousApiKey === undefined) delete process.env.PRINT_PARTNER_API_KEY;
      else process.env.PRINT_PARTNER_API_KEY = previousApiKey;
    }
  });
  return app;
}

async function addPrinter(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/printers",
    payload: { name, bed_width_mm: 250, bed_depth_mm: 210 },
  });
  return res.json() as { id: string };
}

describe("PUT /printers/:id", () => {
  it("sets an explicit preferred_slicer override", async () => {
    const app = await makeApp();
    const printer = await addPrinter(app, "Redoubt");

    const res = await app.inject({
      method: "PUT",
      url: `/printers/${printer.id}`,
      payload: { preferred_slicer: "prusa" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: printer.id, preferred_slicer: "prusa" });

    const list = await app.inject({ method: "GET", url: "/printers" });
    const fleet = list.json() as { printers: Array<{ id: string; preferred_slicer?: string | null }> };
    expect(fleet.printers.find((p) => p.id === printer.id)?.preferred_slicer).toBe("prusa");
  });

  it("clears the override back to Auto with null", async () => {
    const app = await makeApp();
    const printer = await addPrinter(app, "Vertigo");
    await app.inject({
      method: "PUT",
      url: `/printers/${printer.id}`,
      payload: { preferred_slicer: "bambu" },
    });

    const res = await app.inject({
      method: "PUT",
      url: `/printers/${printer.id}`,
      payload: { preferred_slicer: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: printer.id, preferred_slicer: null });
  });

  it("rejects an invalid slicer value", async () => {
    const app = await makeApp();
    const printer = await addPrinter(app, "Trident");
    const res = await app.inject({
      method: "PUT",
      url: `/printers/${printer.id}`,
      payload: { preferred_slicer: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s for an unknown printer id", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "PUT",
      url: "/printers/does-not-exist",
      payload: { preferred_slicer: "orca" },
    });
    expect(res.statusCode).toBe(404);
  });
});

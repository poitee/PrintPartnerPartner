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
    payload: { name, model: name, bed_width_mm: 250, bed_depth_mm: 210 },
  });
  return res.json() as { id: string };
}

describe("POST /printers", () => {
  it("requires an explicit model for a custom Printer", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/printers",
      payload: { name: "Unnamed model", bed_width_mm: 250, bed_depth_mm: 210 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ detail: "model is required" });
  });

  it("creates a planning Printer from a preset without a connection", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/printers",
      payload: { name: "Shop Voron", preset_id: "preset-voron-250" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Shop Voron",
      model: "voron-250",
      bed_width_mm: 250,
      bed_depth_mm: 250,
      bed_height_mm: 250,
      preset_id: "preset-voron-250",
    });
    expect(response.json().integration_id ?? null).toBeNull();
  });

  it("creates a custom Printer without a connection", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/printers",
      payload: {
        name: "Wide bed",
        model: "Wide bed",
        bed_width_mm: 400,
        bed_depth_mm: 400,
        bed_height_mm: 450,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Wide bed",
      model: "Wide bed",
      bed_width_mm: 400,
      bed_depth_mm: 400,
      bed_height_mm: 450,
    });
    expect(response.json().integration_id ?? null).toBeNull();
  });

  it("rejects an unknown Printer preset", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/printers",
      payload: { name: "Ghost", preset_id: "preset-does-not-exist" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ detail: "Unknown Printer preset" });
  });

  it("keeps copied model and bed size after the preset_id is unknown", async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: "POST",
      url: "/printers",
      payload: { name: "Shop Voron", preset_id: "preset-voron-250" },
    });
    expect(created.statusCode).toBe(200);
    const machine = created.json() as Record<string, unknown>;

    const saved = await app.inject({
      method: "PUT",
      url: "/printers",
      payload: {
        printers: [{ ...machine, preset_id: "preset-retired-voron" }],
      },
    });
    expect(saved.statusCode).toBe(200);

    const listed = await app.inject({ method: "GET", url: "/printers" });
    expect(listed.statusCode).toBe(200);
    const fleet = listed.json() as { printers: Array<Record<string, unknown>> };
    expect(fleet.printers).toHaveLength(1);
    expect(fleet.printers[0]).toMatchObject({
      id: machine.id,
      name: "Shop Voron",
      model: "voron-250",
      bed_width_mm: 250,
      bed_depth_mm: 250,
      bed_height_mm: 250,
      preset_id: "preset-retired-voron",
    });
    expect(fleet.printers[0]?.integration_id ?? null).toBeNull();
  });

  it("updates a planning Printer's model and bed size without a connection", async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: "POST",
      url: "/printers",
      payload: { name: "Shop Voron", preset_id: "preset-voron-250" },
    });
    const machine = created.json() as Record<string, unknown>;

    const saved = await app.inject({
      method: "PUT",
      url: "/printers",
      payload: {
        printers: [
          {
            ...machine,
            model: "Voron 300",
            bed_width_mm: 300,
            bed_depth_mm: 300,
            bed_height_mm: 320,
          },
        ],
      },
    });
    expect(saved.statusCode).toBe(200);
    const fleet = saved.json() as { printers: Array<Record<string, unknown>> };
    expect(fleet.printers).toHaveLength(1);
    expect(fleet.printers[0]).toMatchObject({
      id: machine.id,
      name: "Shop Voron",
      model: "Voron 300",
      bed_width_mm: 300,
      bed_depth_mm: 300,
      bed_height_mm: 320,
      preset_id: "preset-voron-250",
    });
    expect(fleet.printers[0]?.integration_id ?? null).toBeNull();
  });
});

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

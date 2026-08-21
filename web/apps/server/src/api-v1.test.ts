import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSelfHostPorts } from "./adapters/self-host/index.js";

describe("API v1", () => {
  it("flat and versioned GET /plans return the same profiles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-apiv1-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    delete process.env.PRINT_PARTNER_API_KEY;

    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    ports.repository.createProfile("Plan A");

    const app = await buildApp(config, ports);
    const flat = await app.inject({ method: "GET", url: "/plans" });
    const v1 = await app.inject({ method: "GET", url: "/api/v1/plans" });

    expect(flat.statusCode).toBe(200);
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toEqual(flat.json());

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("flat and versioned duplicate routes return the full profile summary with layers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-apiv1-duplicate-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    delete process.env.PRINT_PARTNER_API_KEY;

    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const source = ports.repository.createSource({
      name: "Base",
      url: "https://example.com/base.git",
      source_kind: "github",
    });
    const plan = ports.repository.createProfile("Template", source.id);
    const app = await buildApp(config, ports);

    const flat = await app.inject({
      method: "POST",
      url: `/plans/${plan.id}/duplicate`,
      payload: { name: "Flat copy", clear_checkoff: true },
    });
    expect(flat.statusCode).toBe(200);
    expect(flat.json()).toEqual({
      id: expect.any(Number),
      name: "Flat copy",
      order_number: null,
      special_request: null,
      part_count: 0,
      remaining_units: 0,
      total_units: 0,
      build_stale: false,
      freshness: {
        status: "untracked",
        accepted_input_set_id: null,
        accepted_at: null,
        reasons: [{ kind: "no_accepted_inputs" }],
      },
      archived_at: null,
      last_used_at: expect.any(String),
      layers: [
        {
          id: expect.any(Number),
          layer_order: 0,
          layer_type: "base",
          project_id: source.id,
          project_name: "Base",
        },
      ],
    });

    const versioned = await app.inject({
      method: "POST",
      url: `/api/v1/plans/${plan.id}/duplicate`,
      payload: { name: "Versioned copy", clear_checkoff: true },
    });
    expect(versioned.statusCode).toBe(200);
    expect(versioned.json()).toEqual({
      id: expect.any(Number),
      name: "Versioned copy",
      order_number: null,
      special_request: null,
      part_count: 0,
      remaining_units: 0,
      total_units: 0,
      build_stale: false,
      freshness: {
        status: "untracked",
        accepted_input_set_id: null,
        accepted_at: null,
        reasons: [{ kind: "no_accepted_inputs" }],
      },
      archived_at: null,
      last_used_at: expect.any(String),
      layers: [
        {
          id: expect.any(Number),
          layer_order: 0,
          layer_type: "base",
          project_id: source.id,
          project_name: "Base",
        },
      ],
    });

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /api/v1 index and openapi redirect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-apiv1b-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    delete process.env.PRINT_PARTNER_API_KEY;

    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const app = await buildApp(config, ports);

    const index = await app.inject({ method: "GET", url: "/api/v1" });
    expect(index.statusCode).toBe(200);
    const body = index.json() as { version: string; openapi: string };
    expect(body.version).toBe("1");
    expect(body.openapi).toBe("/api/v1/openapi.json");

    const alias = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(alias.statusCode).toBe(302);

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects /api/v1 when API key is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-apiv1c-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    process.env.PRINT_PARTNER_API_KEY = "test-secret-key";

    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const app = await buildApp(config, ports);

    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/plans",
      remoteAddress: "203.0.113.10",
    });
    expect(denied.statusCode).toBe(401);

    const ok = await app.inject({
      method: "GET",
      url: "/api/v1/plans",
      headers: { authorization: "Bearer test-secret-key" },
    });
    expect(ok.statusCode).toBe(200);

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.PRINT_PARTNER_API_KEY;
  });
});

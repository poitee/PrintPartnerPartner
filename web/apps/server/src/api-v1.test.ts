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

    const denied = await app.inject({ method: "GET", url: "/api/v1/plans" });
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

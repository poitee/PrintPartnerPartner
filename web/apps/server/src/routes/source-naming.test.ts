import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createSelfHostPorts } from "../adapters/self-host/index.js";

describe("Source naming routes", () => {
  afterEach(() => {
    delete process.env.PRINT_PARTNER_DATA_DIR;
  });

  it("persists a validated Source override without replacing unrelated metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-source-naming-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const repo = ports.repository!;
    const source = repo.createSource({
      name: "Named",
      source_kind: "local",
      metadata: { category: "Voron" },
    });
    const app = await buildApp(loadConfig(), ports);
    const profile = repo.getGlobalNaming();
    const override = {
      ...profile,
      quantity: { ...profile.quantity, default: 2 },
    };

    const put = await app.inject({
      method: "PUT",
      url: `/sources/${source.id}/naming`,
      payload: { use_defaults: false, override },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      use_defaults: false,
      override,
      effective: override,
    });
    expect(repo.getSource(source.id)?.metadata).toMatchObject({ category: "Voron" });

    const get = await app.inject({ method: "GET", url: `/sources/${source.id}/naming` });
    expect(get.json()).toEqual(put.json());

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects malformed naming without changing the Source", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-source-naming-invalid-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const repo = ports.repository!;
    const source = repo.createSource({ name: "Invalid", source_kind: "local" });
    const before = repo.getSource(source.id)?.metadata;
    const app = await buildApp(loadConfig(), ports);

    const put = await app.inject({
      method: "PUT",
      url: `/sources/${source.id}/naming`,
      payload: { use_defaults: false, override: { quantity: {} } },
    });

    expect(put.statusCode).toBe(400);
    expect(repo.getSource(source.id)?.metadata).toEqual(before);

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

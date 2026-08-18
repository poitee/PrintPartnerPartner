import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../app.js";
import { createSelfHostPorts } from "../adapters/self-host/index.js";
import { loadConfig } from "../config.js";

async function makeApp(dir: string) {
  const config = {
    ...loadConfig(),
    dataDir: dir,
    integrationApiKey: "bootstrap-api-key",
  };
  const ports = createSelfHostPorts(dir);
  await ports.db.connect();
  const app = await buildApp(config, ports);
  return { app, ports };
}

describe("/api/v1 API key authentication", () => {
  it("does not trust a client-supplied Sec-Fetch-Site header", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-api-key-header-"));
    const { app, ports } = await makeApp(dir);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/plans",
        headers: { "sec-fetch-site": "same-origin" },
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
      ports.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a settings-created key until it is revoked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-api-key-revoke-"));
    const { app, ports } = await makeApp(dir);

    try {
      const created = await app.inject({
        method: "POST",
        url: "/settings/api-keys",
      });
      expect(created.statusCode).toBe(201);
      const { id, key } = created.json() as { id: string; key: string };

      const accepted = await app.inject({
        method: "GET",
        url: "/api/v1/plans",
        headers: { authorization: `Bearer ${key}` },
      });
      expect(accepted.statusCode).toBe(200);

      const revoked = await app.inject({
        method: "DELETE",
        url: `/settings/api-keys/${id}`,
      });
      expect(revoked.statusCode).toBe(200);

      const rejected = await app.inject({
        method: "GET",
        url: "/api/v1/plans",
        headers: { authorization: `Bearer ${key}` },
      });
      expect(rejected.statusCode).toBe(401);
    } finally {
      await app.close();
      ports.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

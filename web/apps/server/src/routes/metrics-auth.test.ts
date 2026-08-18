import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../app.js";
import { createSelfHostPorts } from "../adapters/self-host/index.js";
import { loadConfig } from "../config.js";

describe("metrics authentication", () => {
  it("rejects an invalid bearer credential", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-metrics-auth-"));
    const config = {
      ...loadConfig(),
      dataDir: dir,
      integrationApiKey: "valid-metrics-key",
    };
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const app = await buildApp(config, ports);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/metrics",
        headers: { authorization: "Bearer garbage" },
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
      ports.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

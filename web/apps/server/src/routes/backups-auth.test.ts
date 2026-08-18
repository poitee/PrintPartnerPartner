import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../app.js";
import { createSelfHostPorts } from "../adapters/self-host/index.js";
import { loadConfig } from "../config.js";

describe("administrative route authentication", () => {
  it("rejects unauthenticated non-loopback requests with one policy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-admin-auth-"));
    const config = { ...loadConfig(), dataDir: dir };
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const app = await buildApp(config, ports);

    try {
      const requests = [
        { method: "GET" as const, url: "/backups" },
        { method: "GET" as const, url: "/settings/api-keys" },
        { method: "GET" as const, url: "/settings/logging/config" },
        { method: "DELETE" as const, url: "/api/v1/webhooks/missing" },
        {
          method: "POST" as const,
          url: "/admin/import-kit-bundle",
          payload: {},
        },
      ];

      for (const request of requests) {
        const response = await app.inject({
          ...request,
          remoteAddress: "203.0.113.10",
        });
        expect.soft(response.statusCode, `${request.method} ${request.url}`).toBe(401);
      }
    } finally {
      await app.close();
      ports.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

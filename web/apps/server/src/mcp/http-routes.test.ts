/**
 * HTTP MCP smoke: route registers under /api/v1 and rejects unauthenticated calls
 * when PRINT_PARTNER_API_KEY is set.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, createPorts } from "../app.js";
import { loadConfig } from "../config.js";

describe("HTTP MCP /api/v1/mcp", () => {
  let dataDir: string;
  let prevKey: string | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "pp-mcp-http-"));
    prevKey = process.env.PRINT_PARTNER_API_KEY;
    process.env.PRINT_PARTNER_API_KEY = "test-mcp-key";
    process.env.PRINT_PARTNER_DATA_DIR = dataDir;
    process.env.DEPLOY_MODE = "self-host";
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.PRINT_PARTNER_API_KEY;
    else process.env.PRINT_PARTNER_API_KEY = prevKey;
    delete process.env.PRINT_PARTNER_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("requires API key and answers initialize with tools list capability", async () => {
    const config = loadConfig();
    const ports = createPorts(config);
    await ports.db.connect();
    const app = await buildApp(config, ports);

    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/mcp",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
      },
    });
    expect(denied.statusCode).toBe(401);

    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer test-mcp-key",
      },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
      },
    });
    expect(ok.statusCode).toBe(200);
    const text = ok.body;
    expect(text).toMatch(/print-partner-assistant|tools/i);

    await app.close();
    await ports.db.close();
  });
});

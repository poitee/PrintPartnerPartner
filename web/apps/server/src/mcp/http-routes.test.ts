/**
 * HTTP MCP smoke: fail-closed auth, session init, env restore.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, createPorts } from "../app.js";
import { loadConfig } from "../config.js";
import { isLoopbackBindHost } from "./product-mcp.js";

describe("HTTP MCP /api/v1/mcp", () => {
  let dataDir: string;
  let prevKey: string | undefined;
  let prevDataDir: string | undefined;
  let prevDeployMode: string | undefined;
  let prevHost: string | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "pp-mcp-http-"));
    prevKey = process.env.PRINT_PARTNER_API_KEY;
    prevDataDir = process.env.PRINT_PARTNER_DATA_DIR;
    prevDeployMode = process.env.DEPLOY_MODE;
    prevHost = process.env.HOST;
    process.env.PRINT_PARTNER_API_KEY = "test-mcp-key";
    process.env.PRINT_PARTNER_DATA_DIR = dataDir;
    process.env.DEPLOY_MODE = "self-host";
    process.env.HOST = "127.0.0.1";
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.PRINT_PARTNER_API_KEY;
    else process.env.PRINT_PARTNER_API_KEY = prevKey;
    if (prevDataDir === undefined) delete process.env.PRINT_PARTNER_DATA_DIR;
    else process.env.PRINT_PARTNER_DATA_DIR = prevDataDir;
    if (prevDeployMode === undefined) delete process.env.DEPLOY_MODE;
    else process.env.DEPLOY_MODE = prevDeployMode;
    if (prevHost === undefined) delete process.env.HOST;
    else process.env.HOST = prevHost;
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
    const sessionId = ok.headers["mcp-session-id"];
    expect(typeof sessionId === "string" && sessionId.length > 0).toBe(true);

    await app.close();
    await ports.db.close();
  });

  it("fails closed without API key when HOST is not loopback", async () => {
    delete process.env.PRINT_PARTNER_API_KEY;
    process.env.HOST = "0.0.0.0";
    const config = loadConfig();
    expect(config.integrationApiKey).toBeNull();
    expect(isLoopbackBindHost(config.host)).toBe(false);

    const ports = createPorts(config);
    await ports.db.connect();
    const app = await buildApp(config, ports);

    const res = await app.inject({
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
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.json())).toMatch(/PRINT_PARTNER_API_KEY/i);

    await app.close();
    await ports.db.close();
  });
});

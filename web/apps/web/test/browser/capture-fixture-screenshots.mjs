#!/usr/bin/env node
/**
 * Seed the representative WorkflowFixture, then recapture README screenshots.
 *
 * Usage (from this package):
 *   node test/browser/capture-fixture-screenshots.mjs
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";
import { seedWorkflowFixture } from "./workflowFixture.mjs";

const fetchFn = globalThis.fetch;
const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const serverRoot = fileURLToPath(new URL("../../../server", import.meta.url));
const tsxBin = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../..", import.meta.url));
const captureScript = join(repoRoot, "docs/scripts/capture-screenshots.mjs");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForHealth(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetchFn(url);
      if (response.ok) {
        const body = await response.json();
        if (body?.ok) return;
        lastError = JSON.stringify(body);
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(200);
  }
  throw new Error(`API was not healthy at ${url}: ${lastError}`);
}

function runCapture(theme, profileId, baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        captureScript,
        "--url",
        baseUrl.replace(/\/$/, ""),
        "--theme",
        theme,
        "--profile-id",
        String(profileId),
      ],
      { stdio: "inherit", env: process.env },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`capture ${theme} exited ${code}`));
    });
  });
}

const apiPort = await freePort();
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const dataDir = mkdtempSync(join(tmpdir(), "pp-workflow-fixture-shots-"));
const api = spawn(tsxBin, ["src/index.ts"], {
  cwd: serverRoot,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    PRINT_PARTNER_DATA_DIR: dataDir,
    PRINT_PARTNER_UPDATE_CHECK: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let apiLogs = "";
api.stdout?.on("data", (chunk) => {
  apiLogs += chunk.toString();
});
api.stderr?.on("data", (chunk) => {
  apiLogs += chunk.toString();
});

process.env.VITE_DEV_API_TARGET = apiOrigin;

let vite;
try {
  await waitForHealth(`${apiOrigin}/health`);
  const fixture = await seedWorkflowFixture(apiOrigin);
  process.stdout.write(
    `seeded fixture plan=${fixture.planId} parts=${fixture.partCount} files=${fixture.filenames.join(",")}\n`,
  );

  vite = await createServer({
    root: webRoot,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  await vite.listen();
  const baseUrl = vite.resolvedUrls?.local[0];
  if (!baseUrl) throw new Error("Vite did not expose a local capture URL");

  await runCapture("light", fixture.planId, baseUrl);
  await runCapture("dark", fixture.planId, baseUrl);
} finally {
  await vite?.close();
  api.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => {
      api.once("exit", resolve);
    }),
    delay(3_000),
  ]);
  rmSync(dataDir, { recursive: true, force: true });
  if (api.exitCode && api.exitCode !== 0 && apiLogs.trim()) {
    process.stderr.write(apiLogs);
  }
}

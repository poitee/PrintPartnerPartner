import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { browserExecutable } from "./browserExecutable.mjs";

const fetchFn = globalThis.fetch;

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const serverRoot = fileURLToPath(new URL("../../../server", import.meta.url));
const tsxBin = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

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

const apiPort = await freePort();
const dataDir = mkdtempSync(join(tmpdir(), "pp-site-map-e2e-"));
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

process.env.VITE_DEV_API_TARGET = `http://127.0.0.1:${apiPort}`;

let vite;
let browser;
try {
  await waitForHealth(`http://127.0.0.1:${apiPort}/health`);

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
  assert.ok(baseUrl, "Vite did not expose a local test URL");

  browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript((pairs) => {
    for (const [key, value] of pairs) {
      globalThis.localStorage.setItem(key, value);
    }
  }, [
    ["print-partner.theme", "light"],
    ["print-partner.sidebar.ui.v1", "0"],
    ["print-partner.workflow.onboarding.v1", "1"],
  ]);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  await page.getByRole("heading", { name: "Builds", level: 1 }).waitFor({ timeout: 60_000 });
  await page.getByText("Name a Build to start.").waitFor({ timeout: 30_000 });
  await page.locator("main").getByRole("button", { name: "New Build" }).click();
  const createDialog = page.getByRole("dialog", { name: "New Build" });
  await createDialog.waitFor();
  const nameInput = createDialog.getByLabel("Build name");
  await nameInput.fill("Site map journey");
  const createBtn = createDialog.getByRole("button", { name: "Create" });
  const enabledDeadline = Date.now() + 5_000;
  while (!(await createBtn.isEnabled())) {
    if (Date.now() > enabledDeadline) {
      throw new Error("Create stayed disabled after naming the Build");
    }
    await delay(50);
  }
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/plans",
    { timeout: 15_000 },
  );
  await nameInput.press("Enter");
  const created = await posted;
  assert.equal(created.status(), 200, `POST /plans returned ${created.status()}`);
  try {
    await page.getByRole("heading", { name: "Sources", level: 1 }).waitFor({ timeout: 30_000 });
  } catch (error) {
    const dump = join("/tmp", "site-map-e2e-failure.png");
    await page.screenshot({ path: dump, fullPage: true });
    const heading = await page.locator("h1").first().textContent();
    throw new Error(
      `Did not reach Sources after New Build. url=${page.url()} h1=${heading} screenshot=${dump}`,
      { cause: error },
    );
  }
  assert.match(new URL(page.url()).pathname, /\/sources$/);

  const workflow = page.getByRole("navigation", { name: "Workflow stages" });
  await workflow.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("heading", { name: "Plan", level: 1 }).waitFor();
  await workflow.getByRole("link", { name: "Checkoff" }).click();
  await page.getByRole("heading", { name: "Checkoff", level: 1 }).waitFor();
  await workflow.getByRole("link", { name: "Production" }).click();
  await page.getByRole("heading", { name: "Production", level: 1 }).waitFor();
  assert.match(new URL(page.url()).pathname, /\/export$/);

  const utility = page.getByRole("navigation", { name: "Utility" });
  await utility.getByRole("link", { name: "Production" }).click();
  await page.getByRole("heading", { name: "Production", level: 1 }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/production");
  await utility.getByRole("link", { name: "Printers" }).click();
  await page.getByRole("heading", { name: "Printers", level: 1 }).waitFor();
  await utility.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Settings", level: 1 }).waitFor();
} finally {
  await browser?.close();
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

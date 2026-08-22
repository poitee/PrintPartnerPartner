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
import {
  FIXTURE_BUILD_NAME,
  FIXTURE_PRINTER_NAME,
  FIXTURE_SOURCE_NAME,
  seedWorkflowFixture,
} from "./workflowFixture.mjs";

async function dumpFailure(page, label, cause) {
  const dump = join("/tmp", "workflow-fixture-e2e-failure.png");
  await page.screenshot({ path: dump, fullPage: true }).catch(() => {});
  const heading = await page.locator("h1").first().textContent().catch(() => "");
  const main = (await page.locator("main").innerText().catch(() => "")).slice(0, 1500);
  throw new Error(
    `${label} url=${page.url()} h1=${heading} screenshot=${dump} main=${JSON.stringify(main)}`,
    { cause },
  );
}

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
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const dataDir = mkdtempSync(join(tmpdir(), "pp-workflow-fixture-e2e-"));
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
let browser;
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
  assert.ok(baseUrl, "Vite did not expose a local test URL");

  browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(
    (pairs) => {
      for (const [key, value] of pairs) {
        globalThis.localStorage.setItem(key, value);
      }
    },
    [
      ["print-partner.theme", "light"],
      ["print-partner.sidebar.ui.v1", "0"],
      ["print-partner.workflow.onboarding.v1", "1"],
    ],
  );
  await page.goto(new URL("/builds", baseUrl).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await page.getByRole("heading", { name: "Builds", level: 1 }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: `Open ${FIXTURE_BUILD_NAME}` }).click();
  try {
    await page.getByRole("heading", { name: "Plan", level: 1 }).waitFor({ timeout: 30_000 });
    // Plan's default grid strips ".stl" from the visible stem; qty controls keep the filename.
    await page.getByRole("button", { name: "Increase quantity for cube.stl" }).waitFor({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Increase quantity for lid.stl" }).waitFor({
      timeout: 15_000,
    });
  } catch (error) {
    await dumpFailure(page, "Plan did not show fixture units", error);
  }

  const workflow = page.getByRole("navigation", { name: "Workflow stages" });
  await workflow.getByRole("link", { name: "Checkoff" }).click();
  try {
    await page.getByRole("heading", { name: "Checkoff", level: 1 }).waitFor();
    await page.getByText("No parts yet").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
    await page.getByText("cube.stl", { exact: false }).first().waitFor({ timeout: 15_000 });
    await page.getByText("lid.stl", { exact: false }).first().waitFor({ timeout: 15_000 });
  } catch (error) {
    await dumpFailure(page, "Checkoff did not show fixture parts", error);
  }

  await workflow.getByRole("link", { name: "Production" }).click();
  try {
    await page.getByRole("heading", { name: "Production", level: 1 }).waitFor();
    await page.getByRole("heading", { name: "Prepare Plates", level: 2 }).waitFor();
    await page.getByRole("button", { name: "Arrange Plates" }).waitFor();
    await page.getByRole("button", { name: "Direct 3MF" }).waitFor();
  } catch (error) {
    await dumpFailure(page, "Production did not show plate and direct-export controls", error);
  }
  assert.match(new URL(page.url()).pathname, /\/export$/);

  const utility = page.getByRole("navigation", { name: "Utility" });
  await utility.getByRole("link", { name: "Printers" }).click();
  try {
    await page.getByRole("heading", { name: "Printers", level: 1 }).waitFor();
    await page.getByRole("heading", { name: FIXTURE_PRINTER_NAME }).first().waitFor();
  } catch (error) {
    await dumpFailure(page, "Printers did not show the fixture bed", error);
  }

  await page.goto(new URL("/library", baseUrl).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  try {
    await page.getByRole("heading", { name: "Library", level: 1 }).waitFor();
    await page.getByText(FIXTURE_SOURCE_NAME).first().waitFor();
  } catch (error) {
    await dumpFailure(page, "Library did not show the fixture kit", error);
  }

  assert.ok(fixture.planId > 0);
  assert.ok(fixture.partCount >= 2);
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

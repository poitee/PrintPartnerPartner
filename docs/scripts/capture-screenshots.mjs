#!/usr/bin/env node
/**
 * Capture Print Partner workflow screenshots (light or dark theme).
 *
 * Usage:
 *   node docs/scripts/capture-screenshots.mjs --theme light
 *   node docs/scripts/capture-screenshots.mjs --theme dark
 *   node docs/scripts/capture-screenshots.mjs --url http://localhost:8080 --theme light --out docs/screenshots/light
 *
 * Prerequisites: app running (e.g. docker compose up --build), Playwright browsers installed once via:
 *   npx playwright install chromium
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:8080" },
    theme: { type: "string", default: "light" },
    out: { type: "string" },
  },
});

const theme = values.theme === "dark" ? "dark" : "light";
const baseUrl = values.url.replace(/\/$/, "");
const outDir = resolve(
  values.out ?? join(repoRoot, "docs/screenshots", theme),
);

/** @type {{ label: string; file: string; waitMs?: number; ready?: (page: import('playwright').Page) => Promise<void> }[]} */
const captures = [
  {
    label: "Sources",
    file: "sources.png",
    ready: async (page) => {
      await page.getByRole("heading", { name: "Sources", level: 2 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
    },
  },
  {
    label: "Builds",
    file: "builds.png",
    ready: async (page) => {
      await page.getByRole("heading", { name: "Builds", level: 2 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
    },
  },
  {
    label: "Build",
    file: "build.png",
    ready: async (page) => {
      await page.getByRole("heading", { name: "Build", level: 2 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
    },
  },
  {
    label: "Review",
    file: "review.png",
    waitMs: 2000,
    ready: async (page) => {
      await page.getByRole("heading", { name: "Review", level: 2 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
      await page.locator(".preview3d-canvas canvas").first().waitFor({
        state: "attached",
        timeout: 30_000,
      }).catch(() => {});
    },
  },
  {
    label: "Checkoff",
    file: "checkoff.png",
    waitMs: 2000,
    ready: async (page) => {
      await page.getByRole("heading", { name: "Checkoff", level: 2 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
      await page.locator(".preview3d-canvas canvas").first().waitFor({
        state: "attached",
        timeout: 30_000,
      }).catch(() => {});
    },
  },
];

async function waitForApp(page) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await page.request.get(`${baseUrl}/health`);
      if (res.ok()) {
        const body = await res.json();
        if (body?.ok) return;
      }
    } catch {
      // retry
    }
    await page.waitForTimeout(2000);
  }
  throw new Error(`App not healthy at ${baseUrl}/health after 120s`);
}

async function clickSidebar(page, label) {
  const link = page.locator("aside nav").getByRole("link", { name: label, exact: true });
  await link.waitFor({ state: "visible", timeout: 30_000 });
  await link.click();
}

async function main() {
  const { chromium } = await import("playwright");

  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  await context.addInitScript((selectedTheme) => {
    localStorage.setItem("print-partner.theme", selectedTheme);
  }, theme);

  const page = await context.newPage();

  console.log(`Waiting for ${baseUrl}/health…`);
  await waitForApp(page);

  console.log(`Loading ${baseUrl}/ (${theme} theme)…`);
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});

  for (const shot of captures) {
    console.log(`Capturing ${shot.label} → ${shot.file}`);
    await clickSidebar(page, shot.label);
    await page.waitForURL(
      (url) => {
        const path = url.pathname.replace(/\/$/, "");
        const expected = shot.label.toLowerCase();
        return path === `/${expected}` || path.endsWith(`/${expected}`);
      },
      { timeout: 30_000 },
    );
    if (shot.ready) await shot.ready(page);
    if (shot.waitMs) await page.waitForTimeout(shot.waitMs);
    await page.screenshot({
      path: join(outDir, shot.file),
      fullPage: false,
    });
  }

  await browser.close();
  console.log(`Done — ${captures.length} screenshots in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Capture Print Partner workflow screenshots (light or dark theme).
 *
 * Usage:
 *   node docs/scripts/capture-screenshots.mjs --theme light
 *   node docs/scripts/capture-screenshots.mjs --theme dark
 *   node docs/scripts/capture-screenshots.mjs --url http://localhost:8080 --theme light --profile-id 1
 *
 * Prerequisites: app running (e.g. docker compose up --build), Playwright browsers installed once via:
 *   npx playwright install chromium
 */

import { mkdir } from "node:fs/promises";
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
    "profile-id": { type: "string" },
  },
});

const theme = values.theme === "dark" ? "dark" : "light";
const baseUrl = values.url.replace(/\/$/, "");
const profileId = values["profile-id"]?.trim() || null;
const outDir = resolve(
  values.out ?? join(repoRoot, "docs/screenshots", theme),
);

/**
 * @typedef {{
 *   label: string;
 *   path: string;
 *   file: string;
 *   nav?: "sidebar";
 *   waitMs?: number;
 *   ready?: (page: import('playwright').Page) => Promise<void>;
 * }} Capture
 */

/** @type {Capture[]} */
const captures = [
  {
    label: "Library",
    path: "/library",
    file: "sources.png",
    nav: "sidebar",
    ready: async (page) => {
      await page.getByRole("heading", { name: "Library", level: 1 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
    },
  },
  {
    label: "Builds",
    path: "/builds",
    file: "builds.png",
    nav: "sidebar",
    ready: async (page) => {
      await page.getByRole("heading", { name: "Builds", level: 1 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
    },
  },
  {
    label: "Sources",
    path: "/sources",
    file: "build.png",
    nav: "sidebar",
    ready: async (page) => {
      await page.getByRole("heading", { name: /Sources|Build Sources/i }).first().waitFor({
        state: "visible",
        timeout: 60_000,
      }).catch(async () => {
        await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });
      });
    },
  },
  {
    label: "Plan",
    path: "/plan",
    file: "review.png",
    nav: "sidebar",
    waitMs: 2500,
    ready: async (page) => {
      await page.getByRole("heading", { name: "Plan", level: 1 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
      await page
        .locator(".preview3d-canvas canvas")
        .first()
        .waitFor({
          state: "attached",
          timeout: 30_000,
        })
        .catch(() => {});
    },
  },
  {
    label: "Checkoff",
    path: "/progress",
    file: "progress.png",
    nav: "sidebar",
    waitMs: 1200,
    ready: async (page) => {
      await page.getByRole("heading", { name: /Checkoff|Progress/i, level: 1 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
    },
  },
  {
    label: "Production",
    path: "/export",
    file: "export.png",
    nav: "sidebar",
    waitMs: 1200,
    ready: async (page) => {
      await page.getByRole("heading", { name: /Production/i, level: 1 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
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

async function openClientPath(page, path) {
  await page.evaluate((next) => {
    const url = new URL(next, window.location.origin);
    window.history.pushState({}, "", `${url.pathname}${url.search}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

async function main() {
  const { chromium } = await import("playwright");

  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  await context.addInitScript(
    ({ selectedTheme, selectedProfileId }) => {
      localStorage.setItem("print-partner.theme", selectedTheme);
      localStorage.setItem("print-partner.sidebar.ui.v1", "0");
      localStorage.setItem("print-partner.workflow.onboarding.v1", "1");
      if (selectedProfileId) {
        sessionStorage.setItem("pp-selected-profile-id", selectedProfileId);
      }
    },
    { selectedTheme: theme, selectedProfileId: profileId },
  );

  const page = await context.newPage();

  console.log(`Waiting for ${baseUrl}/health…`);
  await waitForApp(page);

  const homeUrl = profileId
    ? `${baseUrl}/?profile=${encodeURIComponent(profileId)}`
    : `${baseUrl}/`;
  console.log(`Loading ${homeUrl} (${theme} theme)…`);
  await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});

  for (const shot of captures) {
    console.log(`Capturing ${shot.label} → ${shot.file}`);
    const target = profileId && shot.path !== "/library" && shot.path !== "/builds"
      ? `${shot.path}?profile=${encodeURIComponent(profileId)}`
      : shot.path;
    await openClientPath(page, target);
    await page.waitForURL(
      (url) => {
        const path = url.pathname.replace(/\/$/, "");
        const expected = shot.path.replace(/\/$/, "");
        return path === expected || path.endsWith(expected);
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
  console.log(`Done — screenshots in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Capture Print Partner workflow + AI screenshots (light or dark theme).
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
 *   nav?: "sidebar" | "settings" | "advisor";
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
      await page.getByRole("heading", { name: "Builds", level: 2 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
      await page
        .getByText("Active build", { exact: false })
        .first()
        .waitFor({
          state: "visible",
          timeout: 15_000,
        })
        .catch(() => {});
    },
  },
  {
    label: "Plan",
    path: "/plan",
    file: "build.png",
    nav: "sidebar",
    ready: async (page) => {
      await page.getByRole("heading", { name: "Plan", level: 2 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
      const manageBuilds = page
        .locator("details")
        .filter({ hasText: "Manage builds" })
        .first();
      if (await manageBuilds.count()) {
        const open = await manageBuilds.getAttribute("open");
        if (!open) {
          await manageBuilds.locator("summary").click();
        }
      }
      await page.getByText("Manage builds").first().waitFor({
        state: "visible",
        timeout: 15_000,
      });
    },
  },
  {
    label: "Parts",
    path: "/parts",
    file: "review.png",
    nav: "sidebar",
    waitMs: 2500,
    ready: async (page) => {
      await page.getByRole("heading", { name: "Parts", level: 2 }).waitFor({
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
    label: "Progress",
    path: "/progress",
    file: "progress.png",
    nav: "sidebar",
    waitMs: 1200,
    ready: async (page) => {
      await page.getByRole("heading", { name: "Progress", level: 2 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
    },
  },
  {
    label: "Settings AI",
    path: "/settings",
    file: "settings-ai.png",
    nav: "settings",
    waitMs: 800,
    ready: async (page) => {
      await page.getByRole("heading", { name: "Settings", level: 2 }).waitFor({
        state: "visible",
        timeout: 60_000,
      });
      const aiCard = page.getByText("AI assistant", { exact: true }).first();
      await aiCard.waitFor({ state: "visible", timeout: 30_000 });
      await aiCard.scrollIntoViewIfNeeded();
      // Prefer framing the AI card; fall back to full viewport if locator fails.
      const card = page
        .locator("div")
        .filter({ has: page.getByText("AI assistant", { exact: true }) })
        .filter({ hasText: "Kit advisor" })
        .first();
      if (await card.count()) {
        await card.scrollIntoViewIfNeeded();
      }
    },
  },
  {
    label: "Kit advisor",
    path: "/plan",
    file: "advisor.png",
    nav: "advisor",
    waitMs: 1200,
    ready: async (page) => {
      await page
        .getByRole("heading", { name: /Kit advisor/i })
        .waitFor({ state: "visible", timeout: 30_000 });
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
  // Use `aside` (not `aside nav`): workflow stages live in `<nav>`, but Builds /
  // Settings are sibling links outside that nav.
  const link = page
    .locator("aside")
    .getByRole("link", { name: label, exact: true });
  await link.waitFor({ state: "visible", timeout: 30_000 });
  await link.click();
}

async function openAdvisor(page) {
  const btn = page.getByRole("button", { name: /kit advisor|Advisor/i }).first();
  await btn.waitFor({ state: "visible", timeout: 30_000 });
  const pressed = await btn.getAttribute("aria-pressed");
  if (pressed !== "true") {
    await btn.click();
  }
  await page
    .getByRole("heading", { name: /Kit advisor/i })
    .waitFor({ state: "visible", timeout: 30_000 });
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

  const health = await page.request.get(`${baseUrl}/health`).then((r) => r.json());
  const aiCapable = Array.isArray(health?.capabilities)
    ? health.capabilities.includes("ai_assistant")
    : false;

  const homeUrl = profileId
    ? `${baseUrl}/?profile=${encodeURIComponent(profileId)}`
    : `${baseUrl}/`;
  console.log(`Loading ${homeUrl} (${theme} theme)…`);
  await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});

  for (const shot of captures) {
    if (
      (shot.nav === "advisor" || shot.nav === "settings") &&
      !aiCapable &&
      shot.nav === "advisor"
    ) {
      console.warn(
        `Skipping ${shot.label} — health.capabilities lacks ai_assistant (enable AI in Settings or env)`,
      );
      continue;
    }

    console.log(`Capturing ${shot.label} → ${shot.file}`);

    if (shot.nav === "settings") {
      await clickSidebar(page, "Settings");
      await page.waitForURL(
        (url) => url.pathname.replace(/\/$/, "").endsWith("/settings"),
        { timeout: 30_000 },
      );
    } else if (shot.nav === "advisor") {
      // Ensure we are on a workflow page so the sheet docks beside content.
      await clickSidebar(page, "Plan").catch(() => clickSidebar(page, "Library"));
      await openAdvisor(page);
    } else {
      await clickSidebar(page, shot.label);
      await page.waitForURL(
        (url) => {
          const path = url.pathname.replace(/\/$/, "");
          const expected = shot.path.replace(/\/$/, "");
          return path === expected || path.endsWith(expected);
        },
        { timeout: 30_000 },
      );
    }

    if (shot.ready) await shot.ready(page);
    if (shot.waitMs) await page.waitForTimeout(shot.waitMs);

    if (shot.file === "settings-ai.png") {
      const aiCard = page.locator("#ai-assistant");
      await aiCard.waitFor({ state: "visible", timeout: 30_000 });
      await aiCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await aiCard.screenshot({ path: join(outDir, shot.file) });
    } else {
      await page.screenshot({
        path: join(outDir, shot.file),
        fullPage: false,
      });
    }
  }

  await browser.close();
  console.log(`Done — screenshots in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

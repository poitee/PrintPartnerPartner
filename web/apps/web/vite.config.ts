import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { IncomingMessage } from "node:http";
import path from "node:path";

const API_TARGET = process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:18765";

/** Backend route prefixes proxied to the Fastify server during `npm run dev`. */
const API_PREFIXES = [
  "api/v1",
  "health",
  "plans",
  "sources",
  "jobs",
  "parts",
  "printers",
  "printer-presets",
  "slicer-instances",
  "slicer-handoff",
  "settings",
  "filaments",
  "integrations",
  "printer-checkoff",
  "printer-outcomes",
  "printer-send-queue",
  "bambu-connect",
  "legal",
  "help",
  "auth",
  "shares",
  "kit-catalog",
  "manifest-registry",
  "manifest-templates",
  "community",
  "imports",
  "ws",
];

/**
 * SPA routes that share a prefix with API routes (`/settings` vs `/settings/*`).
 * Exact document navigations must not be proxied — there is no GET API at these paths.
 */
const SPA_EXACT_PATHS = new Set(["/settings", "/help", "/parts"]);

/**
 * Exact SPA paths that also expose a same-path API (GET `/plans` list).
 * Bypass only browser document navigations so API fetches still proxy.
 */
const SPA_EXACT_PATHS_WITH_API = new Set(["/plans"]);

function isDocumentNavigation(req: IncomingMessage): boolean {
  const mode = req.headers["sec-fetch-mode"];
  if (mode === "navigate") return true;
  const accept = String(req.headers.accept ?? "");
  return accept.includes("text/html") && !accept.includes("application/json");
}

function spaExactBypass(req: IncomingMessage): string | undefined {
  const raw = req.url ?? "";
  let pathname = raw.split("?", 1)[0] ?? "";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  if (SPA_EXACT_PATHS.has(pathname)) return raw;
  if (SPA_EXACT_PATHS_WITH_API.has(pathname) && isDocumentNavigation(req)) return raw;
  return undefined;
}

const proxy: Record<string, ProxyOptions> = Object.fromEntries(
  API_PREFIXES.map((prefix) => {
    const options: ProxyOptions = {
      target: API_TARGET,
      changeOrigin: true,
      ws: prefix === "ws" || prefix === "jobs",
    };
    const exact = `/${prefix}`;
    if (SPA_EXACT_PATHS.has(exact) || SPA_EXACT_PATHS_WITH_API.has(exact)) {
      options.bypass = spaExactBypass;
    }
    return [`/${prefix}`, options];
  }),
);

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy,
  },
  envPrefix: ["VITE_"],
  build: {
    target: "es2022",
    outDir: "dist",
  },
});

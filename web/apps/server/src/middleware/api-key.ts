import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ServerConfig } from "../config.js";
import { sendProblem } from "../lib/api-error.js";

const EXEMPT_PREFIXES = [
  "/api/v1/openapi.json",
  "/api/v1/docs",
  "/openapi.json",
];

function isExempt(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  if (path === "/health" || path === "/api/v1") return true;
  if (EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return true;
  }
  // SPA static assets (extension paths) and root HTML
  if (path === "/" || path.includes(".")) return true;
  return false;
}

function extractApiKey(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() || null;
  }
  const custom = request.headers["x-print-partner-api-key"];
  if (typeof custom === "string" && custom.trim()) return custom.trim();
  return null;
}

/**
 * True when the request looks like it came from the SPA itself (same-origin browser fetch).
 * Same-origin requests have no Origin header, or an Origin that matches the Host.
 * External API callers (MCP, slicers, scripts) always send an Origin that differs from Host,
 * or no Origin but also no Referer/Sec-Fetch-Site that would indicate browser navigation.
 */
function isSameOriginBrowser(request: FastifyRequest): boolean {
  // Browsers set Sec-Fetch-Site on all fetches. "same-origin" means SPA → own server.
  const secFetchSite = request.headers["sec-fetch-site"];
  if (secFetchSite === "same-origin" || secFetchSite === "same-site") return true;

  // Fallback: no Origin header + has Referer on same host = SPA navigation.
  const origin = request.headers.origin;
  if (!origin) {
    const referer = request.headers.referer;
    if (referer) {
      try {
        const host = request.headers.host ?? "";
        const refHost = new URL(referer).host;
        if (refHost === host) return true;
      } catch {
        /* ignore parse errors */
      }
    }
    // No Origin and no Referer: likely a CLI/script call, not the SPA.
    return false;
  }

  // Origin present: check it matches the server's Host.
  try {
    const host = request.headers.host ?? "";
    const originHost = new URL(origin).host;
    if (originHost === host) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Require API key on /api/v1/* when PRINT_PARTNER_API_KEY is configured (self-host).
 *  Same-origin browser requests (the SPA itself) are always exempt — the key is for
 *  external integrations (MCP, slicers, scripts) only. */
export function registerApiKeyAuth(app: FastifyInstance, config: ServerConfig): void {
  if (!config.integrationApiKey) return;

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/v1")) return;
    if (isExempt(path)) return;
    // The SPA itself is always allowed — the key guards external callers only.
    if (isSameOriginBrowser(request)) return;

    const provided = extractApiKey(request);
    if (!provided || provided !== config.integrationApiKey) {
      return sendProblem(reply, 401, "Unauthorized", "Valid API key required");
    }
  });
}

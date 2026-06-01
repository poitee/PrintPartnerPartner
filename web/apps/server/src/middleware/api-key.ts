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

/** Require API key on /api/v1/* when PRINT_PARTNER_API_KEY is configured (self-host). */
export function registerApiKeyAuth(app: FastifyInstance, config: ServerConfig): void {
  if (!config.integrationApiKey) return;

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/v1")) return;
    if (isExempt(path)) return;

    const provided = extractApiKey(request);
    if (!provided || provided !== config.integrationApiKey) {
      return sendProblem(reply, 401, "Unauthorized", "Valid API key required");
    }
  });
}

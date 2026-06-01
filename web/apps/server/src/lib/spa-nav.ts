import type { FastifyRequest } from "fastify";

/** Client-side routes from the React app (BrowserRouter). */
const SPA_PATHS = new Set([
  "/",
  "/sources",
  "/build",
  "/review",
  "/checkoff",
  "/settings",
  "/help",
  "/plan",
  "/plate",
  "/print",
]);

function requestPathname(url: string): string {
  const path = url.split("?", 1)[0] ?? url;
  return path.split("#", 1)[0] ?? path;
}

/** True when the request is a browser page load (not an API fetch). */
export function isBrowserDocumentNavigation(request: FastifyRequest): boolean {
  if (request.method !== "GET") return false;
  const mode = request.headers["sec-fetch-mode"];
  if (mode === "navigate") return true;
  const accept = request.headers.accept ?? "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

export function isSpaClientPath(url: string): boolean {
  const path = requestPathname(url);
  if (SPA_PATHS.has(path)) return true;
  return /^\/plans\/\d+\/studio$/.test(path);
}

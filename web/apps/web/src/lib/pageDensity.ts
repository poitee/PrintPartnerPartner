/** Calm workspace vs denser Production layout. Same tokens, different spacing. */

export type PageDensity = "calm" | "dense";

const DENSE_PATHS = new Set(["/production", "/export", "/printers"]);

export function pageDensityFromPath(pathname: string): PageDensity {
  const path = (pathname.split("?")[0] ?? pathname).replace(/\/+$/, "") || "/";
  return DENSE_PATHS.has(path) ? "dense" : "calm";
}

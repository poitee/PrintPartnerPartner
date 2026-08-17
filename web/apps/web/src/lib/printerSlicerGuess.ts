/**
 * Best-effort client-side guess at which slicer a printer maps to, purely
 * for display (a small badge next to each printer option in the manual
 * assignment picker). Mirrors the *name* fallback half of the server's
 * selectSlicerForPrinter (apps/server/src/services/slicer-routing.ts) — the
 * integration-type half needs a fetched integration record the plate
 * workspace response doesn't carry, so this only handles the common case.
 * The server is always the source of truth for which slicer an auto-slice
 * job actually uses.
 */
import type { SlicerKind } from "./slicerLinks";

export function guessSlicerForPrinterName(name: string | null | undefined): SlicerKind {
  const lower = (name ?? "").toLowerCase();
  if (lower.includes("bambu") || /\b[xpah]1\b/.test(lower)) return "bambu";
  if (lower.includes("prusa") || /\bmk[234]\b/.test(lower) || /\bxl\b/.test(lower)) return "prusa";
  return "orca";
}

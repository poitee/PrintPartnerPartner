import { toast } from "sonner";
import type { JobSnapshot } from "../api/engine";

function warningsFromResult(result: Record<string, unknown> | null | undefined): string[] {
  if (!Array.isArray(result?.warnings)) return [];
  return result.warnings.filter((w): w is string => typeof w === "string");
}

/**
 * Handle a pack-preview job's completion — surfaces plate-packing warnings
 * (including the height-variance warning from checkPlateHeightVariance in
 * plate-packer.ts: "Plate N on <printer>: height variance ... exceeds 2×
 * the shortest part ...") as a toast, mirroring the warnings-array-to-toast
 * pattern used by handleExport3mfJobDone / handleStlPackExportJobDone.
 *
 * The height-variance check runs for every grouping strategy (Location or
 * Height Band), so this toast can fire regardless of which strategy is active.
 */
export function handlePackPreviewJobDone(snap: JobSnapshot): void {
  if (snap.status === "error") {
    toast.error(snap.message || "Pack preview failed");
    return;
  }

  const warnings = warningsFromResult(snap.result);
  if (warnings.length === 0) return;

  const preview = warnings.slice(0, 3).join("\n");
  const more = warnings.length > 3 ? `\n…and ${warnings.length - 3} more` : "";
  toast.warning(`Pack preview: ${warnings.length} warning(s)`, {
    description: preview + more,
    duration: 12_000,
  });
}

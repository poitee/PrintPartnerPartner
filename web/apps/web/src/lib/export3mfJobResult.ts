import { toast } from "sonner";
import type { JobSnapshot } from "../api/engine";
import { completeMultiFileExportDownload } from "./exportActions";

function warningsFromResult(result: Record<string, unknown> | null | undefined): string[] {
  if (!Array.isArray(result?.warnings)) return [];
  return result.warnings.filter((w): w is string => typeof w === "string");
}

/** Handle 3MF export job completion — multi-file download and warning surfacing. */
export function handleExport3mfJobDone(title: string, snap: JobSnapshot): void {
  if (snap.status === "error") {
    toast.error(snap.message || `${title} failed`);
    return;
  }

  const result = snap.result;
  const objectCount = typeof result?.object_count === "number" ? result.object_count : undefined;
  const warnings = warningsFromResult(result);

  if (objectCount === 0) {
    toast.error(warnings[0] ?? snap.message ?? "No 3MF files exported", {
      description:
        "Add printers in Settings, sync Sources, and fix Review blockers, then try again.",
      duration: 12_000,
    });
    return;
  }

  completeMultiFileExportDownload(title, result);

  if (warnings.length > 0) {
    const preview = warnings.slice(0, 3).join("\n");
    const more = warnings.length > 3 ? `\n…and ${warnings.length - 3} more` : "";
    toast.warning(`${title}: ${warnings.length} warning(s)`, {
      description: preview + more,
      duration: 12_000,
    });
  }
}

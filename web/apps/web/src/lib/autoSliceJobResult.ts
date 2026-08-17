import { toast } from "sonner";
import type { AutoSliceJobResultBody, AutoSlicePlate, JobSnapshot } from "../api/engine";

const SLICER_LABELS: Record<AutoSlicePlate["slicer"], string> = {
  orca: "OrcaSlicer",
  prusa: "PrusaSlicer",
  bambu: "BambuStudio",
};

export function slicerLabel(slicer: string): string {
  return SLICER_LABELS[slicer as AutoSlicePlate["slicer"]] ?? slicer;
}

/** Read the auto-slice result body off a job snapshot, or null if absent/malformed. */
export function autoSliceResultOf(snap: JobSnapshot): AutoSliceJobResultBody | null {
  const r = snap.result as unknown;
  if (!r || typeof r !== "object") return null;
  const body = r as Partial<AutoSliceJobResultBody>;
  if (!Array.isArray(body.plates)) return null;
  return body as AutoSliceJobResultBody;
}

/** "2 on OrcaSlicer, 1 on PrusaSlicer" — shows the routing actually taken. */
export function describeRouting(plates: AutoSlicePlate[]): string {
  const counts = new Map<string, number>();
  for (const p of plates) counts.set(p.slicer, (counts.get(p.slicer) ?? 0) + 1);
  return [...counts.entries()]
    .map(([slicer, n]) => `${n} on ${slicerLabel(slicer)}`)
    .join(", ");
}

/**
 * First few plate failures, one per line, for a toast description.
 *
 * A `slicer_execution_failed` plate carries the slicer CLI's own stderr — that
 * is the only place the real cause is stated ("unknown config option …",
 * "invalid printable_area …"), so its tail is appended under the plate line
 * rather than being dropped in favour of the generic "exited with code 1".
 */
export function describeFailures(plates: AutoSlicePlate[], limit = 3): string {
  const failed = plates.filter((p) => p.status === "error");
  const lines = failed.slice(0, limit).map((p) => {
    const head = `Plate ${p.plate_index} (${p.printer_name}, ${slicerLabel(p.slicer)}): ${p.error ?? "unknown error"}`;
    const tail = stderrTail(p.stderr);
    return tail ? `${head}\n${tail}` : head;
  });
  if (failed.length > limit) lines.push(`…and ${failed.length - limit} more`);
  return lines.join("\n");
}

/** Last few non-blank lines of a slicer stderr blob — enough to name the cause. */
export function stderrTail(stderr: string | null | undefined, maxLines = 3): string | null {
  if (!stderr) return null;
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (!lines.length) return null;
  return lines.slice(-maxLines).join("\n");
}

/**
 * Surface auto-slice outcome in the UI: hard job error, all-plates-failed,
 * partial success, and clean success are each distinct states so the user can
 * tell "nothing sliced" from "one printer's sidecar is down".
 */
export function handleAutoSliceJobDone(title: string, snap: JobSnapshot): void {
  if (snap.status === "error") {
    toast.error(snap.message || `${title} failed`, { duration: 12_000 });
    return;
  }

  const result = autoSliceResultOf(snap);
  if (!result) {
    toast.error(`${title}: no result returned`, { duration: 12_000 });
    return;
  }

  const { plates, warnings, plate_count: sliced, attempted_count: attempted, failed_count: failed } = result;

  if (attempted === 0) {
    toast.error(warnings[0] ?? "No plates were exported to slice", {
      description:
        "Add printers in Settings, make sure the plan has included parts, then try again.",
      duration: 12_000,
    });
    return;
  }

  if (sliced === 0) {
    toast.error(`${title}: all ${attempted} plate(s) failed`, {
      description: describeFailures(plates),
      duration: 15_000,
    });
    return;
  }

  const routing = describeRouting(plates.filter((p) => p.status === "ok"));
  if (failed > 0) {
    toast.warning(`${title}: ${sliced} of ${attempted} plate(s) sliced`, {
      description: `${routing}\n\n${describeFailures(plates)}`,
      duration: 15_000,
    });
    return;
  }

  toast.success(`${title}: ${sliced} plate(s) sliced`, {
    description: warnings.length
      ? `${routing}\n${warnings.length} warning(s): ${warnings[0]}`
      : `${routing}. G-code and thumbnails saved to the plan's export folder.`,
    duration: 12_000,
  });
}

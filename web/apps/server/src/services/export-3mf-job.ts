import {
  exportProfile3mf,
  exportProfile3mfWithLayout,
  mergePartsToCopies,
  resolveLayoutToPlates,
  unprintedCopies,
  type ExportLayoutMode,
  type MergePartExport,
} from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";
import { loadFleet } from "./printer-fleet.js";
import { loadKitPrintPlan } from "./print-plan-store.js";

export function runExport3mfJob(
  repo: AppRepository,
  profileId: number,
  exportsDir: string,
  options: {
    layout_mode?: string;
    spacing_mm?: number;
    missing_only?: boolean;
    enabled_printer_ids?: string[];
  },
) {
  const { name, parts, completedByMatchKey } = repo.buildMergePartsForProfile(profileId);
  const plan = loadKitPrintPlan(repo, profileId);
  const fleet = loadFleet(repo);
  const ids =
    options.enabled_printer_ids != null
      ? options.enabled_printer_ids
      : plan.enabled_printer_ids;
  const enabled = fleet.filter((m) => (ids ?? []).includes(m.id));
  if (!enabled.length) {
    throw new Error("No printers enabled");
  }

  const mergeParts = parts as MergePartExport[];
  let copies = mergePartsToCopies(mergeParts);
  if (options.missing_only) {
    copies = unprintedCopies(mergeParts, completedByMatchKey, (p) => p != null && p.length > 0);
  }

  const layoutMode = (options.layout_mode ?? "per_plate") as ExportLayoutMode;
  const plateLayout = plan.plate_layout;

  if (plateLayout && copies.length) {
    const [plateLayouts] = resolveLayoutToPlates(plateLayout, enabled, copies);
    return exportProfile3mf(name, mergeParts, exportsDir, {
      layout_mode: layoutMode,
      spacing_mm: options.spacing_mm ?? plateLayout.spacing_mm,
      missing_only: options.missing_only,
      completed_by_match_key: options.missing_only ? completedByMatchKey : null,
      enabled_printers: enabled,
      plate_layouts: plateLayouts,
    });
  }

  return exportProfile3mfWithLayout(name, mergeParts, exportsDir, enabled, copies, null, {
    layout_mode: layoutMode,
    spacing_mm: options.spacing_mm ?? 4,
    missing_only: options.missing_only,
    completed_by_match_key: options.missing_only ? completedByMatchKey : null,
  });
}

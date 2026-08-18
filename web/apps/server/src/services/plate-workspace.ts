import {
  autoPlateLayout,
  buildPrintGroupRows,
  makeGroupKey,
  mergePartsToCopies,
  packCopiesGrouped,
  partFilamentKey,
  assignPartsToPrinters,
  resolveEnabledPrinters,
  repoNameFromSourceLayer,
  folderKeyFromRelativePath,
  type GroupingStrategy,
  type MergePartExport,
  type PrinterMachine,
} from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";
import { loadFleet } from "./printer-fleet.js";
import { loadKitPrintPlan } from "./print-plan-store.js";

function groupKeyForCopy(copy: { part: MergePartExport; unit: number }): string {
  const part = copy.part;
  return makeGroupKey(
    partFilamentKey(part),
    repoNameFromSourceLayer(part.sourceLayer),
    folderKeyFromRelativePath(part.relativePath),
  );
}

function autoAssignGroups(
  copies: ReturnType<typeof mergePartsToCopies>,
  enabled: PrinterMachine[],
): Record<string, string> {
  const [byPrinter] = assignPartsToPrinters(copies, enabled);
  const assignments: Record<string, string> = {};
  for (const [printerId, pcopies] of Object.entries(byPrinter)) {
    for (const copy of pcopies) {
      assignments[groupKeyForCopy(copy)] = printerId;
    }
  }
  return assignments;
}

function assignmentsOnEnabled(
  assignments: Record<string, string>,
  enabledIds: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, printerId] of Object.entries(assignments)) {
    if (enabledIds.has(printerId)) out[key] = printerId;
  }
  return out;
}

function copiesForAssignments(
  copies: ReturnType<typeof mergePartsToCopies>,
  assignments: Record<string, string>,
  enabled: PrinterMachine[],
): Record<string, ReturnType<typeof mergePartsToCopies>> {
  const byPrinter: Record<string, ReturnType<typeof mergePartsToCopies>> = {};
  for (const p of enabled) byPrinter[p.id] = [];
  for (const copy of copies) {
    const printerId = assignments[groupKeyForCopy(copy)];
    if (printerId && byPrinter[printerId]) byPrinter[printerId].push(copy);
  }
  return byPrinter;
}

function placedItemDict(
  item: {
    copy: { part: MergePartExport; unit: number };
    x_mm: number;
    y_mm: number;
    width_mm: number;
    depth_mm: number;
    height_mm: number;
    heightBand?: string;
  },
  groupKey?: string,
) {
  const copy = item.copy;
  const out: Record<string, unknown> = {
    match_key: copy.part.matchKey,
    unit: copy.unit,
    filename: copy.part.filename,
    x_mm: Math.round(item.x_mm * 100) / 100,
    y_mm: Math.round(item.y_mm * 100) / 100,
    width_mm: Math.round(item.width_mm * 100) / 100,
    depth_mm: Math.round(item.depth_mm * 100) / 100,
    height_mm: Math.round(item.height_mm * 100) / 100,
  };
  if (groupKey) out.group_key = groupKey;
  if (item.heightBand) out.height_band = item.heightBand;
  return out;
}

function plateLayoutDict(plate: {
  index: number;
  group_label: string;
  items: Array<{
    copy: { part: MergePartExport; unit: number };
    x_mm: number;
    y_mm: number;
    width_mm: number;
    depth_mm: number;
    height_mm: number;
    heightBand?: string;
  }>;
}) {
  return {
    index: plate.index,
    group_label: plate.group_label,
    items: plate.items.map((item) => placedItemDict(item, groupKeyForCopy(item.copy))),
  };
}

export function packPreviewForPrinters(
  enabled: PrinterMachine[],
  copies: ReturnType<typeof mergePartsToCopies>,
  assignments: Record<string, string>,
  spacingMm = 4,
  groupingStrategy: GroupingStrategy = "location",
): { preview: unknown[]; plate_count: number; warnings: string[] } {
  const enabledIds = new Set(enabled.map((p) => p.id));
  const effectiveAssignments = {
    ...autoAssignGroups(copies, enabled),
    ...assignmentsOnEnabled(assignments, enabledIds),
  };
  const byPrinter = copiesForAssignments(copies, effectiveAssignments, enabled);
  const previews: unknown[] = [];
  const warnings: string[] = [];
  let plateCount = 0;

  for (const printer of enabled) {
    const pcopies = byPrinter[printer.id] ?? [];
    if (!pcopies.length) continue;
    const [plates, packWarnings] = packCopiesGrouped(groupingStrategy, printer, pcopies, {
      spacing_mm: spacingMm,
    });
    warnings.push(...packWarnings);
    plateCount += plates.length;
    previews.push({
      printer_id: printer.id,
      bed_width_mm: printer.bed_width_mm,
      bed_depth_mm: printer.bed_depth_mm,
      margin_mm: printer.margin_mm,
      plates: plates.map(plateLayoutDict),
    });
  }
  return { preview: previews, plate_count: plateCount, warnings };
}

function countUnassignedGroups(
  groups: Array<{ group_key?: string; printer_id?: string | null }>,
  assignments: Record<string, string>,
): number {
  let unassigned = 0;
  for (const row of groups) {
    const key = row.group_key;
    if (!key) continue;
    if (!(assignments[key] || row.printer_id)) unassigned += 1;
  }
  return unassigned;
}

export function buildPlateWorkspace(repo: AppRepository, profileId: number) {
  const fleet = loadFleet(repo);
  const plan = loadKitPrintPlan(repo, profileId);
  const { parts } = repo.buildMergePartsForProfile(profileId);
  const copies = mergePartsToCopies(parts as MergePartExport[]);
  const enabled = resolveEnabledPrinters(fleet, plan.enabled_printer_ids);
  const enabledIds = new Set(enabled.map((m) => m.id));
  const assignments = assignmentsOnEnabled({ ...plan.group_assignments }, enabledIds);
  const groups = buildPrintGroupRows(copies, enabled, assignments);
  const spacing = plan.plate_layout?.spacing_mm ?? 4;
  const { preview, plate_count, warnings } = packPreviewForPrinters(
    enabled,
    copies,
    assignments,
    spacing,
    plan.grouping_strategy,
  );
  return {
    profile_id: profileId,
    plan: {
      enabled_printer_ids: plan.enabled_printer_ids,
      group_assignments: plan.group_assignments,
      grouping_strategy: plan.grouping_strategy,
      plate_layout: plan.plate_layout
        ? {
            spacing_mm: plan.plate_layout.spacing_mm,
            pool: plan.plate_layout.pool.map((r) => ({
              match_key: r.match_key,
              unit: r.unit,
            })),
            printers: plan.plate_layout.printers.map((p) => ({
              printer_id: p.printer_id,
              plates: p.plates.map((plate) =>
                plate.map((r) => ({ match_key: r.match_key, unit: r.unit })),
              ),
              unassigned: p.unassigned.map((r) => ({
                match_key: r.match_key,
                unit: r.unit,
              })),
            })),
          }
        : null,
    },
    printers: fleet.map((m) => ({ ...m, enabled: enabledIds.has(m.id) })),
    groups,
    preview,
    unassigned_group_count: countUnassignedGroups(groups, assignments),
    plate_count,
    warnings,
  };
}

export function runPackPreview(
  repo: AppRepository,
  profileId: number,
  options: {
    enabled_printer_ids?: string[];
    assignments?: Record<string, string>;
    auto_assign?: boolean;
    spacing_mm?: number;
    grouping_strategy?: GroupingStrategy;
  },
) {
  const fleet = loadFleet(repo);
  const plan = loadKitPrintPlan(repo, profileId);
  const ids =
    options.enabled_printer_ids != null
      ? options.enabled_printer_ids
      : plan.enabled_printer_ids;
  const enabled = resolveEnabledPrinters(fleet, ids);
  const { parts } = repo.buildMergePartsForProfile(profileId);
  const copies = mergePartsToCopies(parts as MergePartExport[]);
  const groupingStrategy = options.grouping_strategy ?? plan.grouping_strategy;

  const enabledIds = new Set(enabled.map((m) => m.id));
  let assignMap = assignmentsOnEnabled(
    { ...(options.assignments ?? plan.group_assignments) },
    enabledIds,
  );
  if (options.auto_assign && enabled.length) {
    assignMap = autoAssignGroups(copies, enabled);
  }

  const groups = buildPrintGroupRows(copies, enabled, assignMap);
  const spacing = options.spacing_mm ?? 4;
  const { preview, plate_count, warnings } = packPreviewForPrinters(
    enabled,
    copies,
    assignMap,
    spacing,
    groupingStrategy,
  );
  const unassigned = countUnassignedGroups(groups, assignMap);

  let plateLayout: Record<string, unknown> | null = null;
  let allWarnings = [...warnings];
  if (options.auto_assign && enabled.length && copies.length) {
    const [layout, layoutWarnings] = autoPlateLayout(enabled, copies, spacing, groupingStrategy);
    allWarnings = allWarnings.concat(layoutWarnings);
    plateLayout = {
      spacing_mm: layout.spacing_mm,
      pool: layout.pool.map((r) => ({ match_key: r.match_key, unit: r.unit })),
      printers: layout.printers.map((p) => ({
        printer_id: p.printer_id,
        plates: p.plates.map((plate) =>
          plate.map((r) => ({ match_key: r.match_key, unit: r.unit })),
        ),
        unassigned: p.unassigned.map((r) => ({ match_key: r.match_key, unit: r.unit })),
      })),
    };
  }

  return {
    profile_id: profileId,
    assignments: assignMap,
    preview,
    unassigned_group_count: unassigned,
    plate_count,
    warnings: allWarnings,
    plate_layout: plateLayout,
  };
}

export function runPackPreviewJob(
  repo: AppRepository,
  profileId: number,
  options: {
    enabled_printer_ids?: string[];
    assignments?: Record<string, string>;
    auto_assign?: boolean;
    spacing_mm?: number;
    grouping_strategy?: GroupingStrategy;
  },
) {
  return runPackPreview(repo, profileId, options);
}

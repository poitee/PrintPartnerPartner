/**
 * Smart print queue routing: given current fleet statuses and queued items,
 * produce a suggestion for each idle printer that has queued work it can run.
 *
 * A suggestion groups all queued items that match a printer (same bed, loaded
 * filament overlap) so the operator can confirm or dismiss in one action.
 */

import type { PrinterSendQueueItem } from "@print-partner/contracts";
import type { PrinterMachine } from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";
import { wantedFilamentIdsForQueueItem } from "./printer-farm-match.js";

export type PrinterQueueSuggestion = {
  /** The idle printer being suggested. */
  printer_id: string;
  printer_name: string;
  /** Integration id the idle status came from. */
  integration_id: string;
  /** Queued items that can be sent to this printer, ordered by filament overlap desc. */
  items: Array<{
    item_id: string;
    filename: string;
    filament_color_ids: string[];
    /** Number of loaded filament slots on the printer that match this item. */
    overlap: number;
  }>;
  /** Total number of queued items matched. */
  item_count: number;
};

function sameBed(printer: PrinterMachine, candidate: PrinterMachine): boolean {
  if (
    printer.bed_width_mm !== candidate.bed_width_mm ||
    printer.bed_depth_mm !== candidate.bed_depth_mm
  ) {
    return false;
  }
  const prefH = printer.bed_height_mm;
  const candH = candidate.bed_height_mm;
  if (prefH != null && candH != null && candH < prefH) return false;
  if (candidate.margin_mm > printer.margin_mm) return false;
  return true;
}

function loadedFilamentOverlap(
  printer: PrinterMachine,
  wanted: Set<string>,
): number {
  if (wanted.size === 0) return 0;
  let score = 0;
  for (const lf of printer.loaded_filaments) {
    const fid = lf.filament_color_id?.trim();
    if (fid && wanted.has(fid)) score += 1;
  }
  return score;
}

/**
 * For each idle linked printer, find queued items it can handle.
 *
 * A queued item is eligible for a printer if:
 *   - item.match === "compatible" and the printer has the same bed as item's preferred
 *     printer, OR item.match === "pinned" and the printer is the preferred one
 *   - item.state === "queued"
 *   - printer is idle (state passed in via idleIntegrationIds)
 *
 * Items are grouped by the printer they would go to. We only suggest printers
 * that have at least one eligible item.
 */
export function computePrinterQueueSuggestions(
  repo: AppRepository,
  fleet: PrinterMachine[],
  idleIntegrationIds: Set<string>,
  queuedItems: PrinterSendQueueItem[],
): PrinterQueueSuggestion[] {
  if (!fleet.length || !idleIntegrationIds.size || !queuedItems.length) {
    return [];
  }

  const machineByIntegration = new Map<string, PrinterMachine>();
  const machineById = new Map<string, PrinterMachine>();
  for (const m of fleet) {
    machineById.set(m.id, m);
    const intId = m.integration_id?.trim();
    if (intId) machineByIntegration.set(intId, m);
  }

  // Only consider printers whose linked integration is idle.
  const idlePrinters: PrinterMachine[] = [];
  for (const intId of idleIntegrationIds) {
    const m = machineByIntegration.get(intId);
    if (m) idlePrinters.push(m);
  }
  if (!idlePrinters.length) return [];

  const suggestions: PrinterQueueSuggestion[] = [];

  for (const printer of idlePrinters) {
    const intId = printer.integration_id?.trim();
    if (!intId) continue;

    const matched: PrinterQueueSuggestion["items"] = [];

    for (const item of queuedItems) {
      if (item.state !== "queued") continue;

      const preferred = machineById.get(item.printer_id);
      if (!preferred) continue;

      let eligible: boolean;
      if (item.match === "compatible") {
        // Compatible: any idle printer with the same bed geometry qualifies.
        eligible = sameBed(preferred, printer);
      } else {
        // Pinned: only the preferred printer.
        eligible = printer.id === preferred.id;
      }
      if (!eligible) continue;

      const wanted = wantedFilamentIdsForQueueItem(repo, item);
      const overlap = loadedFilamentOverlap(printer, wanted);

      matched.push({
        item_id: item.id,
        filename: item.filename,
        filament_color_ids: [...wanted],
        overlap,
      });
    }

    if (!matched.length) continue;

    // Sort by overlap desc, then filename asc.
    matched.sort((a, b) => {
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      return a.filename.localeCompare(b.filename);
    });

    suggestions.push({
      printer_id: printer.id,
      printer_name: printer.name,
      integration_id: intId,
      items: matched,
      item_count: matched.length,
    });
  }

  return suggestions;
}

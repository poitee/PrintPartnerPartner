import type { PrinterSendQueueItem } from "@print-partner/contracts";
import type { PrinterMachine } from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";
import { getIntegrationConfig } from "../integrations/store.js";

export type FarmMatchCandidate = {
  printer: PrinterMachine;
  score: number;
};

/** Filament color ids referenced by queued Progress units (when known). */
export function wantedFilamentIdsForQueueItem(
  repo: AppRepository,
  item: PrinterSendQueueItem,
): Set<string> {
  const wanted = new Set<string>();
  if (!item.profile_id || !item.checkoff_units?.length) return wanted;
  const { parts } = repo.listParts(item.profile_id, 10_000, 0);
  const byId = new Map(parts.map((p) => [p.id, p]));
  for (const unit of item.checkoff_units) {
    const fid = byId.get(unit.part_id)?.filament_color_id?.trim();
    if (fid) wanted.add(fid);
  }
  return wanted;
}

function loadedFilamentOverlap(printer: PrinterMachine, wanted: Set<string>): number {
  if (wanted.size === 0) return 0;
  let score = 0;
  for (const lf of printer.loaded_filaments) {
    const fid = lf.filament_color_id?.trim();
    if (fid && wanted.has(fid)) score += 1;
  }
  return score;
}

function sameBed(a: PrinterMachine, b: PrinterMachine): boolean {
  return a.bed_width_mm === b.bed_width_mm && a.bed_depth_mm === b.bed_depth_mm;
}

/** Linked Moonraker/PrusaLink fleet machines with the preferred bed size. */
export function listCompatibleSendPrinters(
  repo: AppRepository,
  preferred: PrinterMachine,
  fleet: PrinterMachine[],
): PrinterMachine[] {
  const out: PrinterMachine[] = [];
  for (const printer of fleet) {
    if (!sameBed(printer, preferred)) continue;
    const integrationId = printer.integration_id?.trim();
    if (!integrationId) continue;
    const integration = getIntegrationConfig(repo, integrationId);
    if (!integration) continue;
    if (integration.type !== "moonraker" && integration.type !== "prusalink") continue;
    out.push(printer);
  }
  return out;
}

/**
 * Rank compatible printers for a queue item. Higher score = better filament
 * overlap. Preferred printer wins ties.
 */
export function rankCompatibleSendPrinters(
  repo: AppRepository,
  item: PrinterSendQueueItem,
  preferred: PrinterMachine,
  fleet: PrinterMachine[],
  options?: { excludePrinterIds?: Set<string> },
): FarmMatchCandidate[] {
  const wanted = wantedFilamentIdsForQueueItem(repo, item);
  const exclude = options?.excludePrinterIds ?? new Set<string>();
  const ranked: FarmMatchCandidate[] = [];
  for (const printer of listCompatibleSendPrinters(repo, preferred, fleet)) {
    if (exclude.has(printer.id)) continue;
    ranked.push({
      printer,
      score: loadedFilamentOverlap(printer, wanted),
    });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.printer.id === preferred.id) return -1;
    if (b.printer.id === preferred.id) return 1;
    return a.printer.name.localeCompare(b.printer.name);
  });
  return ranked;
}
